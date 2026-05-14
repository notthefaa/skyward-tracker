import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient, handleApiError } from '@/lib/auth';
import { checkEmailRateLimit } from '@/lib/submitRateLimit';
import { idempotency } from '@/lib/idempotency';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { cancelConflictingReservations } from '@/lib/mxConflicts';
import { isPortalLinkExpired } from '@/lib/portalExpiry';
import { loadMutedRecipients, isRecipientMuted } from '@/lib/notificationMutes';
import { isIsoDate } from '@/lib/validation';
import { emailShell, heading, paragraph, callout, bulletList, button } from '@/lib/email/layout';
import { getAppUrl } from '@/lib/email/appUrl';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

/**
 * Computes the estimated_completion date from a start date and duration in days.
 * If duration is e.g. 3, the completion date is startDate + 2 days (3 days inclusive).
 */
function computeEstimatedCompletion(startDate: string, durationDays: number): string {
  // Parse in UTC and use getUTC*/setUTC* so the result is host-TZ-independent.
  const start = new Date(startDate + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() + Math.max(0, durationDays - 1));
  return start.toISOString().split('T')[0];
}

export async function POST(req: Request) {
  try {
    // Parse body ONCE — all fields extracted here
    const body = await req.json();
    const { accessToken, action, proposedDate, message, lineItemUpdates, itemName, itemDescription, serviceDurationDays, timeZone } = body;

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required.' }, { status: 400 });
    }
    // Reject unknown / missing actions up front. The else-if chain below
    // doesn't have a default branch, so without this guard a typo'd or
    // absent `action` would silently fall through to the success
    // response at the end — mechanic would see "saved" but nothing
    // happened.
    const KNOWN_ACTIONS = ['propose_date', 'confirm', 'comment', 'update_lines', 'update_estimate', 'suggest_item', 'decline', 'mark_ready'] as const;
    if (!action || !KNOWN_ACTIONS.includes(action)) {
      return NextResponse.json({ error: `Unknown or missing action. Expected one of: ${KNOWN_ACTIONS.join(', ')}.` }, { status: 400 });
    }

    const supabaseAdmin = createAdminClient();
    const baseUrl = getAppUrl(req);

    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events')
      .select('*')
      .eq('access_token', accessToken)
      .is('deleted_at', null)
      .maybeSingle();

    if (evErr || !event) {
      // If the event was soft-deleted after a mechanic already had the
      // portal link, fall through to the same 404 — the owner cancelled
      // the service and the mechanic shouldn't keep responding on it.
      return NextResponse.json({ error: 'Service event not found.' }, { status: 404 });
    }

    // Token expiry: cancelled events expire immediately, complete
    // events expire PORTAL_EXPIRY_DAYS after completed_at. Leaving
    // cancelled events open would let a mechanic keep commenting on a
    // service the owner walked away from.
    if (event.status === 'cancelled') {
      return NextResponse.json({ error: 'This service was cancelled and the portal link is no longer active.' }, { status: 403 });
    }
    if (isPortalLinkExpired(event)) {
      return NextResponse.json({ error: 'This service portal link has expired.' }, { status: 403 });
    }

    // Token-gated route — no auth user_id, so rate-limit on the event
    // owner's quota. A leaked mechanic token can't be used to flood
    // the owner with notification emails. The data write itself
    // (status / message row) still happens; only the email is gated.
    //
    // Legacy events with no created_by predate the column. The
    // rate-limit table FKs auth.users so we can't bucket per-event;
    // fail closed instead. The action still records (mechanic update
    // visible in-app) but no email goes out. In practice these events
    // should all be past PORTAL_EXPIRY_DAYS already and won't reach
    // here, but pre-fix a leaked legacy token had unlimited email
    // spam capacity.
    const rl = event.created_by
      ? await checkEmailRateLimit(supabaseAdmin, event.created_by)
      : { allowed: false, retryAfterMs: 0 };

    // Idempotency — same X-Idempotency-Key replays the cached
    // {success:true} without re-running the action branch (no
    // duplicate emails to the owner, no double status flip on a
    // confirm/decline race). Skipped on legacy events with no
    // created_by (the FK to auth.users is NOT NULL, so the cache
    // upsert would fail — return uncached and proceed).
    const idem = event.created_by
      ? idempotency(supabaseAdmin, event.created_by, req, 'mx-events/respond')
      : null;
    if (idem) {
      const cached = await idem.check();
      if (cached) return cached;
    }

    const appUrl = baseUrl;

    // service_update mute: if the primary contact has opted out of
    // "Service Updates" in Settings, skip the email branch on every
    // mechanic→owner action below. Uses email-keyed lookup since
    // event.primary_contact_email is the only handle we have.
    const serviceUpdateMuted = await loadMutedRecipients(
      supabaseAdmin,
      [event.primary_contact_email],
      'service_update',
    );
    const ownerMuted = isRecipientMuted(event.primary_contact_email, serviceUpdateMuted);

    // Sanitize common user-provided values
    const safeMxName = escapeHtml(event.mx_contact_name || 'Your maintenance provider');
    const safeMessage = escapeHtml(message);

    if (action === 'propose_date') {
      if (!serviceDurationDays || serviceDurationDays < 1) {
        return NextResponse.json({ error: 'Estimated service duration in days is required.' }, { status: 400 });
      }
      if (!isIsoDate(proposedDate)) {
        return NextResponse.json({ error: 'Proposed date must be a valid YYYY-MM-DD date.' }, { status: 400 });
      }

      const estCompletion = computeEstimatedCompletion(proposedDate, serviceDurationDays);

      // Re-check deleted_at on the UPDATE so a concurrent owner cancel
      // landing between our select and write can't be silently undone.
      // count: 'exact' lets us detect 0-row updates from the concurrent
      // cancel and stop before sending the schedule email.
      const { error: propUpdErr, count: propUpdCount } = await supabaseAdmin
        .from('aft_maintenance_events')
        .update({
          proposed_date: proposedDate,
          proposed_by: 'mechanic',
          service_duration_days: serviceDurationDays,
          estimated_completion: estCompletion,
        }, { count: 'exact' })
        .eq('id', event.id)
        .is('deleted_at', null);
      if (propUpdErr) throw propUpdErr;
      if (propUpdCount === 0) {
        return NextResponse.json({ error: 'This event was cancelled by the owner.' }, { status: 409 });
      }

      const durationLabel = `${serviceDurationDays} day${serviceDurationDays > 1 ? 's' : ''}`;

      const { error: propMsgErr } = await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'propose_date',
        proposed_date: proposedDate,
        message: message || `Proposed service date: ${proposedDate} (estimated ${durationLabel})`,
      } as any);
      if (propMsgErr) throw propMsgErr;

      if (event.primary_contact_email && !ownerMuted) {
        if (rl.allowed) await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: `Schedule Update: ${safeMxName} proposed ${escapeHtml(proposedDate)}`,
          html: emailShell({
            title: `Schedule Proposal — ${escapeHtml(proposedDate)}`,
            preheader: `${safeMxName} proposed ${escapeHtml(proposedDate)}, estimated ${durationLabel}. Confirm or counter via the app.`,
            body: `
              ${heading('Schedule Proposal', 'warning')}
              ${paragraph(`${safeMxName} has proposed <strong>${escapeHtml(proposedDate)}</strong> for service on your aircraft.`)}
              ${paragraph(`Estimated duration: <strong>${durationLabel}</strong> (through ${escapeHtml(estCompletion)})`)}
              ${safeMessage ? callout(safeMessage, { variant: 'warning' }) : ''}
              ${paragraph('Open the app to confirm or propose a different date.')}
              ${button(appUrl, 'Open Skyward')}
            `,
            preferencesUrl: `${appUrl}#settings`,
          }),
        });
      }

    } else if (action === 'confirm') {
      // Mechanic confirming the owner's proposed date — duration is required
      if (!serviceDurationDays || serviceDurationDays < 1) {
        return NextResponse.json({ error: 'Estimated service duration in days is required.' }, { status: 400 });
      }

      const confirmedDate = event.proposed_date;
      const estCompletion = computeEstimatedCompletion(confirmedDate, serviceDurationDays);
      const durationLabel = `${serviceDurationDays} day${serviceDurationDays > 1 ? 's' : ''}`;

      const { error: confUpdErr, count: confUpdCount } = await supabaseAdmin
        .from('aft_maintenance_events')
        .update({
          status: 'confirmed',
          confirmed_date: confirmedDate,
          confirmed_at: new Date().toISOString(),
          service_duration_days: serviceDurationDays,
          estimated_completion: estCompletion,
        }, { count: 'exact' })
        .eq('id', event.id)
        .is('deleted_at', null);
      if (confUpdErr) throw confUpdErr;
      if (confUpdCount === 0) {
        return NextResponse.json({ error: 'This event was cancelled by the owner.' }, { status: 409 });
      }

      const { error: confMsgErr } = await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'confirm',
        proposed_date: confirmedDate,
        message: message || `Confirmed for ${confirmedDate}. Estimated ${durationLabel}.`,
      } as any);
      if (confMsgErr) throw confMsgErr;

      if (event.primary_contact_email && !ownerMuted) {
        if (rl.allowed) await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: `Confirmed: ${escapeHtml(confirmedDate)} Service Appointment`,
          html: emailShell({
            title: `Appointment Confirmed`,
            preheader: `${safeMxName} confirmed ${escapeHtml(confirmedDate)}, ${durationLabel}. Calendar conflicts auto-cancelled.`,
            body: `
              ${heading('Appointment Confirmed', 'success')}
              ${paragraph(`${safeMxName} has confirmed service for <strong>${escapeHtml(confirmedDate)}</strong>.`)}
              ${paragraph(`Estimated duration: <strong>${durationLabel}</strong> (through ${escapeHtml(estCompletion)})`)}
              ${safeMessage ? callout(safeMessage, { variant: 'success' }) : ''}
              ${button(appUrl, 'Open Skyward', { variant: 'success' })}
            `,
            preferencesUrl: `${appUrl}#settings`,
          }),
        });
      }

      // ── MX CONFLICT RESOLUTION ──
      const { data: aircraft } = await supabaseAdmin
        .from('aft_aircraft').select('tail_number').eq('id', event.aircraft_id).single();

      if (aircraft) {
        await cancelConflictingReservations({
          supabaseAdmin,
          aircraftId: event.aircraft_id,
          confirmedDate: confirmedDate,
          estimatedCompletion: estCompletion,
          tailNumber: aircraft.tail_number,
          mechanicName: event.mx_contact_name,
          appUrl: baseUrl,
          timeZone,
        });
      }

    } else if (action === 'comment') {
      const { error: commentMsgErr } = await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'comment',
        message: message || '',
      } as any);
      if (commentMsgErr) throw commentMsgErr;

      if (event.primary_contact_email && !ownerMuted) {
        if (rl.allowed) await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: `Service Update from ${safeMxName}`,
          html: emailShell({
            title: `Service Update from ${safeMxName}`,
            preheader: `${safeMxName} sent you a message about your aircraft.`,
            body: `
              ${heading('Service Update', 'note')}
              ${paragraph(`${safeMxName} sent a message:`)}
              ${callout(safeMessage, { variant: 'note' })}
              ${button(appUrl, 'Open Skyward')}
            `,
            preferencesUrl: `${appUrl}#settings`,
          }),
        });
      }

    } else if (action === 'update_lines') {
      if (lineItemUpdates && Array.isArray(lineItemUpdates)) {
        const VALID_LINE_STATUS = new Set(['pending', 'in_progress', 'complete', 'deferred']);
        for (const update of lineItemUpdates) {
          const updatePayload: any = {};
          if (update.line_status) {
            // Reject invalid values up front with a clean 400. Without
            // this, an unexpected value hits the CHECK constraint and
            // returns a generic 500 to the mechanic with a SQL hint.
            if (!VALID_LINE_STATUS.has(update.line_status)) {
              return NextResponse.json(
                { error: `Invalid line_status: ${update.line_status}` },
                { status: 400 },
              );
            }
            updatePayload.line_status = update.line_status;
          }
          if (update.mechanic_comment !== undefined) updatePayload.mechanic_comment = update.mechanic_comment;
          if (Object.keys(updatePayload).length > 0) {
            // deleted_at IS NULL guard prevents a stale mechanic tab
            // from silently un-soft-deleting an item that an admin
            // removed from the draft. Matches the cancel-terminal
            // pattern used on mx-event UPDATEs everywhere else.
            const { error: lineUpdErr } = await supabaseAdmin.from('aft_event_line_items')
              .update(updatePayload)
              .eq('id', update.id)
              .eq('event_id', event.id)
              .is('deleted_at', null);
            if (lineUpdErr) throw lineUpdErr;
          }
        }

        const { data: allItems, error: allItemsErr } = await supabaseAdmin
          .from('aft_event_line_items').select('item_name, line_status').eq('event_id', event.id);
        if (allItemsErr) throw allItemsErr;
        
        if (allItems && event.primary_contact_email && !ownerMuted) {
          const totalItems = allItems.length;
          const completedItems = allItems.filter((li: any) => li.line_status === 'complete').length;
          const inProgressItems = allItems.filter((li: any) => li.line_status === 'in_progress').length;

          const summaryLine = `${completedItems}/${totalItems} items complete` + (inProgressItems > 0 ? `, ${inProgressItems} in progress` : '');

          const itemLines = allItems.map((li: any) => {
            // Use slateGray for `deferred` so the badge stays readable
            // in both light + dark mode email clients. Per
            // feedback_email_palette.md, gray-700 (#6B7280) is banned
            // in body content because dark-mode rules don't lift it.
            const color = li.line_status === 'complete' ? '#56B94A'
              : li.line_status === 'in_progress' ? '#3AB0FF'
              : li.line_status === 'deferred' ? '#525659'
              : '#F08B46';
            // Replace underscores so the raw enum (e.g. `in_progress`)
            // renders as a readable badge ("IN PROGRESS") instead of
            // leaking the DB schema into the inbox.
            const statusLabel = String(li.line_status).replace(/_/g, ' ');
            return `${escapeHtml(li.item_name)} — <span style="color:${color};font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:1px;">${escapeHtml(statusLabel)}</span>`;
          });

          if (rl.allowed) await resend.emails.send({
            from: `Skyward Operations <${FROM_EMAIL}>`,
            to: [event.primary_contact_email],
            subject: `Work Package Update — ${summaryLine}`,
            html: emailShell({
              title: `Work Package Progress`,
              preheader: `${summaryLine} on your aircraft.`,
              body: `
                ${heading('Work Package Progress')}
                ${paragraph(`${safeMxName} updated the status of work items on your aircraft.`)}
                ${callout(`<strong style="font-size:16px;">${summaryLine}</strong>`, { variant: 'info' })}
                ${bulletList(itemLines)}
                ${button(appUrl, 'Open Skyward')}
              `,
              preferencesUrl: `${appUrl}#settings`,
            }),
          });
        }
      }

    } else if (action === 'update_estimate') {
      const updatePayload: any = {};
      if (proposedDate) updatePayload.estimated_completion = proposedDate;
      if (message !== undefined) updatePayload.mechanic_notes = message;

      const { error: estUpdErr, count: estUpdCount } = await supabaseAdmin
        .from('aft_maintenance_events')
        .update(updatePayload, { count: 'exact' })
        .eq('id', event.id)
        .is('deleted_at', null);
      if (estUpdErr) throw estUpdErr;
      if (estUpdCount === 0) {
        return NextResponse.json({ error: 'This event was cancelled by the owner.' }, { status: 409 });
      }

      if (event.primary_contact_email && proposedDate && !ownerMuted) {
        if (rl.allowed) await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: `Estimated Completion: ${escapeHtml(proposedDate)}`,
          html: emailShell({
            title: `Estimated Completion`,
            preheader: `${safeMxName} estimates your aircraft ready by ${escapeHtml(proposedDate)}.`,
            body: `
              ${heading('Completion Estimate')}
              ${paragraph(`${safeMxName} estimates your aircraft will be ready by <strong>${escapeHtml(proposedDate)}</strong>.`)}
              ${safeMessage ? callout(safeMessage, { variant: 'warning' }) : ''}
              ${button(appUrl, 'Open Skyward')}
            `,
            preferencesUrl: `${appUrl}#settings`,
          }),
        });
      }

    } else if (action === 'suggest_item') {
      const suggestedName = itemName || message || 'Additional Work';

      const { error: suggLineErr } = await supabaseAdmin.from('aft_event_line_items').insert({
        event_id: event.id,
        item_type: 'addon',
        item_name: suggestedName,
        item_description: itemDescription || null,
        line_status: 'pending',
        mechanic_comment: 'Added by maintenance provider',
      } as any);
      if (suggLineErr) throw suggLineErr;

      const { error: suggMsgErr } = await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'status_update',
        message: `Added item: ${suggestedName}${itemDescription ? ' — ' + itemDescription : ''}`,
      } as any);
      if (suggMsgErr) throw suggMsgErr;

      const safeSuggestedName = escapeHtml(suggestedName);
      const safeItemDescription = escapeHtml(itemDescription);

      if (event.primary_contact_email && !ownerMuted) {
        if (rl.allowed) await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: `Additional Work Suggested: ${safeSuggestedName}`,
          html: emailShell({
            title: `Additional Work Found`,
            preheader: `${safeMxName} found something else that needs attention on your aircraft.`,
            body: `
              ${heading('Additional Work Found', 'warning')}
              ${paragraph(`${safeMxName} has identified additional work needed on your aircraft:`)}
              ${callout(
                `<strong>${safeSuggestedName}</strong>${safeItemDescription ? `<div style="margin-top:8px;color:#091F3C;">${safeItemDescription}</div>` : ''}`,
                { variant: 'warning' }
              )}
              ${button(appUrl, 'Open Skyward')}
            `,
            preferencesUrl: `${appUrl}#settings`,
          }),
        });
      }

    } else if (action === 'decline') {
      const { error: declUpdErr, count: declUpdCount } = await supabaseAdmin
        .from('aft_maintenance_events')
        .update({
          status: 'cancelled',
          mechanic_notes: message || 'Declined by maintenance provider.',
        }, { count: 'exact' })
        .eq('id', event.id)
        .is('deleted_at', null);
      if (declUpdErr) throw declUpdErr;
      if (declUpdCount === 0) {
        return NextResponse.json({ error: 'This event was already cancelled.' }, { status: 409 });
      }

      const { error: declMsgErr } = await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'status_update',
        message: message || 'Service declined by maintenance provider.',
      } as any);
      if (declMsgErr) throw declMsgErr;

      if (event.primary_contact_email && !ownerMuted) {
        if (rl.allowed) await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: `Service Declined by ${safeMxName}`,
          html: emailShell({
            title: `Service Declined`,
            preheader: `${safeMxName} can't accommodate this service request.`,
            body: `
              ${heading('Service Declined', 'danger')}
              ${paragraph(`${safeMxName} can&apos;t accommodate this service request.`)}
              ${safeMessage ? callout(safeMessage, { variant: 'danger' }) : ''}
              ${paragraph(`You might want to reach out to a different mechanic or reschedule.`)}
              ${button(appUrl, 'Open Skyward')}
            `,
            preferencesUrl: `${appUrl}#settings`,
          }),
        });
      }

    } else if (action === 'mark_ready') {
      // ready_at anchors the cron's Phase 5 pickup nudge. Setting it
      // authoritatively here (instead of letting the cron infer from
      // message ordering) avoids the suggest_item-before-mark_ready
      // ambiguity that made the nudge fire days early.
      const { error: rdyUpdErr, count: rdyUpdCount } = await supabaseAdmin
        .from('aft_maintenance_events')
        .update({ status: 'ready_for_pickup', ready_at: new Date().toISOString() }, { count: 'exact' })
        .eq('id', event.id)
        .is('deleted_at', null);
      if (rdyUpdErr) throw rdyUpdErr;
      if (rdyUpdCount === 0) {
        return NextResponse.json({ error: 'This event was cancelled by the owner.' }, { status: 409 });
      }

      const { error: rdyMsgErr } = await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'status_update',
        message: message || 'All work complete. Aircraft is ready for pickup.',
      } as any);
      if (rdyMsgErr) throw rdyMsgErr;

      // Pull the tail for the subject — owners with multiple aircraft
      // can't tell which one is ready otherwise.
      const { data: rdyAircraft } = await supabaseAdmin
        .from('aft_aircraft').select('tail_number').eq('id', event.aircraft_id).maybeSingle();
      const rdyTail = rdyAircraft?.tail_number ? escapeHtml(rdyAircraft.tail_number) : '';

      if (event.primary_contact_email && !ownerMuted) {
        if (rl.allowed) await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: rdyTail ? `Ready for Pickup: ${rdyTail}` : `Aircraft Ready for Pickup`,
          html: emailShell({
            title: `Aircraft Ready for Pickup`,
            preheader: `All work complete. Enter logbook data to close out the service event.`,
            body: `
              ${heading('Aircraft Ready for Pickup', 'success')}
              ${paragraph(`${safeMxName} has completed all work and your aircraft is ready.`)}
              ${safeMessage ? callout(safeMessage, { variant: 'success' }) : ''}
              ${paragraph(`Log in to enter the logbook data from your mechanic&apos;s sign-off. That closes out the service event and resets the maintenance clock for the next cycle.`)}
              ${button(appUrl, 'Enter Logbook Data', { variant: 'success' })}
            `,
            preferencesUrl: `${appUrl}#settings`,
          }),
        });
      }
    }

    // Surface email-skip when the owner's per-user email rate limit
    // is full. Without this, the mechanic-portal taps "Confirm" /
    // "Mark Ready" / "Update Progress", DB updates land, but the
    // owner never gets the notification — and neither side has any
    // signal it didn't ship. Client can soft-warn the mechanic that
    // the owner will see the change in-app rather than via email.
    const responseBody: Record<string, unknown> = { success: true };
    if (event.created_by && !rl.allowed) {
      responseBody.email_skipped = true;
      responseBody.email_retry_after_ms = rl.retryAfterMs;
    }
    if (idem) await idem.save(200, responseBody);
    return NextResponse.json(responseBody);
  } catch (error) {
    return handleApiError(error, req);
  }
}

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient, handleApiError } from '@/lib/auth';
import { checkEmailRateLimit } from '@/lib/submitRateLimit';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { cancelConflictingReservations } from '@/lib/mxConflicts';
import { PORTAL_EXPIRY_DAYS } from '@/lib/constants';
import { isIsoDate } from '@/lib/validation';
import { emailShell, heading, paragraph, callout, bulletList, button } from '@/lib/email/layout';

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
    const baseUrl = new URL(req.url).origin;

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

    // Token expiry: complete events expire PORTAL_EXPIRY_DAYS after
    // completed_at; cancelled events expire immediately (mirrors
    // upload-attachment). Leaving cancelled events open would let a
    // mechanic keep commenting on a service the owner walked away from.
    if (event.status === 'cancelled') {
      return NextResponse.json({ error: 'This service was cancelled and the portal link is no longer active.' }, { status: 403 });
    }
    if (event.status === 'complete' && event.completed_at) {
      const expiryDate = new Date(new Date(event.completed_at).getTime() + PORTAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      if (new Date() > expiryDate) {
        return NextResponse.json({ error: 'This service portal link has expired.' }, { status: 403 });
      }
    }

    // Token-gated route — no auth user_id, so rate-limit on the event
    // owner's quota. A leaked mechanic token can't be used to flood
    // the owner with notification emails. The data write itself
    // (status / message row) still happens; only the email is gated.
    const rl = event.created_by
      ? await checkEmailRateLimit(supabaseAdmin, event.created_by)
      : { allowed: true, retryAfterMs: 0 };

    const appUrl = baseUrl;

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
      await supabaseAdmin.from('aft_maintenance_events').update({
        proposed_date: proposedDate,
        proposed_by: 'mechanic',
        service_duration_days: serviceDurationDays,
        estimated_completion: estCompletion,
      }).eq('id', event.id).is('deleted_at', null);

      const durationLabel = `${serviceDurationDays} day${serviceDurationDays > 1 ? 's' : ''}`;

      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'propose_date',
        proposed_date: proposedDate,
        message: message || `Proposed service date: ${proposedDate} (estimated ${durationLabel})`,
      } as any);

      if (event.primary_contact_email) {
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

      await supabaseAdmin.from('aft_maintenance_events').update({
        status: 'confirmed',
        confirmed_date: confirmedDate,
        confirmed_at: new Date().toISOString(),
        service_duration_days: serviceDurationDays,
        estimated_completion: estCompletion,
      }).eq('id', event.id).is('deleted_at', null);

      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'confirm',
        proposed_date: confirmedDate,
        message: message || `Confirmed for ${confirmedDate}. Estimated ${durationLabel}.`,
      } as any);

      if (event.primary_contact_email) {
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
      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'comment',
        message: message || '',
      } as any);

      if (event.primary_contact_email) {
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
          }),
        });
      }

    } else if (action === 'update_lines') {
      if (lineItemUpdates && Array.isArray(lineItemUpdates)) {
        for (const update of lineItemUpdates) {
          const updatePayload: any = {};
          if (update.line_status) updatePayload.line_status = update.line_status;
          if (update.mechanic_comment !== undefined) updatePayload.mechanic_comment = update.mechanic_comment;
          if (Object.keys(updatePayload).length > 0) {
            await supabaseAdmin.from('aft_event_line_items')
              .update(updatePayload)
              .eq('id', update.id)
              .eq('event_id', event.id);
          }
        }

        const { data: allItems } = await supabaseAdmin
          .from('aft_event_line_items').select('item_name, line_status').eq('event_id', event.id);
        
        if (allItems && event.primary_contact_email) {
          const totalItems = allItems.length;
          const completedItems = allItems.filter((li: any) => li.line_status === 'complete').length;
          const inProgressItems = allItems.filter((li: any) => li.line_status === 'in_progress').length;

          const summaryLine = `${completedItems}/${totalItems} items complete` + (inProgressItems > 0 ? `, ${inProgressItems} in progress` : '');

          const itemLines = allItems.map((li: any) => {
            const color = li.line_status === 'complete' ? '#56B94A'
              : li.line_status === 'in_progress' ? '#3AB0FF'
              : li.line_status === 'deferred' ? '#6B7280'
              : '#F08B46';
            return `${escapeHtml(li.item_name)} — <span style="color:${color};font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:1px;">${escapeHtml(li.line_status)}</span>`;
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
            }),
          });
        }
      }

    } else if (action === 'update_estimate') {
      const updatePayload: any = {};
      if (proposedDate) updatePayload.estimated_completion = proposedDate;
      if (message !== undefined) updatePayload.mechanic_notes = message;
      
      await supabaseAdmin.from('aft_maintenance_events')
        .update(updatePayload).eq('id', event.id).is('deleted_at', null);

      if (event.primary_contact_email && proposedDate) {
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
          }),
        });
      }

    } else if (action === 'suggest_item') {
      const suggestedName = itemName || message || 'Additional Work';

      await supabaseAdmin.from('aft_event_line_items').insert({
        event_id: event.id,
        item_type: 'addon',
        item_name: suggestedName,
        item_description: itemDescription || null,
        line_status: 'pending',
        mechanic_comment: 'Added by maintenance provider',
      } as any);

      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'status_update',
        message: `Added item: ${suggestedName}${itemDescription ? ' — ' + itemDescription : ''}`,
      } as any);

      const safeSuggestedName = escapeHtml(suggestedName);
      const safeItemDescription = escapeHtml(itemDescription);

      if (event.primary_contact_email) {
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
          }),
        });
      }

    } else if (action === 'decline') {
      await supabaseAdmin.from('aft_maintenance_events').update({
        status: 'cancelled',
        mechanic_notes: message || 'Declined by maintenance provider.',
      }).eq('id', event.id).is('deleted_at', null);

      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'status_update',
        message: message || 'Service declined by maintenance provider.',
      } as any);

      if (event.primary_contact_email) {
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
          }),
        });
      }

    } else if (action === 'mark_ready') {
      await supabaseAdmin.from('aft_maintenance_events').update({
        status: 'ready_for_pickup',
      }).eq('id', event.id).is('deleted_at', null);

      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'status_update',
        message: message || 'All work complete. Aircraft is ready for pickup.',
      } as any);

      if (event.primary_contact_email) {
        if (rl.allowed) await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: `Aircraft Ready for Pickup`,
          html: emailShell({
            title: `Aircraft Ready for Pickup`,
            preheader: `All work complete. Enter logbook data to close out the service event.`,
            body: `
              ${heading('Aircraft Ready for Pickup', 'success')}
              ${paragraph(`${safeMxName} has completed all work and your aircraft is ready.`)}
              ${safeMessage ? callout(safeMessage, { variant: 'success' }) : ''}
              ${paragraph(`Log in to enter the logbook data from your mechanic&apos;s sign-off. That closes out the service event and resets maintenance tracking.`)}
              ${button(appUrl, 'Enter Logbook Data', { variant: 'success' })}
            `,
          }),
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

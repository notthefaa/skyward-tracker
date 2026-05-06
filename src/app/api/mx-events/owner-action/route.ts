import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { Resend } from 'resend';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { cancelConflictingReservations } from '@/lib/mxConflicts';
import { isIsoDate } from '@/lib/validation';
import { emailShell, heading, paragraph, callout, button } from '@/lib/email/layout';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { eventId, action, proposedDate, message, timeZone } = await req.json();

    if (!eventId || !action) {
      return NextResponse.json({ error: 'Event ID and action are required.' }, { status: 400 });
    }

    // Reject actions on soft-deleted events so an owner can't "confirm" or
    // "counter" an event they already cancelled via a stale tab.
    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events').select('*').eq('id', eventId).is('deleted_at', null).maybeSingle();

    if (evErr || !event) {
      return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
    }

    // Verify the user has access to this aircraft
    await requireAircraftAdmin(supabaseAdmin, user.id, event.aircraft_id);
    await setAppUser(supabaseAdmin, user.id);

    const portalUrl = `${new URL(req.url).origin}/service/${event.access_token}`;
    const mxEmail = event.mx_contact_email;
    const primaryEmail = event.primary_contact_email;

    // Sanitize all user-provided strings
    const safeMxName = escapeHtml(event.mx_contact_name || 'Maintenance');
    const safePrimaryName = escapeHtml(event.primary_contact_name || 'Owner');
    const safeMessage = escapeHtml(message);

    if (action === 'confirm') {
      // Owner confirms mechanic's proposed date.
      // Re-check deleted_at on the UPDATE so a concurrent cancel from
      // another tab can't be silently resurrected by this confirm.
      // count: 'exact' surfaces a 0-row update (concurrent cancel) so
      // we don't email the mechanic about a confirm that didn't land.
      const { error: confUpdErr, count: confUpdCount } = await supabaseAdmin
        .from('aft_maintenance_events')
        .update({
          status: 'confirmed',
          confirmed_date: event.proposed_date,
          confirmed_at: new Date().toISOString(),
        }, { count: 'exact' })
        .eq('id', eventId)
        .is('deleted_at', null);
      if (confUpdErr) throw confUpdErr;
      if (confUpdCount === 0) {
        return NextResponse.json({ error: 'This event was already cancelled.' }, { status: 409 });
      }

      const durationLabel = event.service_duration_days
        ? ` (${event.service_duration_days} day${event.service_duration_days > 1 ? 's' : ''})`
        : '';

      const { error: confMsgErr } = await supabaseAdmin.from('aft_event_messages').insert({
        event_id: eventId,
        sender: 'owner',
        message_type: 'confirm',
        proposed_date: event.proposed_date,
        message: message || `Confirmed for ${event.proposed_date}${durationLabel}.`,
      } as any);
      if (confMsgErr) throw confMsgErr;

      // Email mechanic
      if (mxEmail) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [mxEmail],
          cc: primaryEmail ? [primaryEmail] : [],
          replyTo: primaryEmail || undefined,
          subject: `Date Confirmed — ${event.proposed_date}`,
          html: emailShell({
            title: `Date Confirmed`,
            preheader: `${safePrimaryName} confirmed ${escapeHtml(event.proposed_date)}${durationLabel}.`,
            body: `
              ${heading('Date Confirmed', 'success')}
              ${paragraph(`Hello ${safeMxName},`)}
              ${paragraph(`${safePrimaryName} has confirmed the proposed service date of <strong>${escapeHtml(event.proposed_date)}</strong>${durationLabel}.`)}
              ${safeMessage ? callout(safeMessage, { variant: 'success' }) : ''}
              ${button(portalUrl, 'View Service Portal', { variant: 'success' })}
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
          confirmedDate: event.proposed_date,
          estimatedCompletion: event.estimated_completion || null,
          tailNumber: aircraft.tail_number,
          mechanicName: event.mx_contact_name,
          appUrl: new URL(req.url).origin,
          timeZone,
        });
      }

    } else if (action === 'counter') {
      // Owner proposes a different date
      if (!isIsoDate(proposedDate)) {
        return NextResponse.json({ error: 'A valid YYYY-MM-DD date is required for counter.' }, { status: 400 });
      }

      const { error: cntrUpdErr, count: cntrUpdCount } = await supabaseAdmin
        .from('aft_maintenance_events')
        .update({
          proposed_date: proposedDate,
          proposed_by: 'owner',
        }, { count: 'exact' })
        .eq('id', eventId)
        .is('deleted_at', null);
      if (cntrUpdErr) throw cntrUpdErr;
      if (cntrUpdCount === 0) {
        return NextResponse.json({ error: 'This event was already cancelled.' }, { status: 409 });
      }

      const { error: cntrMsgErr } = await supabaseAdmin.from('aft_event_messages').insert({
        event_id: eventId,
        sender: 'owner',
        message_type: 'counter',
        proposed_date: proposedDate,
        message: message || `How about ${proposedDate} instead?`,
      } as any);
      if (cntrMsgErr) throw cntrMsgErr;

      // Email mechanic
      if (mxEmail) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [mxEmail],
          cc: primaryEmail ? [primaryEmail] : [],
          replyTo: primaryEmail || undefined,
          subject: `New Date Proposed — ${proposedDate}`,
          html: emailShell({
            title: `Counter Proposal`,
            preheader: `${safePrimaryName} proposed ${escapeHtml(proposedDate)} instead.`,
            body: `
              ${heading('Counter Proposal', 'warning')}
              ${paragraph(`Hello ${safeMxName},`)}
              ${paragraph(`${safePrimaryName} has proposed a different service date: <strong>${escapeHtml(proposedDate)}</strong>.`)}
              ${safeMessage ? callout(safeMessage, { variant: 'warning' }) : ''}
              ${button(portalUrl, 'View Service Portal')}
            `,
          }),
        });
      }

    } else if (action === 'comment') {
      // General message from owner to mechanic
      const { error: ownerCommentErr } = await supabaseAdmin.from('aft_event_messages').insert({
        event_id: eventId,
        sender: 'owner',
        message_type: 'comment',
        message: message || '',
      } as any);
      if (ownerCommentErr) throw ownerCommentErr;

      // Email mechanic
      if (mxEmail && message) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [mxEmail],
          cc: primaryEmail ? [primaryEmail] : [],
          replyTo: primaryEmail || undefined,
          subject: `Message from ${safePrimaryName}`,
          html: emailShell({
            title: `Message from ${safePrimaryName}`,
            preheader: `${safePrimaryName} sent you a message about the service event.`,
            body: `
              ${heading('New Message', 'note')}
              ${paragraph(`Hello ${safeMxName},`)}
              ${paragraph(`${safePrimaryName} sent you a message:`)}
              ${callout(safeMessage, { variant: 'note' })}
              ${button(portalUrl, 'View Service Portal')}
            `,
          }),
        });
      }

    } else if (action === 'cancel') {
      // Owner cancels the service event. Rotate the access_token so any
      // still-circulating portal links stop working — the mutations
      // were already rejected by the status check, but read access to
      // event history / attached images / message thread would linger
      // otherwise. A fresh random token makes the old link a 404.
      const freshToken = randomBytes(32).toString('base64url');
      const { error: cancelUpdErr, count: cancelUpdCount } = await supabaseAdmin
        .from('aft_maintenance_events')
        .update({
          status: 'cancelled',
          access_token: freshToken,
        }, { count: 'exact' })
        .eq('id', eventId)
        .is('deleted_at', null);
      if (cancelUpdErr) throw cancelUpdErr;
      if (cancelUpdCount === 0) {
        return NextResponse.json({ error: 'This event was already cancelled.' }, { status: 409 });
      }

      const { error: cancelMsgErr } = await supabaseAdmin.from('aft_event_messages').insert({
        event_id: eventId,
        sender: 'owner',
        message_type: 'status_update',
        message: message || 'Service event cancelled by owner.',
      } as any);
      if (cancelMsgErr) throw cancelMsgErr;

      // Email mechanic
      if (mxEmail) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [mxEmail],
          cc: primaryEmail ? [primaryEmail] : [],
          replyTo: primaryEmail || undefined,
          subject: `Service Cancelled — ${safePrimaryName}`,
          html: emailShell({
            title: `Service Cancelled`,
            preheader: `${safePrimaryName} cancelled the pending service event — nothing more to do on your end.`,
            body: `
              ${heading('Service Event Cancelled', 'danger')}
              ${paragraph(`Hello ${safeMxName},`)}
              ${paragraph(`${safePrimaryName} has cancelled the pending service event.`)}
              ${safeMessage ? callout(safeMessage, { variant: 'danger' }) : ''}
              ${paragraph(`Nothing more to do on your end. Sorry for the inconvenience.`)}
            `,
          }),
        });
      }

    } else {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}

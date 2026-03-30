import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';
import { env } from '@/lib/env';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { eventId, action, proposedDate, message } = await req.json();

    if (!eventId || !action) {
      return NextResponse.json({ error: 'Event ID and action are required.' }, { status: 400 });
    }

    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events').select('*').eq('id', eventId).single();

    if (evErr || !event) {
      return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
    }

    // Verify the user has access to this aircraft
    await requireAircraftAccess(supabaseAdmin, user.id, event.aircraft_id);

    const portalUrl = `${new URL(req.url).origin}/service/${event.access_token}`;
    const mxEmail = event.mx_contact_email;
    const mxName = event.mx_contact_name || 'Maintenance';
    const primaryEmail = event.primary_contact_email;
    const primaryName = event.primary_contact_name || 'Owner';

    if (action === 'confirm') {
      // Owner confirms mechanic's proposed date
      await supabaseAdmin.from('aft_maintenance_events').update({
        status: 'confirmed',
        confirmed_date: event.proposed_date,
        confirmed_at: new Date().toISOString(),
      }).eq('id', eventId);

      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: eventId,
        sender: 'owner',
        message_type: 'confirm',
        proposed_date: event.proposed_date,
        message: message || `Confirmed for ${event.proposed_date}.`,
      } as any);

      // Email mechanic
      if (mxEmail) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [mxEmail],
          cc: primaryEmail ? [primaryEmail] : [],
          replyTo: primaryEmail || undefined,
          subject: `Date Confirmed — ${event.proposed_date}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #091F3C;">Date Confirmed</h2>
              <p>Hello ${mxName},</p>
              <p>${primaryName} has confirmed the proposed service date of <strong>${event.proposed_date}</strong>.</p>
              ${message ? `<p style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-left: 4px solid #56B94A; border-radius: 4px;"><em>${message}</em></p>` : ''}
              <p style="margin-top: 20px;"><a href="${portalUrl}" style="background: #091F3C; color: white; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: bold;">View Service Portal</a></p>
            </div>
          `
        });
      }

    } else if (action === 'counter') {
      // Owner proposes a different date
      if (!proposedDate) {
        return NextResponse.json({ error: 'Proposed date is required for counter.' }, { status: 400 });
      }

      await supabaseAdmin.from('aft_maintenance_events').update({
        proposed_date: proposedDate,
        proposed_by: 'owner',
      }).eq('id', eventId);

      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: eventId,
        sender: 'owner',
        message_type: 'counter',
        proposed_date: proposedDate,
        message: message || `How about ${proposedDate} instead?`,
      } as any);

      // Email mechanic
      if (mxEmail) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [mxEmail],
          cc: primaryEmail ? [primaryEmail] : [],
          replyTo: primaryEmail || undefined,
          subject: `New Date Proposed — ${proposedDate}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #091F3C;">Counter Proposal</h2>
              <p>Hello ${mxName},</p>
              <p>${primaryName} has proposed a different service date: <strong>${proposedDate}</strong>.</p>
              ${message ? `<p style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-left: 4px solid #F08B46; border-radius: 4px;"><em>${message}</em></p>` : ''}
              <p style="margin-top: 20px;"><a href="${portalUrl}" style="background: #091F3C; color: white; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: bold;">View Service Portal</a></p>
            </div>
          `
        });
      }

    } else if (action === 'comment') {
      // General message from owner to mechanic
      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: eventId,
        sender: 'owner',
        message_type: 'comment',
        message: message || '',
      } as any);

      // Email mechanic
      if (mxEmail && message) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [mxEmail],
          cc: primaryEmail ? [primaryEmail] : [],
          replyTo: primaryEmail || undefined,
          subject: `Message from ${primaryName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #091F3C;">New Message</h2>
              <p>Hello ${mxName},</p>
              <p>${primaryName} sent you a message:</p>
              <p style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-left: 4px solid #3AB0FF; border-radius: 4px;"><em>${message}</em></p>
              <p style="margin-top: 20px;"><a href="${portalUrl}" style="background: #091F3C; color: white; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: bold;">View Service Portal</a></p>
            </div>
          `
        });
      }

    } else if (action === 'cancel') {
      // Owner cancels the service event
      await supabaseAdmin.from('aft_maintenance_events').update({
        status: 'cancelled',
      }).eq('id', eventId);

      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: eventId,
        sender: 'owner',
        message_type: 'status_update',
        message: message || 'Service event cancelled by owner.',
      } as any);

      // Email mechanic
      if (mxEmail) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [mxEmail],
          cc: primaryEmail ? [primaryEmail] : [],
          replyTo: primaryEmail || undefined,
          subject: `Service Cancelled — ${event.primary_contact_name || 'Owner'}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #CE3732;">Service Event Cancelled</h2>
              <p>Hello ${mxName},</p>
              <p>${primaryName} has cancelled the pending service event.</p>
              ${message ? `<p style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-left: 4px solid #CE3732; border-radius: 4px;"><em>${message}</em></p>` : ''}
              <p style="margin-top: 15px; color: #666;">No further action is needed on your end. We apologize for any inconvenience.</p>
            </div>
          `
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

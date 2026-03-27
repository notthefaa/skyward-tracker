import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireAuth, handleApiError } from '@/lib/auth';
import { env } from '@/lib/env';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    const { supabaseAdmin } = await requireAuth(req);
    const body = await req.json();
    const { eventId, additionalMxItemIds, additionalSquawkIds, addonServices, proposedDate } = body;
    const isResend = body.resend === true;

    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required.' }, { status: 400 });
    }

    // Fetch the event
    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events').select('*').eq('id', eventId).single();

    if (evErr || !event) {
      return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
    }

    // For initial sends, only drafts are allowed. For resends, any active status is fine.
    if (!isResend && event.status !== 'draft') {
      return NextResponse.json({ error: 'Only draft events can be sent. Use resend for active events.' }, { status: 400 });
    }

    if (isResend && (event.status === 'complete' || event.status === 'cancelled')) {
      return NextResponse.json({ error: 'Cannot resend completed or cancelled events.' }, { status: 400 });
    }

    // Fetch aircraft for email content
    const { data: aircraft } = await supabaseAdmin
      .from('aft_aircraft').select('*').eq('id', event.aircraft_id).single();

    if (!aircraft) {
      return NextResponse.json({ error: 'Aircraft not found.' }, { status: 404 });
    }

    // Add additional items (only for initial send, not resend)
    if (!isResend) {
      if (additionalMxItemIds && additionalMxItemIds.length > 0) {
        const { data: mxItems } = await supabaseAdmin
          .from('aft_maintenance_items').select('*').in('id', additionalMxItemIds);

        if (mxItems && mxItems.length > 0) {
          const lineItems = mxItems.map((mx: any) => ({
            event_id: eventId,
            item_type: 'maintenance',
            maintenance_item_id: mx.id,
            item_name: mx.item_name,
            item_description: mx.tracking_type === 'time'
              ? `Due at ${mx.due_time} hrs`
              : `Due on ${mx.due_date}`,
          }));
          await supabaseAdmin.from('aft_event_line_items').insert(lineItems);
        }
      }

      if (additionalSquawkIds && additionalSquawkIds.length > 0) {
        const { data: squawks } = await supabaseAdmin
          .from('aft_squawks').select('*').in('id', additionalSquawkIds);

        if (squawks && squawks.length > 0) {
          const lineItems = squawks.map((sq: any) => ({
            event_id: eventId,
            item_type: 'squawk',
            squawk_id: sq.id,
            item_name: sq.description ? `Squawk: ${sq.description.substring(0, 80)}` : `Squawk: ${sq.location || 'No description'}`,
            item_description: sq.affects_airworthiness && sq.location ? `Grounded at ${sq.location}` : (sq.description || null),
          }));
          await supabaseAdmin.from('aft_event_line_items').insert(lineItems);
        }
      }

      if (addonServices && addonServices.length > 0) {
        const lineItems = addonServices.map((service: string) => ({
          event_id: eventId,
          item_type: 'addon',
          item_name: service,
          item_description: null,
        }));
        await supabaseAdmin.from('aft_event_line_items').insert(lineItems);
      }

      // Update event status to 'scheduling' and set proposed date
      const eventUpdate: any = {
        status: 'scheduling',
        addon_services: addonServices || event.addon_services || [],
      };
      if (proposedDate) {
        eventUpdate.proposed_date = proposedDate;
        eventUpdate.proposed_by = 'owner';
      }
      await supabaseAdmin.from('aft_maintenance_events').update(eventUpdate).eq('id', eventId);

      // Log proposed date message
      if (proposedDate) {
        await supabaseAdmin.from('aft_event_messages').insert({
          event_id: eventId,
          sender: 'owner',
          message_type: 'propose_date',
          proposed_date: proposedDate,
          message: `Requesting service on ${proposedDate}.`,
        } as any);
      }
    }

    // Send the work package email to the mechanic
    if (aircraft.mx_contact_email) {
      const portalUrl = `${new URL(req.url).origin}/service/${event.access_token}`;
      const mxCc = aircraft.main_contact_email ? [aircraft.main_contact_email] : [];

      // Fetch ALL line items
      const { data: allLineItems } = await supabaseAdmin
        .from('aft_event_line_items').select('*').eq('event_id', eventId);

      const mxItemsHtml = (allLineItems || [])
        .filter((li: any) => li.item_type === 'maintenance')
        .map((li: any) => `<li style="margin-bottom: 8px;"><strong>${li.item_name}</strong>${li.item_description ? ` — ${li.item_description}` : ''}</li>`)
        .join('');

      const squawkItemsHtml = (allLineItems || [])
        .filter((li: any) => li.item_type === 'squawk')
        .map((li: any) => `<li style="margin-bottom: 8px;"><strong>${li.item_name}</strong>${li.item_description ? ` — ${li.item_description}` : ''}</li>`)
        .join('');

      const addonItemsHtml = (allLineItems || [])
        .filter((li: any) => li.item_type === 'addon')
        .map((li: any) => `<li style="margin-bottom: 8px;">${li.item_name}</li>`)
        .join('');

      const effectiveDate = proposedDate || event.proposed_date;
      const dateSection = effectiveDate
        ? `<p style="margin-top: 20px;"><strong>Requested Service Date:</strong> ${effectiveDate}</p>`
        : `<p style="margin-top: 20px;">Please propose a date that works for your schedule.</p>`;

      const subjectPrefix = isResend ? 'Reminder — ' : '';

      await resend.emails.send({
        from: `Skyward Operations <${FROM_EMAIL}>`,
        replyTo: aircraft.main_contact_email || undefined,
        to: [aircraft.mx_contact_email],
        cc: mxCc,
        subject: `${subjectPrefix}Service Request: ${aircraft.tail_number} — Work Package`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
            <h2 style="color: #091F3C; text-transform: uppercase; letter-spacing: 2px; border-bottom: 2px solid #091F3C; padding-bottom: 10px;">Service Request</h2>
            
            <p style="color: #525659; font-size: 16px;">Hello ${aircraft.mx_contact || ''},</p>
            <p style="color: #525659; font-size: 16px;">We'd like to schedule service for <strong>${aircraft.tail_number}</strong> (${aircraft.aircraft_type}). Below is the full work package.</p>
            
            ${dateSection}

            ${mxItemsHtml ? `
              <div style="margin-top: 25px;">
                <h3 style="color: #F08B46; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Maintenance Items Due</h3>
                <ul style="color: #333; font-size: 14px; line-height: 1.8;">${mxItemsHtml}</ul>
              </div>
            ` : ''}

            ${squawkItemsHtml ? `
              <div style="margin-top: 25px;">
                <h3 style="color: #CE3732; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Squawks / Discrepancies</h3>
                <ul style="color: #333; font-size: 14px; line-height: 1.8;">${squawkItemsHtml}</ul>
              </div>
            ` : ''}

            ${addonItemsHtml ? `
              <div style="margin-top: 25px;">
                <h3 style="color: #3AB0FF; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Additional Services Requested</h3>
                <ul style="color: #333; font-size: 14px; line-height: 1.8;">${addonItemsHtml}</ul>
              </div>
            ` : ''}

            <div style="margin-top: 30px; padding: 20px; background-color: #F0F9FF; border-radius: 8px; text-align: center;">
              <p style="margin: 0 0 12px 0; color: #091F3C; font-weight: bold;">View Full Details & Respond</p>
              <a href="${portalUrl}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; letter-spacing: 1px;">OPEN SERVICE PORTAL</a>
            </div>

            <p style="color: #525659; font-size: 16px; margin-top: 25px;">
              Thank you,<br/>
              <strong>${aircraft.main_contact || 'Skyward Operations'}</strong>
              ${aircraft.main_contact_phone ? `<br/>${aircraft.main_contact_phone}` : ''}
            </p>
          </div>
        `
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

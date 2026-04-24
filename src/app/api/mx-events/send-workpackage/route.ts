import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { emailShell, heading, paragraph, callout, sectionHeading, bulletList, button } from '@/lib/email/layout';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const body = await req.json();
    const { eventId, additionalMxItemIds, additionalSquawkIds, addonServices, proposedDate } = body;
    const isResend = body.resend === true;

    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required.' }, { status: 400 });
    }

    // Fetch the event — reject if the owner already soft-deleted it.
    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events').select('*').eq('id', eventId).is('deleted_at', null).maybeSingle();

    if (evErr || !event) {
      return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
    }

    // Verify the user has access to this aircraft
    await requireAircraftAdmin(supabaseAdmin, user.id, event.aircraft_id);

    // For initial sends, only drafts are allowed. For resends, any active status is fine.
    if (!isResend && event.status !== 'draft') {
      return NextResponse.json({ error: 'Only draft events can be sent. Use resend for active events.' }, { status: 400 });
    }

    if (isResend && (event.status === 'complete' || event.status === 'cancelled')) {
      return NextResponse.json({ error: 'Cannot resend completed or cancelled events.' }, { status: 400 });
    }

    await setAppUser(supabaseAdmin, user.id);

    // Fetch aircraft for email content
    const { data: aircraft } = await supabaseAdmin
      .from('aft_aircraft').select('*').eq('id', event.aircraft_id).single();

    if (!aircraft) {
      return NextResponse.json({ error: 'Aircraft not found.' }, { status: 404 });
    }

    // Add additional items (only for initial send, not resend).
    // All three categories are accumulated into a single insert batch
    // so a mid-sequence failure (say, squawks insert after mx insert
    // succeeded) can't leave the event with a partial line-item set.
    if (!isResend) {
      const allLineItems: any[] = [];

      if (additionalMxItemIds && additionalMxItemIds.length > 0) {
        const { data: mxItems } = await supabaseAdmin
          .from('aft_maintenance_items').select('*').in('id', additionalMxItemIds);

        // Scope check: every id the caller passed must belong to this
        // event's aircraft. Without this, an admin on aircraft A could
        // splice aircraft B's items into A's work package by id.
        if (mxItems && mxItems.some((mx: any) => mx.aircraft_id !== event.aircraft_id)) {
          return NextResponse.json(
            { error: 'All maintenance items must belong to this aircraft.' },
            { status: 400 },
          );
        }

        if (mxItems) {
          for (const mx of mxItems) {
            // 'both' items carry both a time and a date interval (e.g.
            // annuals: due at hours OR on date, whichever first). Send
            // both dimensions to the mechanic so the work package
            // reflects the actual trigger, not just one side.
            const itemDescription = (() => {
              if (mx.tracking_type === 'time') return `Due at ${mx.due_time} hrs`;
              if (mx.tracking_type === 'date') return `Due on ${mx.due_date}`;
              const bits: string[] = [];
              if (mx.due_time != null) bits.push(`at ${mx.due_time} hrs`);
              if (mx.due_date != null) bits.push(`on ${mx.due_date}`);
              return bits.length === 2 ? `Due ${bits.join(' or ')} (whichever first)` : bits[0] ? `Due ${bits[0]}` : 'Not yet scheduled';
            })();
            allLineItems.push({
              event_id: eventId,
              item_type: 'maintenance',
              maintenance_item_id: mx.id,
              item_name: mx.item_name,
              item_description: itemDescription,
            });
          }
        }
      }

      if (additionalSquawkIds && additionalSquawkIds.length > 0) {
        const { data: squawks } = await supabaseAdmin
          .from('aft_squawks').select('*').in('id', additionalSquawkIds);

        if (squawks && squawks.some((sq: any) => sq.aircraft_id !== event.aircraft_id)) {
          return NextResponse.json(
            { error: 'All squawks must belong to this aircraft.' },
            { status: 400 },
          );
        }

        if (squawks) {
          for (const sq of squawks) {
            allLineItems.push({
              event_id: eventId,
              item_type: 'squawk',
              squawk_id: sq.id,
              item_name: sq.description ? `Squawk: ${sq.description}` : `Squawk: ${sq.location || 'No description'}`,
              item_description: sq.affects_airworthiness && sq.location ? `Grounded at ${sq.location}` : (sq.description || null),
            });
          }
        }
      }

      if (addonServices && addonServices.length > 0) {
        for (const service of addonServices) {
          allLineItems.push({
            event_id: eventId,
            item_type: 'addon',
            item_name: service,
            item_description: null,
          });
        }
      }

      if (allLineItems.length > 0) {
        const { error: liErr } = await supabaseAdmin.from('aft_event_line_items').insert(allLineItems);
        if (liErr) throw liErr;
      }
      // NOTE: the status flip to 'scheduling' and the proposed-date
      // message row used to happen right here — they now fire AFTER
      // the mechanic email successfully sends, so a failed email
      // leaves the event as a draft the pilot can retry instead of
      // stuck in 'scheduling' with no mechanic notified.
    }

    // Send the work package email to the mechanic. Draft stays a
    // draft until the email actually succeeds — a failed Resend call
    // returns a 502 here so the pilot retries instead of seeing the
    // event flip to "scheduling" with no mechanic ever notified.
    if (!aircraft.mx_contact_email) {
      return NextResponse.json(
        { error: 'No mechanic email on file for this aircraft. Add one in Aircraft Settings before sending a work package.' },
        { status: 400 },
      );
    }
    if (aircraft.mx_contact_email) {
      const portalUrl = `${new URL(req.url).origin}/service/${event.access_token}`;
      const mxCc = aircraft.main_contact_email ? [aircraft.main_contact_email] : [];

      // Fetch ALL line items
      const { data: allLineItems } = await supabaseAdmin
        .from('aft_event_line_items').select('*').eq('event_id', eventId);

      // Sanitize all user-provided values
      const safeTail = escapeHtml(aircraft.tail_number);
      const safeType = escapeHtml(aircraft.aircraft_type);
      const safeMxContact = escapeHtml(aircraft.mx_contact);
      const safeMainContact = escapeHtml(aircraft.main_contact || 'Skyward Operations');
      const safeMainPhone = escapeHtml(aircraft.main_contact_phone);

      const mxLines = (allLineItems || [])
        .filter((li: any) => li.item_type === 'maintenance')
        .map((li: any) => `<strong>${escapeHtml(li.item_name)}</strong>${li.item_description ? ` — ${escapeHtml(li.item_description)}` : ''}`);

      const squawkLines = (allLineItems || [])
        .filter((li: any) => li.item_type === 'squawk')
        .map((li: any) => `<strong>${escapeHtml(li.item_name)}</strong>${li.item_description ? ` — ${escapeHtml(li.item_description)}` : ''}`);

      const addonLines = (allLineItems || [])
        .filter((li: any) => li.item_type === 'addon')
        .map((li: any) => escapeHtml(li.item_name));

      const effectiveDate = proposedDate || event.proposed_date;
      const dateSection = effectiveDate
        ? callout(`<strong>Requested Service Date:</strong> ${escapeHtml(effectiveDate)}`, { variant: 'info' })
        : paragraph(`No preferred date on our end. Propose dates that work for your shop, along with the estimated service duration.`);

      const subjectPrefix = isResend ? 'Reminder — ' : '';

      const totalItems = mxLines.length + squawkLines.length + addonLines.length;
      const preheader = `Work package for ${safeTail}: ${totalItems} item${totalItems === 1 ? '' : 's'}${effectiveDate ? `, requested ${escapeHtml(effectiveDate)}` : ''}. Reply via portal link.`;

      const signature = `
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #E5E7EB;font-size:14px;line-height:1.6;color:#374151;">
          Thank you,<br />
          <strong>${safeMainContact}</strong>
          ${safeMainPhone ? `<br />${safeMainPhone}` : ''}
        </div>
      `;

      const emailResult = await resend.emails.send({
        from: `Skyward Operations <${FROM_EMAIL}>`,
        replyTo: aircraft.main_contact_email || undefined,
        to: [aircraft.mx_contact_email],
        cc: mxCc,
        subject: `${subjectPrefix}Service Request: ${safeTail} — Work Package`,
        html: emailShell({
          title: `Service Request — ${safeTail}`,
          preheader,
          body: `
            ${heading('Service Request')}
            ${paragraph(`Hello ${safeMxContact || 'there'},`)}
            ${paragraph(`We'd like to schedule service for <strong>${safeTail}</strong> (${safeType}). Below is the full work package.`)}
            ${dateSection}
            ${mxLines.length > 0 ? `${sectionHeading('Maintenance Items Due', 'warning')}${bulletList(mxLines)}` : ''}
            ${squawkLines.length > 0 ? `${sectionHeading('Squawks / Discrepancies', 'danger')}${bulletList(squawkLines)}` : ''}
            ${addonLines.length > 0 ? `${sectionHeading('Additional Services Requested', 'note')}${bulletList(addonLines)}` : ''}
            ${button(portalUrl, 'Open Service Portal')}
            ${signature}
          `,
        }),
      });
      if (emailResult.error) {
        // Email gateway rejected the send. Don't flip status; let the
        // pilot retry from the draft.
        return NextResponse.json(
          { error: `Couldn't deliver the work package to the mechanic (${emailResult.error.message}). Your draft is unchanged — try again in a moment.` },
          { status: 502 },
        );
      }
    }

    // Email landed. Now it's safe to flip the draft to 'scheduling'
    // and record the proposed-date message. Resends skip this because
    // they started from a non-draft state.
    if (!isResend) {
      const eventUpdate: any = {
        status: 'scheduling',
        addon_services: addonServices || event.addon_services || [],
      };
      if (proposedDate) {
        eventUpdate.proposed_date = proposedDate;
        eventUpdate.proposed_by = 'owner';
      } else {
        eventUpdate.proposed_by = 'owner';
        eventUpdate.proposed_date = null;
      }
      await supabaseAdmin.from('aft_maintenance_events').update(eventUpdate).eq('id', eventId);

      if (proposedDate) {
        await supabaseAdmin.from('aft_event_messages').insert({
          event_id: eventId,
          sender: 'owner',
          message_type: 'propose_date',
          proposed_date: proposedDate,
          message: `Requesting service on ${proposedDate}.`,
        } as any);
      } else {
        await supabaseAdmin.from('aft_event_messages').insert({
          event_id: eventId,
          sender: 'owner',
          message_type: 'status_update',
          message: 'Work package sent. Requesting mechanic availability — no preferred date specified.',
        } as any);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { checkEmailRateLimit } from '@/lib/submitRateLimit';
import { setAppUser } from '@/lib/audit';
import { idempotency } from '@/lib/idempotency';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { emailShell, heading, paragraph, callout, sectionHeading, bulletList, button } from '@/lib/email/layout';
import { getAppUrl } from '@/lib/email/appUrl';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

// Leading-edge throttle: first add within a window emails the mechanic
// immediately; subsequent adds within this many ms are silent (the
// owner still sees each add live in the in-app activity rail). A
// trailing-edge true debounce would need a cron, which we skip in favor
// of this lighter model.
const ADD_ITEMS_EMAIL_THROTTLE_MS = 5 * 60 * 1000;

const ACTIVE_STATUSES = ['scheduling', 'confirmed', 'in_progress'] as const;

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    const idem = idempotency(supabaseAdmin, user.id, req, 'mx-events/add-items');
    const cached = await idem.check();
    if (cached) return cached;

    const body = await req.json();
    const { eventId, mxItemIds = [], squawkIds = [], addonServices = [] } = body || {};

    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required.' }, { status: 400 });
    }
    const newItemTotal =
      (Array.isArray(mxItemIds) ? mxItemIds.length : 0) +
      (Array.isArray(squawkIds) ? squawkIds.length : 0) +
      (Array.isArray(addonServices) ? addonServices.length : 0);
    if (newItemTotal === 0) {
      return NextResponse.json({ error: 'Pick at least one item to add.' }, { status: 400 });
    }

    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events')
      .select('*')
      .eq('id', eventId)
      .is('deleted_at', null)
      .maybeSingle();
    if (evErr || !event) {
      return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
    }
    if (!ACTIVE_STATUSES.includes(event.status)) {
      return NextResponse.json(
        { error: `Items can only be added to active events. This event is ${event.status}.` },
        { status: 409 },
      );
    }

    await requireAircraftAdmin(supabaseAdmin, user.id, event.aircraft_id);
    await setAppUser(supabaseAdmin, user.id);

    // Insert MX item line rows, scoped to the event's aircraft so a
    // fabricated cross-aircraft id can't be attached.
    let insertedNames: string[] = [];
    if (Array.isArray(mxItemIds) && mxItemIds.length > 0) {
      const { data: mxRows, error: mxErr } = await supabaseAdmin
        .from('aft_maintenance_items')
        .select('id, item_name, tracking_type, due_time, due_date')
        .in('id', mxItemIds)
        .eq('aircraft_id', event.aircraft_id)
        .is('deleted_at', null);
      if (mxErr) throw mxErr;
      if ((mxRows || []).length > 0) {
        const inserts = (mxRows || []).map((mx: any) => ({
          event_id: eventId,
          item_type: 'maintenance',
          maintenance_item_id: mx.id,
          item_name: mx.item_name,
          item_description: mx.tracking_type === 'time'
            ? `Due at ${mx.due_time} hrs`
            : `Due on ${mx.due_date}`,
        }));
        const { error: insErr } = await supabaseAdmin.from('aft_event_line_items').insert(inserts);
        if (insErr) throw insErr;
        insertedNames.push(...(mxRows || []).map((m: any) => m.item_name));
      }
    }

    if (Array.isArray(squawkIds) && squawkIds.length > 0) {
      const { data: sqRows, error: sqErr } = await supabaseAdmin
        .from('aft_squawks')
        .select('id, description, location, affects_airworthiness')
        .in('id', squawkIds)
        .eq('aircraft_id', event.aircraft_id)
        .is('deleted_at', null);
      if (sqErr) throw sqErr;
      if ((sqRows || []).length > 0) {
        const inserts = (sqRows || []).map((sq: any) => ({
          event_id: eventId,
          item_type: 'squawk',
          squawk_id: sq.id,
          item_name: sq.description && sq.description !== ''
            ? `Squawk: ${sq.description}`
            : `Squawk: ${sq.location || 'No description'}`,
          item_description: sq.affects_airworthiness && sq.location
            ? `Grounded at ${sq.location}`
            : sq.description || null,
        }));
        const { error: insErr } = await supabaseAdmin.from('aft_event_line_items').insert(inserts);
        if (insErr) throw insErr;
        insertedNames.push(...(sqRows || []).map((s: any) => s.description || 'Squawk'));
      }
    }

    if (Array.isArray(addonServices) && addonServices.length > 0) {
      const inserts = (addonServices as string[]).map(name => ({
        event_id: eventId,
        item_type: 'addon',
        item_name: name,
        item_description: null,
      }));
      const { error: addonErr } = await supabaseAdmin.from('aft_event_line_items').insert(inserts);
      if (addonErr) throw addonErr;
      insertedNames.push(...(addonServices as string[]));

      // Mirror the addon names onto the event's addon_services column so
      // future work-package emails (resend, mechanic reminders) include
      // them in the bullet list. The line items are the source of truth
      // but the email helpers historically read addon_services.
      const merged = Array.from(new Set([...(event.addon_services || []), ...addonServices]));
      const { error: addonUpdErr } = await supabaseAdmin
        .from('aft_maintenance_events')
        .update({ addon_services: merged })
        .eq('id', eventId)
        .is('deleted_at', null);
      if (addonUpdErr) throw addonUpdErr;
    }

    // Activity-rail entry — visible to the owner in-app immediately, and
    // (if the mechanic logs into the portal before the throttle window
    // closes) visible to the mechanic too.
    const namesPreview = insertedNames.slice(0, 5).join(', ');
    const extras = insertedNames.length > 5 ? ` and ${insertedNames.length - 5} more` : '';
    const { error: msgErr } = await supabaseAdmin.from('aft_event_messages').insert({
      event_id: eventId,
      sender: 'owner',
      message_type: 'status_update',
      message: `Owner added ${insertedNames.length} item${insertedNames.length === 1 ? '' : 's'} to the work package: ${namesPreview}${extras}.`,
    } as any);
    if (msgErr) throw msgErr;

    // Throttle the mechanic notification. Skip the email if we sent one
    // within the throttle window; the owner still sees their add land
    // in the activity rail. last_add_items_email_at is checked on the
    // ROW we already pulled to avoid a TOCTOU re-read.
    let emailSent = false;
    let emailSkippedReason: 'throttled' | 'no_email' | 'rate_limited' | null = null;
    const lastEmailAt = event.last_add_items_email_at ? new Date(event.last_add_items_email_at).getTime() : 0;
    const withinThrottle = lastEmailAt && (Date.now() - lastEmailAt) < ADD_ITEMS_EMAIL_THROTTLE_MS;
    if (withinThrottle) {
      emailSkippedReason = 'throttled';
    } else if (!event.mx_contact_email) {
      emailSkippedReason = 'no_email';
    } else {
      const rl = await checkEmailRateLimit(supabaseAdmin, user.id);
      if (!rl.allowed) {
        emailSkippedReason = 'rate_limited';
      } else {
        const { data: aircraft } = await supabaseAdmin
          .from('aft_aircraft').select('tail_number, aircraft_type, main_contact, main_contact_email').eq('id', event.aircraft_id).single();
        const safeTail = escapeHtml(aircraft?.tail_number || '');
        const safeType = escapeHtml(aircraft?.aircraft_type || '');
        const safeMxContact = escapeHtml(event.mx_contact_name || '');
        const safeMainContact = escapeHtml(aircraft?.main_contact || 'Skyward Operations');

        const portalUrl = `${getAppUrl(req)}/service/${event.access_token}`;
        const addedBullets = insertedNames.map(n => escapeHtml(n));

        const emailResult = await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          replyTo: aircraft?.main_contact_email || undefined,
          to: [event.mx_contact_email],
          subject: `Added to ${safeTail}: ${insertedNames.length} new item${insertedNames.length === 1 ? '' : 's'}`,
          html: emailShell({
            title: `Updated Work Package — ${safeTail}`,
            preheader: `${insertedNames.length} new item${insertedNames.length === 1 ? '' : 's'} added to ${safeTail}.`,
            body: `
              ${heading('Updated Work Package')}
              ${paragraph(`Hello ${safeMxContact || 'there'},`)}
              ${paragraph(`The owner added ${insertedNames.length} item${insertedNames.length === 1 ? '' : 's'} to the work package for <strong>${safeTail}</strong>${safeType ? ` (${safeType})` : ''}.`)}
              ${sectionHeading('New items', 'note')}
              ${bulletList(addedBullets)}
              ${callout('Open the portal to see the full updated work package and reply if anything is unworkable.', { variant: 'info' })}
              ${button(portalUrl, 'Open Service Portal')}
              ${paragraph(`— ${safeMainContact}`)}
            `,
          }),
        });
        if (emailResult.error) {
          // Don't roll back the inserts here — the items are visible to
          // the owner in-app and to the mechanic via the portal. A
          // failed mechanic email surfaces as a toast on the owner side
          // so they can fall back to a phone call.
          emailSkippedReason = 'rate_limited';
        } else {
          emailSent = true;
          const { error: stampErr } = await supabaseAdmin
            .from('aft_maintenance_events')
            .update({ last_add_items_email_at: new Date().toISOString() })
            .eq('id', eventId)
            .is('deleted_at', null);
          if (stampErr) throw stampErr;
        }
      }
    }

    const responseBody = {
      success: true,
      addedCount: insertedNames.length,
      emailSent,
      emailSkippedReason,
    };
    await idem.save(200, responseBody);
    return NextResponse.json(responseBody);
  } catch (error) {
    return handleApiError(error, req);
  }
}

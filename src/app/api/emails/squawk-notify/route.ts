import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';
import { checkEmailRateLimit } from '@/lib/submitRateLimit';
import { idempotency } from '@/lib/idempotency';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { emailShell, heading, paragraph, callout, button, keyValueBlock } from '@/lib/email/layout';
import { getAppUrl } from '@/lib/email/appUrl';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    // Idempotency before rate-limit so a network-blip retry doesn't
    // burn the user's email budget on a request the server already
    // serviced. The client sends the same X-Idempotency-Key for the
    // initial send and any client-driven retry within 1 hour; a
    // deliberate "Resend" press uses a fresh key so it really does
    // re-send. Without this a dropped 200 made the pilot retry,
    // every assigned pilot got the squawk email twice, and the
    // mechanic too — exactly the duplicate-notification scenario the
    // audit flagged.
    const idem = idempotency(supabaseAdmin, user.id, req, 'emails/squawk-notify/POST');
    const cached = await idem.check();
    if (cached) return cached;

    const rl = await checkEmailRateLimit(supabaseAdmin, user.id);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many email notifications. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.` },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const { squawk, aircraft, notifyMx } = await req.json();

    if (!squawk || !aircraft) {
      return NextResponse.json({ error: 'Squawk and aircraft data are required.' }, { status: 400 });
    }

    if (aircraft.id) {
      await requireAircraftAccess(supabaseAdmin, user.id, aircraft.id);
    }

    // Re-fetch the squawk row to close a delete-then-notify race. If
    // the reporter deleted the squawk between create and the notify
    // fan-out, the row is gone and both the mechanic and every assigned
    // pilot would get an email about a deleted squawk. Skip silently in
    // that case.
    if (squawk.id) {
      const { data: row, error: rowErr } = await supabaseAdmin
        .from('aft_squawks')
        .select('id, aircraft_id, deleted_at')
        .eq('id', squawk.id)
        .is('deleted_at', null)
        .maybeSingle();
      if (rowErr) throw rowErr;
      if (!row) {
        const body = { success: true, note: 'Squawk no longer exists' };
        await idem.save(200, body);
        return NextResponse.json(body);
      }
      if (row.aircraft_id !== aircraft.id) {
        return NextResponse.json({ error: 'Aircraft mismatch.' }, { status: 400 });
      }
    }

    const mainAppUrl = getAppUrl(req);

    // Sanitize all user-provided values for email HTML
    const safeTail = escapeHtml(aircraft.tail_number);
    const safeMxContact = escapeHtml(aircraft.mx_contact);
    const safeMainContact = escapeHtml(aircraft.main_contact || 'Skyward Operations');
    const safeMainPhone = escapeHtml(aircraft.main_contact_phone);
    const safeMainEmail = escapeHtml(aircraft.main_contact_email);
    const safeLocation = escapeHtml(squawk.location);
    const safeDescription = escapeHtml(squawk.description);
    const safeInitials = escapeHtml(squawk.reporter_initials || 'a pilot');

    // 1. EMAIL TO MECHANIC (only if reporter checked "Notify MX?")
    //    Wrapped in its own try/catch so a Resend hiccup or bad
    //    mx_contact_email doesn't bubble up and prevent the assigned-
    //    pilot alert below from going out.
    let mxSendOk = true;
    let pilotsSendOk = true;
    if (notifyMx && aircraft.mx_contact_email) {
      const mxCc = aircraft.main_contact_email ? [aircraft.main_contact_email] : [];
      const squawkUrl = `${mainAppUrl}/squawk/${squawk.access_token}`;
      const statusBadge = squawk.affects_airworthiness
        ? `<span style="color:#CE3732;font-weight:700;">AOG / GROUNDED</span>`
        : 'Monitor';

      const signature = `
        <div class="sw-paragraph" style="margin-top:20px;padding-top:16px;border-top:1px solid #E5E7EB;font-size:14px;line-height:1.6;color:#091F3C;">
          Thank you,<br />
          <strong>${safeMainContact}</strong>
          ${safeMainPhone ? `<br />${safeMainPhone}` : ''}
          ${safeMainEmail ? `<br /><a href="mailto:${safeMainEmail}" style="color:#091F3C;text-decoration:underline;">${safeMainEmail}</a>` : ''}
        </div>
      `;

      try {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [aircraft.mx_contact_email],
          cc: mxCc,
          replyTo: aircraft.main_contact_email || undefined,
          subject: `Service Request: ${safeTail} Squawk`,
          html: emailShell({
            title: `Service Request: ${safeTail}`,
            preheader: `New squawk on ${safeTail} — ${squawk.affects_airworthiness ? 'aircraft is grounded' : 'monitor and schedule when able'}.`,
            body: `
              ${heading('Service Request')}
              ${paragraph(`Hello ${safeMxContact || 'there'},`)}
              ${paragraph(`A new squawk was reported for <strong>${safeTail}</strong>. Let us know when you can accommodate this aircraft to address the issue.`)}
              ${callout(
                keyValueBlock([
                  { label: 'Location', value: safeLocation },
                  { label: 'Status', value: statusBadge },
                  { label: 'Description', value: safeDescription },
                ]),
                { variant: squawk.affects_airworthiness ? 'danger' : 'warning', label: 'Squawk Details' }
              )}
              ${button(squawkUrl, 'View Full Report')}
              ${signature}
            `,
          }),
        });
      } catch (mxErr) {
        console.error('[squawk-notify] mechanic email failed', mxErr);
        mxSendOk = false;
      }
    }

    // 2. INTERNAL ALERT — All assigned pilots (operational awareness)
    //    Includes the reporter when they're an assigned pilot — they
    //    asked for a confirmation copy on their own squawks via the
    //    "New Squawks" preference, and a single-pilot owner testing
    //    their setup needs to see the email actually went out.
    //    Notification preferences still apply per-pilot.
    // Throw on each lookup error — a silent fallthrough turns the
    // assigned-pilot alert path into a no-op with a 200 response.
    const { data: access, error: accessErr } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('user_id')
      .eq('aircraft_id', aircraft.id);
    if (accessErr) throw accessErr;

    if (access && access.length > 0) {
      const assignedUserIds = access.map(a => a.user_id);

      if (assignedUserIds.length > 0) {
        // Check notification preferences — filter out users who disabled squawk_reported
        const { data: disabledPrefs, error: disabledErr } = await supabaseAdmin
          .from('aft_notification_preferences')
          .select('user_id')
          .in('user_id', assignedUserIds)
          .eq('notification_type', 'squawk_reported')
          .eq('enabled', false);
        if (disabledErr) throw disabledErr;

        const disabledUserIds = new Set((disabledPrefs || []).map(p => p.user_id));
        const eligibleUserIds = assignedUserIds.filter(uid => !disabledUserIds.has(uid));

        if (eligibleUserIds.length > 0) {
          const { data: assignedUsers, error: assignedErr } = await supabaseAdmin
            .from('aft_user_roles')
            .select('email')
            .in('user_id', eligibleUserIds);
          if (assignedErr) throw assignedErr;

          const recipients = assignedUsers
            ?.map(u => u.email)
            .filter(Boolean) as string[] || [];
          const dedupedRecipients = Array.from(new Set(recipients));

          if (dedupedRecipients.length > 0) {
            // Wrap in try/catch so a Resend hiccup on the assigned-pilot
            // fan-out doesn't 500 the route and bypass the idempotency
            // cache write — without the cache write, the client's
            // network-blip retry would re-email the mechanic (whose
            // send already succeeded). The pilotsSendFailed flag lets
            // the caller decide whether to surface a "retry alert" UX.
            try {
              await resend.emails.send({
                from: `Skyward Alerts <${FROM_EMAIL}>`,
                to: dedupedRecipients,
                subject: `New Squawk: ${safeTail}`,
                html: emailShell({
                  title: `New Squawk: ${safeTail}`,
                  preheader: `${safeInitials} reported a squawk on ${safeTail}${squawk.affects_airworthiness ? ' — aircraft is grounded' : ''}.`,
                  body: `
                    ${heading('New Squawk', squawk.affects_airworthiness ? 'danger' : 'warning')}
                    ${paragraph(`A new squawk was reported on <strong>${safeTail}</strong> by <strong>${safeInitials}</strong>.`)}
                    ${callout(
                      keyValueBlock([
                        { label: 'Location', value: safeLocation },
                        { label: 'Grounded', value: squawk.affects_airworthiness ? `<span style="color:#CE3732;font-weight:700;">Yes</span>` : 'No' },
                        { label: 'Description', value: safeDescription },
                      ]),
                      { variant: squawk.affects_airworthiness ? 'danger' : 'warning', label: 'Squawk Details' }
                    )}
                    ${button(mainAppUrl, 'Open Skyward')}
                  `,
                  preferencesUrl: `${mainAppUrl}#settings`,
                }),
              });
            } catch (pilotsErr) {
              console.error('[squawk-notify] pilots fan-out failed', pilotsErr);
              pilotsSendOk = false;
            }
          }
        }
      }
    }

    // mxSendFailed lets the client flag mx_notify_failed independently
    // of the pilot-alert path. Returning 200 even on a partial failure
    // keeps the assigned-pilot alert a best-effort no-toast path while
    // still letting the reporter see the "MX not notified — resend?"
    // badge when they explicitly asked to email the mechanic.
    const responseBody = {
      success: true,
      mxSendFailed: notifyMx && !mxSendOk,
      pilotsSendFailed: !pilotsSendOk,
    };
    await idem.save(200, responseBody);
    return NextResponse.json(responseBody);
  } catch (error) {
    return handleApiError(error);
  }
}

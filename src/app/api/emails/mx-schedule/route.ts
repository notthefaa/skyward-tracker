import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';
import { checkEmailRateLimit } from '@/lib/submitRateLimit';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { emailShell, heading, paragraph, callout, keyValueBlock } from '@/lib/email/layout';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    const rl = await checkEmailRateLimit(supabaseAdmin, user.id);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many email notifications. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.` },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const { aircraft, mxItem } = await req.json();

    if (!aircraft || !mxItem) {
      return NextResponse.json({ error: 'Aircraft and maintenance item data are required.' }, { status: 400 });
    }

    // Verify the user has access to this aircraft
    if (aircraft.id) {
      await requireAircraftAccess(supabaseAdmin, user.id, aircraft.id);
    }

    if (aircraft.mx_contact_email) {
      const mxCc = aircraft.main_contact_email ? [aircraft.main_contact_email] : [];

      // Sanitize user-provided values
      const safeTail = escapeHtml(aircraft.tail_number);
      const safeMxContact = escapeHtml(aircraft.mx_contact);
      const safeMainContact = escapeHtml(aircraft.main_contact || 'Skyward Operations');
      const safeMainPhone = escapeHtml(aircraft.main_contact_phone);
      const safeMainEmail = escapeHtml(aircraft.main_contact_email);
      const safeItemName = escapeHtml(mxItem.item_name);

      const dueString = mxItem.tracking_type === 'time'
        ? `at ${escapeHtml(String(mxItem.due_time))} hours`
        : `on ${escapeHtml(mxItem.due_date)}`;

      const signature = `
        <div class="sw-paragraph" style="margin-top:20px;padding-top:16px;border-top:1px solid #E5E7EB;font-size:14px;line-height:1.6;color:#091F3C;">
          Thank you,<br />
          <strong>${safeMainContact}</strong>
          ${safeMainPhone ? `<br />${safeMainPhone}` : ''}
          ${safeMainEmail ? `<br /><a href="mailto:${safeMainEmail}" style="color:#091F3C;text-decoration:underline;">${safeMainEmail}</a>` : ''}
        </div>
      `;

      await resend.emails.send({
        from: `Skyward Maintenance <${FROM_EMAIL}>`,
        to: [aircraft.mx_contact_email],
        cc: mxCc,
        replyTo: aircraft.main_contact_email || undefined,
        subject: `Scheduling Request: ${safeTail} Maintenance`,
        html: emailShell({
          title: `Scheduling Request: ${safeTail}`,
          preheader: `${safeItemName} coming due ${dueString} on ${safeTail}.`,
          body: `
            ${heading('Scheduling Request')}
            ${paragraph(`Hello ${safeMxContact || 'there'},`)}
            ${paragraph(`The following maintenance item is coming due for <strong>${safeTail}</strong>. Let us know when you can fit this aircraft into your schedule.`)}
            ${callout(
              keyValueBlock([
                { label: 'Item', value: safeItemName },
                { label: 'Due', value: dueString },
              ]),
              { variant: 'warning' }
            )}
            ${paragraph('Reply to this email to coordinate scheduling.')}
            ${signature}
          `,
        }),
      });

      // Update the database to clear the manual trigger button.
      // Scope the update to the verified aircraft so a caller can't
      // flip mx_schedule_sent on another aircraft's item by id.
      await supabaseAdmin
        .from('aft_maintenance_items')
        .update({ mx_schedule_sent: true })
        .eq('id', mxItem.id)
        .eq('aircraft_id', aircraft.id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

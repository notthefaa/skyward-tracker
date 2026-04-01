import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
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

      await resend.emails.send({
        from: `Skyward Maintenance <${FROM_EMAIL}>`,
        to: [aircraft.mx_contact_email],
        cc: mxCc,
        replyTo: aircraft.main_contact_email || undefined,
        subject: `Scheduling Request: ${safeTail} Maintenance`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
            <h2 style="color: #091F3C; text-transform: uppercase; letter-spacing: 2px; border-bottom: 2px solid #091F3C; padding-bottom: 10px;">Skyward Society</h2>
            <p style="color: #525659; font-size: 16px;">Hello ${safeMxContact || ''},</p>
            <p style="color: #525659; font-size: 16px;">The following maintenance item is coming due for <strong>${safeTail}</strong>. Please let us know when you are able to add this aircraft to your schedule.</p>
            
            <div style="background-color: #FDFCF4; padding: 20px; border-left: 4px solid #F08B46; margin: 25px 0; border-radius: 4px;">
              <p style="margin: 0 0 10px 0; color: #091F3C; font-size: 18px;"><strong>Item:</strong> ${safeItemName}</p>
              <p style="margin: 0; color: #091F3C; font-size: 16px;"><strong>Due:</strong> ${dueString}</p>
            </div>

            <p style="color: #525659; font-size: 16px;">Please reply to this email to coordinate scheduling.</p>

            <p style="color: #525659; font-size: 16px; margin-top: 20px;">
              Thank you,<br/>
              <strong>${safeMainContact}</strong>
              ${safeMainPhone ? `<br/>${safeMainPhone}` : ''}
              ${safeMainEmail ? `<br/><a href="mailto:${safeMainEmail}" style="color: #091F3C;">${safeMainEmail}</a>` : ''}
            </p>
          </div>
        `
      });

      // Update the database to clear the manual trigger button
      await supabaseAdmin.from('aft_maintenance_items').update({ mx_schedule_sent: true }).eq('id', mxItem.id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

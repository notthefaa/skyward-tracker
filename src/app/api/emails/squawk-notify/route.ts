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
    const { squawk, aircraft, notifyMx } = await req.json();

    if (!squawk || !aircraft) {
      return NextResponse.json({ error: 'Squawk and aircraft data are required.' }, { status: 400 });
    }

    if (aircraft.id) {
      await requireAircraftAccess(supabaseAdmin, user.id, aircraft.id);
    }

    const mainAppUrl = process.env.NEXT_PUBLIC_MAIN_APP_URL || new URL(req.url).origin;

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
    if (notifyMx && aircraft.mx_contact_email) {
      const mxCc = aircraft.main_contact_email ? [aircraft.main_contact_email] : [];

      const mxGreeting = safeMxContact
        ? `<p style="margin-bottom: 20px;">Hello ${safeMxContact},</p>`
        : `<p style="margin-bottom: 20px;">Hello,</p>`;

      const mxSignature = `
        <p style="margin-top: 20px;">
          Thank you,<br/>
          <strong>${safeMainContact}</strong><br/>
          ${safeMainPhone ? `${safeMainPhone}<br/>` : ''}
          ${safeMainEmail ? `<a href="mailto:${safeMainEmail}" style="color: #333333;">${safeMainEmail}</a>` : ''}
        </p>
      `;

      await resend.emails.send({
        from: `Skyward Operations <${FROM_EMAIL}>`,
        to: [aircraft.mx_contact_email],
        cc: mxCc,
        replyTo: aircraft.main_contact_email || undefined,
        subject: `Service Request: ${safeTail} Squawk`,
        html: `
          <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6; max-width: 600px;">
            ${mxGreeting}
            
            <p>A new squawk was reported for ${safeTail}. Let us know when you can accommodate this aircraft to address the issue.</p>
            
            <p style="margin-top: 20px;"><strong>Squawk Details:</strong><br/>
            Location: ${safeLocation}<br/>
            Status: ${squawk.affects_airworthiness ? 'AOG / GROUNDED' : 'Monitor'}<br/>
            Description: ${safeDescription}</p>
            
            <p style="margin-top: 20px;">View the full report and attached photos here:<br/>
            <a href="${mainAppUrl}/squawk/${squawk.access_token}">${mainAppUrl}/squawk/${squawk.access_token}</a></p>
            
            ${mxSignature}
          </div>
        `
      });
    }

    // 2. INTERNAL ALERT — All assigned pilots (operational awareness)
    //    Excludes the reporter and respects notification preferences
    const { data: access } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('user_id')
      .eq('aircraft_id', aircraft.id);

    if (access && access.length > 0) {
      const otherUserIds = access
        .map(a => a.user_id)
        .filter(uid => uid !== user.id);

      if (otherUserIds.length > 0) {
        // Check notification preferences — filter out users who disabled squawk_reported
        const { data: disabledPrefs } = await supabaseAdmin
          .from('aft_notification_preferences')
          .select('user_id')
          .in('user_id', otherUserIds)
          .eq('notification_type', 'squawk_reported')
          .eq('enabled', false);

        const disabledUserIds = new Set((disabledPrefs || []).map(p => p.user_id));
        const eligibleUserIds = otherUserIds.filter(uid => !disabledUserIds.has(uid));

        if (eligibleUserIds.length > 0) {
          const { data: assignedUsers } = await supabaseAdmin
            .from('aft_user_roles')
            .select('email')
            .in('user_id', eligibleUserIds);

          const recipients = assignedUsers
            ?.map(u => u.email)
            .filter(Boolean) as string[] || [];
          const dedupedRecipients = Array.from(new Set(recipients));

          if (dedupedRecipients.length > 0) {
            await resend.emails.send({
              from: `Skyward Alerts <${FROM_EMAIL}>`,
              to: dedupedRecipients,
              subject: `New Squawk: ${safeTail}`,
              html: `
                <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6; max-width: 600px;">
                  <p>A new squawk was reported on ${safeTail} by ${safeInitials}.</p>
                  
                  <p style="margin-top: 20px;"><strong>Squawk Details:</strong><br/>
                  Location: ${safeLocation}<br/>
                  Grounded: ${squawk.affects_airworthiness ? 'YES' : 'NO'}<br/>
                  Description: ${safeDescription}</p>
                  
                  <div style="margin-top: 25px; text-align: center;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 0 auto;">
                      <tr>
                        <td style="background-color: #091F3C; border-radius: 6px; text-align: center;">
                          <a href="${mainAppUrl}" target="_blank" style="display: inline-block; background-color: #091F3C; color: #ffffff; text-decoration: none; padding: 14px 32px; font-family: Arial, sans-serif; font-weight: bold; font-size: 14px; letter-spacing: 1px; border-radius: 6px; mso-padding-alt: 0; text-underline-color: #091F3C;">
                            <!--[if mso]><i style="mso-font-width:150%;mso-text-raise:21pt" hidden>&emsp;</i><![endif]-->
                            <span style="mso-text-raise:10pt;">OPEN AIRCRAFT MANAGER</span>
                            <!--[if mso]><i style="mso-font-width:150%;" hidden>&emsp;&#8203;</i><![endif]-->
                          </a>
                        </td>
                      </tr>
                    </table>
                  </div>
                </div>
              `
            });
          }
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

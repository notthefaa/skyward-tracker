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
    const { note, aircraft } = await req.json();

    if (!note || !aircraft) {
      return NextResponse.json({ error: 'Note and aircraft data are required.' }, { status: 400 });
    }

    if (aircraft.id) {
      await requireAircraftAccess(supabaseAdmin, user.id, aircraft.id);
    }

    // Get all assigned pilots except the author
    const { data: access } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('user_id')
      .eq('aircraft_id', aircraft.id);

    if (!access || access.length === 0) {
      return NextResponse.json({ success: true, note: 'No other users to notify' });
    }

    const otherUserIds = access
      .map(a => a.user_id)
      .filter(uid => uid !== user.id);

    if (otherUserIds.length === 0) {
      return NextResponse.json({ success: true, note: 'No other users to notify' });
    }

    // Check notification preferences — filter out users who disabled note_posted
    const { data: disabledPrefs } = await supabaseAdmin
      .from('aft_notification_preferences')
      .select('user_id')
      .in('user_id', otherUserIds)
      .eq('notification_type', 'note_posted')
      .eq('enabled', false);

    const disabledUserIds = new Set((disabledPrefs || []).map(p => p.user_id));
    const eligibleUserIds = otherUserIds.filter(uid => !disabledUserIds.has(uid));

    if (eligibleUserIds.length === 0) {
      return NextResponse.json({ success: true, note: 'All recipients have disabled note notifications' });
    }

    const { data: assignedUsers } = await supabaseAdmin
      .from('aft_user_roles')
      .select('email')
      .in('user_id', eligibleUserIds);

    const recipients = assignedUsers
      ?.map(u => u.email)
      .filter(Boolean) as string[] || [];
    const dedupedRecipients = Array.from(new Set(recipients));

    const mainAppUrl = process.env.NEXT_PUBLIC_MAIN_APP_URL || new URL(req.url).origin;

    if (dedupedRecipients.length > 0) {
      // Sanitize user-provided content
      const safeAuthor = escapeHtml(note.author_initials || 'A pilot');
      const safeTail = escapeHtml(aircraft.tail_number);
      const contentPreview = escapeHtml(
        note.content.length > 200 ? note.content.substring(0, 200) + '...' : note.content
      );
      const hasPhotos = note.pictures && note.pictures.length > 0;

      await resend.emails.send({
        from: `Skyward Alerts <${FROM_EMAIL}>`,
        to: dedupedRecipients,
        subject: `New Note: ${safeTail}`,
        html: `
          <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6; max-width: 600px;">
            <p>${safeAuthor} posted a note on ${safeTail}.</p>
            
            <div style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-left: 4px solid #091F3C; border-radius: 4px;">
              <p style="margin: 0; white-space: pre-wrap;">${contentPreview}</p>
              ${hasPhotos ? `<p style="margin-top: 10px; color: #666; font-size: 12px;">${note.pictures.length} photo${note.pictures.length > 1 ? 's' : ''} attached</p>` : ''}
            </div>
            
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

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

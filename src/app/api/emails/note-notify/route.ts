import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';
import { env } from '@/lib/env';

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

    const { data: assignedUsers } = await supabaseAdmin
      .from('aft_user_roles')
      .select('email')
      .in('user_id', otherUserIds);

    const recipients = assignedUsers
      ?.map(u => u.email)
      .filter(Boolean) as string[] || [];
    const dedupedRecipients = Array.from(new Set(recipients));

    if (dedupedRecipients.length > 0) {
      const authorLabel = note.author_initials || 'A pilot';
      const contentPreview = note.content.length > 200
        ? note.content.substring(0, 200) + '...'
        : note.content;
      const hasPhotos = note.pictures && note.pictures.length > 0;

      await resend.emails.send({
        from: `Skyward Alerts <${FROM_EMAIL}>`,
        to: dedupedRecipients,
        subject: `New Note: ${aircraft.tail_number}`,
        html: `
          <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6; max-width: 600px;">
            <p>${authorLabel} posted a note on ${aircraft.tail_number}.</p>
            
            <div style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-left: 4px solid #091F3C; border-radius: 4px;">
              <p style="margin: 0; white-space: pre-wrap;">${contentPreview}</p>
              ${hasPhotos ? `<p style="margin-top: 10px; color: #666; font-size: 12px;">${note.pictures.length} photo${note.pictures.length > 1 ? 's' : ''} attached</p>` : ''}
            </div>
            
            <div style="margin-top: 25px; text-align: center;">
              <a href="${new URL(req.url).origin}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; letter-spacing: 1px;">OPEN AIRCRAFT MANAGER</a>
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

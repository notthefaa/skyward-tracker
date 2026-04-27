import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';
import { checkEmailRateLimit } from '@/lib/submitRateLimit';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { emailShell, heading, paragraph, callout, button } from '@/lib/email/layout';

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

      // Preserve the note's line breaks inside the callout; escape-
      // then-replace-newlines is safe because escapeHtml never emits
      // `\n`, so we can't accidentally inject a <br> into a raw angle
      // bracket.
      const noteHtml = contentPreview.replace(/\n/g, '<br />');
      const photoNote = hasPhotos
        ? `<div class="sw-callout-muted" style="margin-top:10px;font-size:12px;color:#091F3C;">${note.pictures.length} photo${note.pictures.length > 1 ? 's' : ''} attached</div>`
        : '';

      await resend.emails.send({
        from: `Skyward Alerts <${FROM_EMAIL}>`,
        to: dedupedRecipients,
        subject: `New Note: ${safeTail}`,
        html: emailShell({
          title: `New Note: ${safeTail}`,
          preheader: `${safeAuthor} posted a note on ${safeTail}.`,
          body: `
            ${heading('New Note')}
            ${paragraph(`<strong>${safeAuthor}</strong> posted a note on <strong>${safeTail}</strong>.`)}
            ${callout(`${noteHtml}${photoNote}`, { variant: 'info' })}
            ${button(mainAppUrl, 'Open Skyward')}
          `,
          preferencesUrl: `${mainAppUrl}#settings`,
        }),
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

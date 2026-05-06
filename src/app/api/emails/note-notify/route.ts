import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';
import { checkEmailRateLimit } from '@/lib/submitRateLimit';
import { idempotency } from '@/lib/idempotency';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { emailShell, heading, paragraph, callout, button } from '@/lib/email/layout';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    // Idempotency before rate-limit so a network-blip retry doesn't
    // burn the user's email budget on a request the server already
    // serviced. Same pattern as squawk-notify — without this, a
    // dropped 200 sends the same note email to every assigned pilot
    // twice.
    const idem = idempotency(supabaseAdmin, user.id, req, 'emails/note-notify/POST');
    const cached = await idem.check();
    if (cached) return cached;

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

    // Get all assigned pilots except the author. Throw on read errors
    // so a transient supabase blip can't silently turn into "no other
    // users to notify" — which returns a 200 success and skips every
    // pilot's note alert.
    const { data: access, error: accessErr } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('user_id')
      .eq('aircraft_id', aircraft.id);
    if (accessErr) throw accessErr;

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
    const { data: disabledPrefs, error: disabledErr } = await supabaseAdmin
      .from('aft_notification_preferences')
      .select('user_id')
      .in('user_id', otherUserIds)
      .eq('notification_type', 'note_posted')
      .eq('enabled', false);
    if (disabledErr) throw disabledErr;

    const disabledUserIds = new Set((disabledPrefs || []).map(p => p.user_id));
    const eligibleUserIds = otherUserIds.filter(uid => !disabledUserIds.has(uid));

    if (eligibleUserIds.length === 0) {
      return NextResponse.json({ success: true, note: 'All recipients have disabled note notifications' });
    }

    const { data: assignedUsers, error: assignedErr } = await supabaseAdmin
      .from('aft_user_roles')
      .select('email')
      .in('user_id', eligibleUserIds);
    if (assignedErr) throw assignedErr;

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

      // Wrapped in its own try/catch so a Resend hiccup doesn't bubble
      // to the route-level catch. The note row is already saved by the
      // time this route runs, so a Resend failure shouldn't propagate
      // a 500 the client interprets as "the note didn't save."
      try {
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
      } catch (sendErr) {
        console.error('[note-notify] resend send failed', sendErr);
      }
    }

    const responseBody = { success: true };
    await idem.save(200, responseBody);
    return NextResponse.json(responseBody);
  } catch (error) {
    return handleApiError(error);
  }
}

// =============================================================
// MX CALENDAR CONFLICT RESOLUTION
//
// When a maintenance event date is confirmed, this helper:
// 1. Finds all confirmed reservations that overlap the MX block
// 2. Cancels each overlapping reservation
// 3. Emails each affected pilot explaining the cancellation
//
// The MX block spans whole days: confirmed_date 00:00:00 through
// estimated_completion 23:59:59 (or confirmed_date + 1 day if
// no estimate is set).
// =============================================================

import { Resend } from 'resend';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { safeTimeZone, formatInTimeZone } from '@/lib/dateFormat';
import { emailShell, heading, paragraph, callout, bulletList, button } from '@/lib/email/layout';
import { loadMutedRecipients, isRecipientMuted } from '@/lib/notificationMutes';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

interface MxConflictParams {
  supabaseAdmin: any;
  aircraftId: string;
  confirmedDate: string;          // "YYYY-MM-DD"
  estimatedCompletion?: string | null; // "YYYY-MM-DD" or null
  tailNumber: string;
  mechanicName?: string | null;
  appUrl: string;
  timeZone?: string | null;       // IANA zone of the user triggering the cancellation
}

/**
 * Cancels reservations that overlap with a confirmed maintenance block
 * and notifies affected pilots via email.
 *
 * Returns the count of cancelled reservations.
 */
export async function cancelConflictingReservations({
  supabaseAdmin,
  aircraftId,
  confirmedDate,
  estimatedCompletion,
  tailNumber,
  mechanicName,
  appUrl,
  timeZone,
}: MxConflictParams): Promise<number> {
  const tz = safeTimeZone(timeZone);
  // Build the MX block range as a UTC whole-day window. Always use 'Z' so this
  // is independent of the host server's local TZ — reservations are stored as
  // ISO UTC and both sides of the overlap check must agree.
  const mxStart = new Date(confirmedDate + 'T00:00:00Z');
  const mxEnd = estimatedCompletion
    ? new Date(estimatedCompletion + 'T23:59:59.999Z')
    : new Date(mxStart.getTime() + 24 * 60 * 60 * 1000 - 1); // end of confirmed_date

  // Find confirmed reservations that overlap with the MX block.
  // Overlap condition: reservation.start_time < mxEnd AND reservation.end_time > mxStart.
  // Throw on read error: a swallowed failure here means the pilot
  // shows up at the airport for a reservation that should have been
  // cancelled because the plane went into maintenance.
  const { data: overlapping, error: overlapErr } = await supabaseAdmin
    .from('aft_reservations')
    .select('*')
    .eq('aircraft_id', aircraftId)
    .eq('status', 'confirmed')
    .lt('start_time', mxEnd.toISOString())
    .gt('end_time', mxStart.toISOString());
  if (overlapErr) throw overlapErr;

  if (!overlapping || overlapping.length === 0) return 0;

  // Cancel each overlapping reservation
  const reservationIds = overlapping.map((r: any) => r.id);
  const { error: cancelErr } = await supabaseAdmin
    .from('aft_reservations')
    .update({ status: 'cancelled' })
    .in('id', reservationIds);
  if (cancelErr) throw cancelErr;

  // Collect unique affected pilots (by user_id) and their reservation details
  const pilotMap: Record<string, { email?: string; reservations: any[] }> = {};

  for (const r of overlapping) {
    if (!r.user_id) continue;
    if (!pilotMap[r.user_id]) {
      pilotMap[r.user_id] = { reservations: [] };
    }
    pilotMap[r.user_id].reservations.push(r);
  }

  // Look up emails for all affected pilots
  const userIds = Object.keys(pilotMap);
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('aft_user_roles')
      .select('user_id, email')
      .in('user_id', userIds);

    if (users) {
      for (const u of users) {
        if (pilotMap[u.user_id]) pilotMap[u.user_id].email = u.email;
      }
    }
  }

  // Sanitize user-provided strings for email HTML
  const safeTailNumber = escapeHtml(tailNumber);
  const mechanicLabel = escapeHtml(mechanicName || 'the maintenance provider');

  // Format dates for display — force UTC so the label matches the YYYY-MM-DD
  // string the user entered instead of shifting with the server's local TZ.
  const labelOpts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
  const mxStartLabel = mxStart.toLocaleDateString('en-US', labelOpts);
  const mxEndLabel = estimatedCompletion
    ? new Date(estimatedCompletion + 'T00:00:00Z').toLocaleDateString('en-US', labelOpts)
    : mxStartLabel;
  const mxDateRange = mxStartLabel === mxEndLabel
    ? mxStartLabel
    : `${mxStartLabel} — ${mxEndLabel}`;

  // Honor reservation_cancelled mute preference. Pilots who opted out
  // of cancellation alerts shouldn't get fan-out from the MX block
  // path either — the explicit DELETE /reservations path gates the
  // same way. The reservation itself is already cancelled in the DB,
  // so the pilot sees it next time they open the app.
  const affectedEmails = userIds
    .map(uid => pilotMap[uid].email)
    .filter((e): e is string => !!e);
  const muted = affectedEmails.length > 0
    ? await loadMutedRecipients(supabaseAdmin, affectedEmails, 'reservation_cancelled')
    : new Set<string>();

  // Send a cancellation email to each affected pilot. Wrap each send so
  // one pilot's email failure (bounce, Resend outage, malformed address)
  // doesn't abort the loop — the reservations are already cancelled and
  // we still want to notify the other affected pilots.
  const emailFailures: string[] = [];
  for (const userId of userIds) {
    const pilot = pilotMap[userId];
    if (!pilot.email) continue;
    if (isRecipientMuted(pilot.email, muted)) continue;

    const reservationLines = pilot.reservations.map((r: any) => {
      // Prefer the booker's stored zone so the cancellation email reflects
      // the time as the pilot originally booked it, regardless of who triggered
      // the MX block. Falls back to the caller's tz for legacy rows.
      const rowTz = safeTimeZone(r.time_zone || tz);
      const start = formatInTimeZone(r.start_time, rowTz);
      const end = formatInTimeZone(r.end_time, rowTz);
      const safeTitle = r.title ? ` (${escapeHtml(r.title)})` : '';
      const safeRoute = r.route ? ` • ${escapeHtml(r.route)}` : '';
      return `${start} — ${end}${safeTitle}${safeRoute}`;
    });

    const plural = pilot.reservations.length > 1;
    try {
      await resend.emails.send({
        from: `Skyward Alerts <${FROM_EMAIL}>`,
        to: [pilot.email],
        subject: `Reservation Cancelled: ${safeTailNumber} — Maintenance Scheduled`,
        html: emailShell({
          title: `Reservation Cancelled — ${safeTailNumber}`,
          preheader: `Your ${safeTailNumber} reservation${plural ? 's' : ''} ${plural ? 'have' : 'has'} been cancelled: maintenance scheduled ${mxDateRange}.`,
          body: `
            ${heading('Reservation Cancelled', 'danger')}
            ${paragraph(`Your reservation${plural ? 's' : ''} for <strong>${safeTailNumber}</strong> ${plural ? 'have' : 'has'} been automatically cancelled due to scheduled maintenance.`)}
            ${callout(bulletList(reservationLines), { variant: 'danger', label: `Cancelled Reservation${plural ? 's' : ''}` })}
            ${callout(
              `<strong>${mxDateRange}</strong><div class="sw-paragraph" style="margin-top:4px;font-size:13px;">Serviced by ${mechanicLabel}</div>`,
              { variant: 'warning', label: 'Maintenance Period' }
            )}
            ${paragraph(`Rebook your flight for after the maintenance period. Sorry for the inconvenience.`)}
            ${button(appUrl, 'Open Skyward')}
          `,
          preferencesUrl: `${appUrl}#settings`,
        }),
      });
    } catch (err: any) {
      emailFailures.push(`${pilot.email}: ${err?.message || 'unknown'}`);
    }
  }

  if (emailFailures.length > 0) {
    console.warn(
      `[mxConflicts] Cancelled ${overlapping.length} reservation(s) for ${tailNumber} but ${emailFailures.length} pilot email(s) failed:`,
      emailFailures,
    );
  }

  return overlapping.length;
}

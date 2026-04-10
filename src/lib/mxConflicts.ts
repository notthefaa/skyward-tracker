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
  // Build the MX block range (whole days, midnight to midnight)
  const mxStart = new Date(confirmedDate + 'T00:00:00');
  const mxEnd = estimatedCompletion
    ? new Date(estimatedCompletion + 'T23:59:59.999')
    : new Date(mxStart.getTime() + 24 * 60 * 60 * 1000 - 1); // end of confirmed_date

  // Find confirmed reservations that overlap with the MX block.
  // Overlap condition: reservation.start_time < mxEnd AND reservation.end_time > mxStart
  const { data: overlapping } = await supabaseAdmin
    .from('aft_reservations')
    .select('*')
    .eq('aircraft_id', aircraftId)
    .eq('status', 'confirmed')
    .lt('start_time', mxEnd.toISOString())
    .gt('end_time', mxStart.toISOString());

  if (!overlapping || overlapping.length === 0) return 0;

  // Cancel each overlapping reservation
  const reservationIds = overlapping.map((r: any) => r.id);
  await supabaseAdmin
    .from('aft_reservations')
    .update({ status: 'cancelled' })
    .in('id', reservationIds);

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

  // Format dates for display
  const mxStartLabel = mxStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const mxEndLabel = estimatedCompletion
    ? new Date(estimatedCompletion + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : mxStartLabel;
  const mxDateRange = mxStartLabel === mxEndLabel
    ? mxStartLabel
    : `${mxStartLabel} — ${mxEndLabel}`;

  // Send a cancellation email to each affected pilot
  for (const userId of userIds) {
    const pilot = pilotMap[userId];
    if (!pilot.email) continue;

    const reservationLines = pilot.reservations.map((r: any) => {
      // Prefer the booker's stored zone so the cancellation email reflects
      // the time as the pilot originally booked it, regardless of who triggered
      // the MX block. Falls back to the caller's tz for legacy rows.
      const rowTz = safeTimeZone(r.time_zone || tz);
      const start = formatInTimeZone(r.start_time, rowTz);
      const end = formatInTimeZone(r.end_time, rowTz);
      const safeTitle = r.title ? ` (${escapeHtml(r.title)})` : '';
      const safeRoute = r.route ? ` • ${escapeHtml(r.route)}` : '';
      return `<li style="margin-bottom: 8px;">${start} — ${end}${safeTitle}${safeRoute}</li>`;
    }).join('');

    await resend.emails.send({
      from: `Skyward Alerts <${FROM_EMAIL}>`,
      to: [pilot.email],
      subject: `Reservation Cancelled: ${safeTailNumber} — Maintenance Scheduled`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #CE3732;">Reservation Cancelled</h2>
          <p>Your reservation${pilot.reservations.length > 1 ? 's' : ''} for <strong>${safeTailNumber}</strong> ${pilot.reservations.length > 1 ? 'have' : 'has'} been automatically cancelled due to scheduled maintenance.</p>
          
          <div style="margin: 20px 0; padding: 15px; background: #FEF2F2; border-left: 4px solid #CE3732; border-radius: 4px;">
            <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #CE3732;">Cancelled Reservation${pilot.reservations.length > 1 ? 's' : ''}</p>
            <ul style="margin: 0; padding-left: 16px; color: #333; font-size: 14px; line-height: 1.6;">${reservationLines}</ul>
          </div>

          <div style="margin: 20px 0; padding: 15px; background: #FFF7ED; border-left: 4px solid #F08B46; border-radius: 4px;">
            <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #F08B46;">Maintenance Period</p>
            <p style="margin: 0; color: #333; font-size: 14px;"><strong>${mxDateRange}</strong></p>
            <p style="margin: 4px 0 0 0; color: #666; font-size: 13px;">Serviced by ${mechanicLabel}</p>
          </div>

          <p style="color: #666; font-size: 14px;">Please rebook your flight for after the maintenance period. We apologize for the inconvenience.</p>

          <div style="margin-top: 25px; text-align: center;">
            <a href="${appUrl}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; letter-spacing: 1px;">OPEN AIRCRAFT MANAGER</a>
          </div>
        </div>
      `,
    });
  }

  return overlapping.length;
}

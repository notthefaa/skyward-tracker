/**
 * Shared cancellation-email fan-out for reservations.
 *
 * Extracted from `/api/reservations` DELETE so both the route AND
 * Howard's `reservation_cancel` executor produce the same outcome:
 *   1. Find every pilot with access to the aircraft (except the
 *      canceller).
 *   2. Drop those who muted reservation_cancelled emails.
 *   3. Fan out a single Resend email listing the cancelled slot.
 *
 * Pre-fix Howard-driven cancels only flipped the row to status='cancelled'
 * and skipped the fan-out — other pilots noticed via the calendar
 * disappearing instead of an email. With this helper both paths match.
 *
 * Designed to be FAIL-SOFT: any error inside this helper is logged but
 * doesn't reject the cancellation itself. Throwing here would undo the
 * caller's row update if it doesn't have its own try/catch — the caller
 * wraps and decides how to surface the email-fan-out failure.
 */
import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';
import { escapeHtml } from '@/lib/sanitize';
import { getAppUrl } from '@/lib/email/appUrl';
import { emailShell, heading, paragraph, button } from '@/lib/email/layout';
import { safeTimeZone, formatInTimeZone, formatShortDateInTimeZone } from '@/lib/dateFormat';

// Lazy-instantiate Resend so importing this helper doesn't trigger
// env validation at module load. The Howard test runner imports
// proposedActions.ts (which now imports this helper); without lazy
// init those tests fail at `Missing NEXT_PUBLIC_SUPABASE_URL` because
// `@/lib/env` validates every required var on first import.
const FROM_EMAIL = 'notifications@skywardsociety.com';
let _resend: Resend | null = null;
function resend(): Resend {
  if (!_resend) {
    // Read directly off process.env rather than importing `env` so a
    // missing key surfaces with a clear runtime error scoped to the
    // single email-fan-out call, not every consumer of this module.
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not set.');
    _resend = new Resend(key);
  }
  return _resend;
}

export interface CancelledReservation {
  id: string;
  aircraft_id: string;
  user_id: string;
  start_time: string;
  end_time?: string;
  time_zone?: string | null;
  pilot_name?: string | null;
}

export interface CancelEmailOptions {
  /** User to exclude from notifications — typically the canceller. */
  excludeUserId: string;
  /** Optional Request — used to resolve the app URL when env var is unset. */
  req?: Request;
  /** Fallback timezone if reservation has no stored zone. */
  fallbackTimeZone?: string;
}

export interface CancelEmailResult {
  /** Number of pilots emailed. */
  notified: number;
  /** Number of recipients dropped because they muted the notification. */
  muted: number;
  /** True when the helper completed without throwing. False signals the
   *  caller should log + carry on (the cancellation itself already
   *  succeeded — losing the email is recoverable). */
  ok: boolean;
}

/**
 * Send the "Reservation Cancelled" email to other assigned pilots.
 * Caller has already flipped the row to status='cancelled'.
 */
export async function sendReservationCancelledEmail(
  sb: SupabaseClient,
  reservation: CancelledReservation,
  opts: CancelEmailOptions,
): Promise<CancelEmailResult> {
  try {
    const { data: aircraft, error: acReadErr } = await sb
      .from('aft_aircraft')
      .select('tail_number')
      .eq('id', reservation.aircraft_id)
      .single();
    if (acReadErr) throw acReadErr;

    const { data: assignedUsers, error: assignedErr } = await sb
      .from('aft_user_aircraft_access')
      .select('user_id')
      .eq('aircraft_id', reservation.aircraft_id)
      .neq('user_id', opts.excludeUserId);
    if (assignedErr) throw assignedErr;

    if (!assignedUsers || assignedUsers.length === 0 || !aircraft) {
      return { notified: 0, muted: 0, ok: true };
    }

    const userIds = assignedUsers.map((u: any) => u.user_id);

    const { data: mutedUsers, error: mutedErr } = await sb
      .from('aft_notification_preferences')
      .select('user_id')
      .in('user_id', userIds)
      .eq('notification_type', 'reservation_cancelled')
      .eq('enabled', false);
    if (mutedErr) throw mutedErr;

    const mutedIds = new Set((mutedUsers || []).map((u: any) => u.user_id));
    const notifyIds = userIds.filter((id: string) => !mutedIds.has(id));

    if (notifyIds.length === 0) {
      return { notified: 0, muted: mutedIds.size, ok: true };
    }

    const { data: notifyUsers, error: notifyUsersErr } = await sb
      .from('aft_user_roles')
      .select('email')
      .in('user_id', notifyIds);
    if (notifyUsersErr) throw notifyUsersErr;

    const emails = (notifyUsers || []).map((u: any) => u.email).filter(Boolean) as string[];

    if (emails.length === 0) {
      return { notified: 0, muted: mutedIds.size, ok: true };
    }

    // Prefer the booker's stored zone so an admin in a different zone
    // cancelling on someone's behalf still shows the original local time.
    const displayTz = safeTimeZone(reservation.time_zone || opts.fallbackTimeZone || 'UTC');
    const startStr = formatInTimeZone(reservation.start_time, displayTz);

    const safeTail = escapeHtml(aircraft.tail_number);
    const safePilotName = reservation.pilot_name ? escapeHtml(reservation.pilot_name) : '';

    const appUrl = getAppUrl(opts.req);

    await resend().emails.send({
      from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
      to: emails,
      subject: `${safeTail} Reservation Cancelled: ${formatShortDateInTimeZone(reservation.start_time, displayTz)}`,
      html: emailShell({
        title: `${safeTail} Reservation Cancelled`,
        preheader: `Reservation on ${safeTail} for ${startStr} has been cancelled.`,
        body: `
          ${heading('Reservation Cancelled', 'danger')}
          ${paragraph(`A reservation for <strong>${safeTail}</strong> on <strong>${startStr}</strong> has been cancelled.`)}
          ${safePilotName ? paragraph(`Originally booked by: ${safePilotName}`) : ''}
          ${button(appUrl, 'Open Skyward')}
        `,
        preferencesUrl: `${appUrl}#settings`,
      }),
    });

    return { notified: emails.length, muted: mutedIds.size, ok: true };
  } catch (err) {
    console.error('[reservationCancel] email fan-out failed:', (err as any)?.message || err);
    return { notified: 0, muted: 0, ok: false };
  }
}

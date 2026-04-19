// =============================================================
// TIMEZONE-AWARE DATE FORMATTING
//
// Used for rendering reservation times in email notifications.
// Server-side `toLocaleString()` defaults to the host's system
// timezone (UTC on most cloud hosts), which produces times that
// don't match what the booker saw in their browser. These helpers
// always format in an explicit IANA zone and include the zone
// abbreviation so recipients can interpret times unambiguously.
// =============================================================

const FALLBACK_TZ = 'UTC';

/**
 * Validate an IANA timezone string. Falls back to UTC if missing
 * or unrecognized so a bad client value never crashes the email send.
 */
export function safeTimeZone(tz: unknown): string {
  if (typeof tz !== 'string' || !tz) return FALLBACK_TZ;
  try {
    // Will throw RangeError if tz is not a recognized IANA zone
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return FALLBACK_TZ;
  }
}

/**
 * Format an ISO timestamp as e.g. "Apr 15, 2026, 8:00 AM PDT" in
 * the supplied IANA timezone. Always includes the zone abbreviation.
 */
export function formatInTimeZone(iso: string | Date, tz: string): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  return date.toLocaleString('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Format just the time portion, e.g. "8:00 AM PDT".
 */
export function formatTimeInTimeZone(iso: string | Date, tz: string): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  return date.toLocaleString('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Format the weekday + date portion, e.g. "Wed, Apr 15".
 */
export function formatDateInTimeZone(iso: string | Date, tz: string): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  return date.toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format just the calendar date, no weekday — e.g. "Apr 15, 2026".
 * Used for email subject lines.
 */
export function formatShortDateInTimeZone(iso: string | Date, tz: string): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  return date.toLocaleDateString('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Convert a `YYYY-MM-DD` date string plus an IANA zone into the UTC
 * Date that represents midnight of that calendar day in that zone.
 *
 * `new Date('2026-04-19T00:00:00Z')` returns UTC midnight, which is
 * wrong for a date-only block that the pilot saved in UTC+12 (their
 * local midnight is 12 hours earlier in UTC). Instead we render the
 * midnight in the target zone and back out what UTC time produced it.
 *
 * Returns `null` for malformed input so callers can decide between
 * a hard fail and falling back to UTC parsing.
 */
export function zonedDateStartAsUtc(dateOnly: string, tz: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) return null;
  const [, yStr, mStr, dStr] = match;
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  // Start from the UTC-midnight guess, then figure out what wall-clock
  // time that resolves to in the target zone. The delta between that
  // wall clock and the requested one is the offset to apply.
  const utcGuess = Date.UTC(year, month - 1, day);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcGuess));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const resolvedYear = get('year');
  const resolvedMonth = get('month');
  const resolvedDay = get('day');
  const resolvedHour = get('hour') === 24 ? 0 : get('hour');
  const resolvedMinute = get('minute');
  const resolvedSecond = get('second');
  const resolvedUtc = Date.UTC(resolvedYear, resolvedMonth - 1, resolvedDay, resolvedHour, resolvedMinute, resolvedSecond);
  const offsetMs = resolvedUtc - utcGuess;
  return new Date(utcGuess - offsetMs);
}

/** End of that calendar day in the zone = next day's start minus 1ms. */
export function zonedDateEndAsUtc(dateOnly: string, tz: string): Date | null {
  const start = zonedDateStartAsUtc(dateOnly, tz);
  if (!start) return null;
  return new Date(start.getTime() + 86_400_000 - 1);
}

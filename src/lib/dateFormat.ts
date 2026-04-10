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

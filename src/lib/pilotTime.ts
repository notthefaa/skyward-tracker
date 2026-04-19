// =============================================================
// Pilot-TZ-aware date math
// =============================================================
// Server-side code (cron, Howard airworthiness tools, email
// templates) runs on Vercel's UTC runtime. A MX item due
// "2026-04-20" compared to `new Date()` on a server executing
// at 2026-04-20 06:59 UTC returns "0 days left", but the pilot
// in PDT still perceives it as 2026-04-19 and expects
// "1 day left". This helper lets server paths key "today" off
// the aircraft's stored `time_zone` instead.
//
// Client-side code doesn't need these — the browser's `new Date`
// already runs in the pilot's local zone.
// =============================================================

/**
 * Return "today" as YYYY-MM-DD in the given IANA timezone.
 * Falls back to UTC if the zone is invalid (Intl throws RangeError
 * on bad timezone strings, which would otherwise 500 the cron).
 */
export function todayInZone(timeZone: string | null | undefined): string {
  const tz = timeZone && timeZone.trim() ? timeZone : 'UTC';
  try {
    // en-CA happens to format as YYYY-MM-DD with zero-padded parts —
    // cheaper and more portable than assembling it from separate
    // year/month/day formatters.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}

/**
 * Whole calendar-days between `dueDate` (YYYY-MM-DD) and today in the
 * given timezone. Positive = future, negative = past, 0 = today.
 *
 * Returns `Infinity` if `dueDate` is null/empty. Returns NaN for
 * unparseable input — callers should treat that as "no date tracked".
 */
export function daysUntilDate(
  dueDate: string | null | undefined,
  timeZone: string | null | undefined,
): number {
  if (!dueDate) return Infinity;
  const today = todayInZone(timeZone);
  const dueMs = Date.parse(dueDate + 'T00:00:00Z');
  const todayMs = Date.parse(today + 'T00:00:00Z');
  if (!Number.isFinite(dueMs) || !Number.isFinite(todayMs)) return NaN;
  return Math.round((dueMs - todayMs) / 86_400_000);
}

/**
 * Is `dueDate` before "today" in the given timezone?
 * Returns `false` for null/empty — "not tracked" isn't "expired".
 */
export function isDateExpiredInZone(
  dueDate: string | null | undefined,
  timeZone: string | null | undefined,
): boolean {
  if (!dueDate) return false;
  const n = daysUntilDate(dueDate, timeZone);
  return Number.isFinite(n) && n < 0;
}

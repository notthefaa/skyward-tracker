/**
 * Tight ISO calendar-date check (YYYY-MM-DD). Rejects garbage strings,
 * nonexistent dates ("2025-02-30"), and non-string input. Use at API
 * boundaries before passing a user-supplied date string to Date() or
 * into the DB — `new Date("banana")` silently produces Invalid Date,
 * and downstream .toISOString() / interval math then throws or drifts.
 */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  // Round-trip guard so "2025-02-30" → normalized "2025-03-02" fails.
  return d.toISOString().slice(0, 10) === s;
}

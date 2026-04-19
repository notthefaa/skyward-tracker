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

/**
 * Parse a client-supplied value as a finite number. Treats empty string,
 * null, and undefined as "absent" (returns null). Rejects NaN / ±Infinity
 * and out-of-range values.
 *
 * Why this isn't just `parseFloat`: `parseFloat("Infinity")` returns
 * `Infinity`, which sails past `Number.isNaN` and into the DB, poisoning
 * downstream math (hours projection, tolerance comparisons, etc.).
 *
 *  - Returns `null` when `value` is absent (allowing optional fields).
 *  - Returns a `number` when `value` parses to a finite number within
 *    the optional [min, max] bounds.
 *  - Returns `undefined` when the input is present but invalid — callers
 *    should reject the request with a 400.
 */
export function parseFiniteNumber(
  value: unknown,
  opts: { min?: number; max?: number } = {},
): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return undefined;
  if (opts.min !== undefined && num < opts.min) return undefined;
  if (opts.max !== undefined && num > opts.max) return undefined;
  return num;
}

/**
 * Build a clean row object by copying only the allow-listed keys from a
 * raw client payload. Blocks mass-assignment attacks — a client that
 * slips extra keys (`deleted_at`, `primary_heads_up_sent`, `created_by`,
 * etc.) into an insert payload can't bypass business rules that happen
 * to live in columns the UI doesn't expose.
 *
 * Returns a new object; never mutates the source.
 */
export function pickAllowedFields<T extends Record<string, unknown>>(
  payload: unknown,
  allowed: readonly (keyof T)[],
): Partial<T> {
  if (!payload || typeof payload !== 'object') return {};
  const src = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    const k = key as string;
    if (k in src) out[k] = src[k];
  }
  return out as Partial<T>;
}

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
 * ISO datetime check — `YYYY-MM-DDTHH:MM[:SS[.sss]]` with a timezone
 * suffix (`Z` or `±HH:MM`). Used for reservation start/end times where
 * the DB column is `timestamptz`; passing a bare date would silently
 * write midnight-UTC and produce wrong local-time reservations.
 */
export function isIsoDateTime(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  // Shape check keeps garbage strings out; Date() handles the rest.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
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

/**
 * Strip server-owned fields from a client-supplied insert/update
 * payload. Use on routes where the legitimate-field surface is wide
 * (squawks, notes, etc.) and a full whitelist would rot faster than
 * the schema evolves. Blacklist covers the attack vectors:
 *   - `id` → reassignment
 *   - `aircraft_id` → cross-aircraft migration via PUT
 *   - `reported_by` / `author_id` / `created_by` → authorship spoof
 *   - `deleted_at` / `deleted_by` → silent un-delete
 *   - `created_at` / `updated_at` → timestamp forgery
 *
 * Returns a new object; never mutates the source. Callers should then
 * spread in the authoritative values they control (aircraft_id from
 * the URL param, reported_by from the authenticated user) so the
 * explicit value wins over any residual client field.
 */
// Universal-protected fields (anything that would let the client
// forge identity, ownership, or audit trail). Per-table extras live
// in TABLE_PROTECTED below — when a route calls stripProtectedFields
// it should pass the table key so the right extras are applied.
const BASE_PROTECTED: ReadonlySet<string> = new Set([
  'id', 'aircraft_id',
  'reported_by', 'author_id', 'created_by',
  'deleted_at', 'deleted_by',
  'created_at', 'updated_at',
]);

// Per-table protected fields. Each entry adds to BASE_PROTECTED.
// Extending this map is the *only* place a new server-managed
// column needs to be locked down — every PUT route that goes
// through stripProtectedFields(payload, 'tableKey') picks up the
// new entry automatically.
const TABLE_PROTECTED: Record<string, ReadonlySet<string>> = {
  // Squawks: status / event linkage / token / notify-failed flag are
  // all driven by server flows (work-package completion, the
  // 047 token-rotate trigger, the squawk-notify route). A pilot
  // PUTting them directly should not be able to fake a resolve, link
  // their squawk to an arbitrary event, or rotate the mechanic
  // access token to bypass an emailed link.
  squawks: new Set([
    'status',
    'resolved_at', 'resolved_by',
    'resolved_by_event_id',
    'access_token',
    'mx_notify_failed',
  ]),
  // Equipment: removed_at is the hide marker. Letting the client PUT
  // removed_at = null silently un-removes (resurrects) gear without
  // an audit-trail operation — whatever `removed_at` records about
  // who/when is gone. Reinstatement should be its own endpoint.
  equipment: new Set([
    'removed_at', 'removed_by',
  ]),
  // ADs: source / supersession / sync metadata / applicability are
  // all managed by the DRS sync + Haiku drill-down flows. Manually
  // PUTting `source: 'drs_sync'` on a manual record would confuse
  // the next sync's prune step; PUTting applicability_status
  // bypasses the drill-down.
  ads: new Set([
    'source',
    'is_superseded', 'superseded_by',
    'synced_at', 'sync_hash',
    'applicability_status', 'applicability_reason', 'applicability_checked_at',
  ]),
};

/**
 * Drop server-managed fields from a client payload before it's
 * spread into an INSERT / UPDATE.
 *
 * @param payload - the raw client body
 * @param table - optional table key for per-table extras (see
 *                TABLE_PROTECTED). Omit only on routes that have
 *                their own field discipline.
 */
export function stripProtectedFields<T extends Record<string, unknown>>(
  payload: unknown,
  table?: keyof typeof TABLE_PROTECTED,
): Partial<T> {
  if (!payload || typeof payload !== 'object') return {};
  const src = payload as Record<string, unknown>;
  const extra = table ? TABLE_PROTECTED[table] : undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (BASE_PROTECTED.has(k)) continue;
    if (extra && extra.has(k)) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

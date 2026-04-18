/**
 * Client-side idempotency key helper. Generate a UUID per form
 * submission and include it as the X-Idempotency-Key header via
 * authFetch. The server uses this to dedup double-taps.
 *
 * Usage:
 *   const key = newIdempotencyKey();
 *   await authFetch('/api/squawks', {
 *     method: 'POST',
 *     headers: idempotencyHeader(key),
 *     body: JSON.stringify(payload),
 *   });
 */

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function idempotencyHeader(key?: string): Record<string, string> {
  return key ? { 'X-Idempotency-Key': key } : {};
}

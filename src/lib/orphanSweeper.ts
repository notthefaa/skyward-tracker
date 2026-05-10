// Race window: a user can finish a storage upload at T=0, then commit
// the row insert (with the file's URL in `pictures`/`avatar_url`/etc.)
// at T=N. If the sweeper queries the active-URL set at T=K (K<N) and
// the storage list at T=K+ε, the file IS in the bucket but NOT in the
// active set — the sweeper would delete it under the user's feet.
//
// 10 min age gate is well over any plausible upload→row-insert window
// (a few seconds in practice). The sweeper runs daily, so a file that's
// still genuinely orphan tomorrow gets cleaned up on the next pass.
export const ORPHAN_SWEEP_MIN_AGE_MS = 10 * 60 * 1000;

/**
 * Returns true when the sweeper should DEFER deleting this file (skip
 * it this round). Pure; exported for unit testing.
 *
 *   - Missing/falsy `createdAt` → don't defer (legacy files without
 *     timestamps shouldn't escape sweep forever).
 *   - Malformed timestamp (Date.parse → NaN) → DEFER. Safer to skip a
 *     file we can't age-check than to wrongfully delete it.
 *   - Younger than minAgeMs → defer.
 *   - Older than minAgeMs → don't defer (sweep eligible).
 */
export function shouldDeferOrphanSweep(
  createdAt: string | null | undefined,
  now: number,
  minAgeMs: number,
): boolean {
  if (!createdAt) return false;
  const fileMs = new Date(createdAt).getTime();
  if (!Number.isFinite(fileMs)) return true;
  return now - fileMs < minAgeMs;
}

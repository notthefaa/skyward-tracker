import { describe, it, expect } from 'vitest';
import { shouldDeferOrphanSweep, ORPHAN_SWEEP_MIN_AGE_MS } from '../orphanSweeper';

/**
 * Orphan sweep age-gate. Used by /api/admin/db-health POST sweepBucket
 * to skip files that are too new — protecting against the
 * upload-then-DB-insert race where the file is in storage but the
 * referencing row hasn't landed yet.
 *
 * The wrong-direction risk is asymmetric:
 *   - false negative (treat new file as old) → wrongful delete during
 *     active upload. Bad. Tests must lock the new-file branch.
 *   - false positive (treat old file as new) → file lingers one extra
 *     day until next sweep. Fine.
 */
describe('shouldDeferOrphanSweep', () => {
  const NOW = Date.now();
  const MIN_AGE = ORPHAN_SWEEP_MIN_AGE_MS; // 10 min

  it('no createdAt → do not defer (legacy files must not escape sweep)', () => {
    expect(shouldDeferOrphanSweep(null, NOW, MIN_AGE)).toBe(false);
    expect(shouldDeferOrphanSweep(undefined, NOW, MIN_AGE)).toBe(false);
    expect(shouldDeferOrphanSweep('', NOW, MIN_AGE)).toBe(false);
  });

  it('file uploaded just now → defer', () => {
    const justNow = new Date(NOW - 1_000).toISOString(); // 1 s old
    expect(shouldDeferOrphanSweep(justNow, NOW, MIN_AGE)).toBe(true);
  });

  it('file at the boundary (exactly minAgeMs old) → don\'t defer', () => {
    // ageMs === minAgeMs falls into the `<` branch as false → not deferred.
    // Pad by 100 ms so the assertion is deterministic across the
    // wall-clock advance between Date.now() calls in the helper.
    const exactlyOld = new Date(NOW - MIN_AGE - 100).toISOString();
    expect(shouldDeferOrphanSweep(exactlyOld, NOW, MIN_AGE)).toBe(false);
  });

  it('file 5 min old → defer (within 10-min window)', () => {
    const fiveMinAgo = new Date(NOW - 5 * 60 * 1000).toISOString();
    expect(shouldDeferOrphanSweep(fiveMinAgo, NOW, MIN_AGE)).toBe(true);
  });

  it('file 1 hour old → don\'t defer', () => {
    const hourAgo = new Date(NOW - 60 * 60 * 1000).toISOString();
    expect(shouldDeferOrphanSweep(hourAgo, NOW, MIN_AGE)).toBe(false);
  });

  it('malformed timestamp → defer (safer than wrongful delete)', () => {
    expect(shouldDeferOrphanSweep('not-a-date', NOW, MIN_AGE)).toBe(true);
    expect(shouldDeferOrphanSweep('', NOW, MIN_AGE)).toBe(false); // falsy short-circuit
  });

  it('clock skew: file with future createdAt → defer (negative age < minAge)', () => {
    // If the storage clock is ahead of the route clock, age would be
    // negative. The `<` comparison makes negative ages defer (correct
    // direction — we don't want to delete files dated in the future).
    const future = new Date(NOW + 5 * 60 * 1000).toISOString();
    expect(shouldDeferOrphanSweep(future, NOW, MIN_AGE)).toBe(true);
  });
});

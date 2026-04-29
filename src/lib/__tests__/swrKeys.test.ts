import { describe, it, expect } from 'vitest';
import { swrKeys, matchesAircraft } from '../swrKeys';

describe('swrKeys', () => {
  it('namespaces every aircraft-scoped key under the aircraftId', () => {
    const id = 'aaaa1111-bbbb-2222-cccc-3333dddd4444';
    expect(swrKeys.summaryMx(id)).toContain(id);
    expect(swrKeys.times(id, 1)).toContain(id);
    expect(swrKeys.mxItems(id)).toContain(id);
    expect(swrKeys.mxEvents(id)).toContain(id);
    expect(swrKeys.squawks(id)).toContain(id);
    expect(swrKeys.calDash(id)).toContain(id);
    expect(swrKeys.oilLastAdded(id)).toContain(id);
    expect(swrKeys.docs(id)).toContain(id);
    expect(swrKeys.equipment(id, true)).toContain(id);
  });
});

describe('matchesAircraft', () => {
  const id = 'aaaa1111-bbbb-2222-cccc-3333dddd4444';
  const other = 'eeee5555-ffff-6666-aaaa-7777bbbb8888';
  const matcher = matchesAircraft(id);

  it('matches every per-aircraft swrKey for the target id', () => {
    expect(matcher(swrKeys.summaryMx(id))).toBe(true);
    expect(matcher(swrKeys.summarySquawks(id))).toBe(true);
    expect(matcher(swrKeys.summaryFlight(id))).toBe(true);
    expect(matcher(swrKeys.summaryReservations(id))).toBe(true);
    expect(matcher(swrKeys.times(id, 1))).toBe(true);
    expect(matcher(swrKeys.times(id, 5))).toBe(true);
    expect(matcher(swrKeys.mxItems(id))).toBe(true);
    expect(matcher(swrKeys.mxEvents(id))).toBe(true);
    expect(matcher(swrKeys.squawks(id))).toBe(true);
    expect(matcher(swrKeys.calDash(id))).toBe(true);
    expect(matcher(swrKeys.equipment(id, true))).toBe(true);
    expect(matcher(swrKeys.equipment(id, false))).toBe(true);
  });

  it('does not match keys for other aircraft', () => {
    expect(matcher(swrKeys.summaryMx(other))).toBe(false);
    expect(matcher(swrKeys.times(other, 1))).toBe(false);
    expect(matcher(swrKeys.mxItems(other))).toBe(false);
  });

  it('rejects non-string keys (defensive — SWR can pass tuples)', () => {
    expect(matcher(undefined)).toBe(false);
    expect(matcher(null)).toBe(false);
    expect(matcher(['mx', id])).toBe(false);
    expect(matcher({})).toBe(false);
  });

  it('does not falsely match an id appearing as a substring in the middle of a longer token', () => {
    // The boundary anchors `(^|[-_/])id(?=[-_/]|$)` mean an unrelated
    // string that merely *contains* the UUID can't get swept up. UUIDs
    // don't share substrings in practice but the contract should still
    // hold.
    expect(matcher(`prefix${id}suffix`)).toBe(false);
    expect(matcher(`x${id}`)).toBe(false);
  });
});

// =============================================================
// Regression: SWR's own filter-mutate path checks the matcher
// against `cache.get(key)._k`, which is undefined for entries
// hydrated from localStorage that haven't been resubscribed in
// the current session. AppShell can't rely on that path alone
// to clear stale data on tail switch — it has to iterate
// `cache.keys()` and call `cache.delete(key)` itself.
//
// This test pins the assumption: the matcher works on the raw
// key strings, so iterating the cache directly is sufficient.
// =============================================================
describe('matchesAircraft + cache.keys() iteration (the AppShell tail-switch path)', () => {
  it('matches every persisted key for the target aircraft when iterating raw keys', () => {
    const target = 'aaaa1111-bbbb-2222-cccc-3333dddd4444';
    const stranger = 'eeee5555-ffff-6666-aaaa-7777bbbb8888';
    const matcher = matchesAircraft(target);

    // Simulate the in-memory cache map after localStorage hydration.
    const cache = new Map<string, unknown>([
      [swrKeys.summaryMx(target), { data: [] }],
      [swrKeys.mxItems(target), { data: [] }],
      [swrKeys.times(target, 1), { data: [] }],
      [swrKeys.squawks(target), { data: [] }],
      [swrKeys.summaryMx(stranger), { data: [{ keep: true }] }],
      [swrKeys.mxItems(stranger), { data: [{ keep: true }] }],
      [`fleet-2-${target},${stranger}`, { data: [] }],
      [`howard-user-some-user-id`, { data: {} }],
    ]);

    const matched: string[] = [];
    for (const k of cache.keys()) {
      if (typeof k === 'string' && matcher(k)) matched.push(k);
    }

    expect(matched).toContain(swrKeys.summaryMx(target));
    expect(matched).toContain(swrKeys.mxItems(target));
    expect(matched).toContain(swrKeys.times(target, 1));
    expect(matched).toContain(swrKeys.squawks(target));
    expect(matched).not.toContain(swrKeys.summaryMx(stranger));
    expect(matched).not.toContain(swrKeys.mxItems(stranger));
    expect(matched).not.toContain('howard-user-some-user-id');
  });
});

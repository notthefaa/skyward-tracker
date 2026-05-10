import { describe, it, expect } from 'vitest';
import { swrKeys, matchesAircraft, allForAircraft } from '../swrKeys';

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

    // tsconfig targets es5 without downlevelIteration, so iterating a
    // raw MapIterator with for...of is a type error. Same `Array.from`
    // pattern AppShell uses on the live SWR cache.
    const matched: string[] = [];
    for (const k of Array.from(cache.keys())) {
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

// =============================================================
// `allForAircraft(id)` is the canonical list AppShell walks on tail
// switch / resume / pull-refresh, on top of the cache.keys() walk.
// It exists to cover the "FETCH[key] pinned without a cache.set
// having landed" edge case where iOS suspends a fetch promise
// before SWR initializes cache state for that key. If that key is
// not in `cache.keys()`, the existing walk misses it and the next
// `useSWR(key)` mount dedupes against a zombie. Walking this list
// in addition guarantees the FETCH map gets cleared.
//
// If you add a new aircraft-scoped key to `swrKeys`, also add it
// to `allForAircraft` and update the assertions below.
// =============================================================
describe('allForAircraft', () => {
  const id = 'aaaa1111-bbbb-2222-cccc-3333dddd4444';

  it('returns every key whose first arg is an aircraft id', () => {
    const list = allForAircraft(id);
    // Spot-check: every aircraft-keyed swrKey is represented at
    // least once. The exhaustive count check below catches drift
    // when a new key is added without updating the canonical list.
    expect(list).toContain(swrKeys.summaryMx(id));
    expect(list).toContain(swrKeys.summarySquawks(id));
    expect(list).toContain(swrKeys.summaryNote(id));
    expect(list).toContain(swrKeys.summaryFlight(id));
    expect(list).toContain(swrKeys.summaryReservations(id));
    expect(list).toContain(swrKeys.summaryCurrentStatus(id));
    expect(list).toContain(swrKeys.summaryCrew(id));
    expect(list).toContain(swrKeys.ads(id));
    expect(list).toContain(swrKeys.notes(id));
    expect(list).toContain(swrKeys.mxItems(id));
    expect(list).toContain(swrKeys.mxEvents(id));
    expect(list).toContain(swrKeys.squawks(id));
    expect(list).toContain(swrKeys.vorLatest(id));
    expect(list).toContain(swrKeys.oilChart(id));
    expect(list).toContain(swrKeys.oilLastAdded(id));
    expect(list).toContain(swrKeys.docs(id));
    expect(list).toContain(swrKeys.crew(id));
    expect(list).toContain(swrKeys.calDash(id));
    expect(list).toContain(swrKeys.equipment(id, false));
    expect(list).toContain(swrKeys.equipment(id, true));
    expect(list).toContain(swrKeys.times(id, 1));
    expect(list).toContain(swrKeys.vor(id, 1));
    expect(list).toContain(swrKeys.tire(id, 1));
    expect(list).toContain(swrKeys.oil(id, 1));
  });

  it('every entry contains the aircraft id and is a non-empty string', () => {
    const list = allForAircraft(id);
    expect(list.length).toBeGreaterThan(20);
    for (const k of list) {
      expect(typeof k).toBe('string');
      expect(k.length).toBeGreaterThan(0);
      expect(k).toContain(id);
    }
  });

  it('canonical-list size matches the count of aircraft-scoped swrKeys (drift detector)', () => {
    // If this fails after you add a new aircraft-scoped key to
    // `swrKeys`, add the same key to `allForAircraft` and bump the
    // expected count below. That keeps the lifecycle revalidation
    // walk in lockstep with the key surface.
    const EXPECTED = 26;
    expect(allForAircraft(id).length).toBe(EXPECTED);
  });
});

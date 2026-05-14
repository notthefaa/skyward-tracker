"use client";

import { useCallback } from "react";
import { useSWRConfig, type ScopedMutator } from "swr";
import { matchesAircraft, allForAircraft } from "@/lib/swrKeys";

// Aircraft-scoped SWR cache invalidator. Two SWR-internal traps to
// navigate when invalidating one aircraft:
//
//   (a) The filter form `globalMutate(matcher, ...)` runs the matcher
//       against `cache.get(key)._k`, which is undefined for entries
//       hydrated from localStorage but not yet resubscribed in this
//       session. Hydrated entries get skipped → tabs the user hasn't
//       visited yet on the destination aircraft keep their stale `[]`.
//
//   (b) SWR keeps an internal `FETCH[key]` map of in-flight requests.
//       When iOS suspends a fetch mid-flight (PWA backgrounded) the
//       promise hangs forever and `FETCH[key]` stays set. On resume
//       any `softRevalidate(WITH_DEDUPE)` sees the entry, decides a
//       request is "already in flight," and waits on the dead promise
//       instead of starting a fresh one. Pilots described this
//       exactly: data disappears, refresh hangs, switching aircraft
//       fixes it (because the new keys have no FETCH entry).
//       `cache.delete(key)` does NOT clear FETCH[key] — only mutate
//       does, and only on its non-filter path.
//
// Walk `cache.keys()` directly (bypasses (a)) and call single-arg
// `globalMutate(key)` per matched key (bypasses (b) — that path
// explicitly does `delete FETCH[key]; delete PRELOAD[key]` before
// triggering the revalidator). Default mode does NOT pass `undefined`
// as the data arg, so existing visible data stays put while the
// refetch is in flight — a flaky refetch on a half-warm iOS socket
// won't strand the user on a blank screen. Used by pull-refresh and
// resume-from-background.
//
// `blankFirst: true` mode forces the visible data to undefined on
// list-type keys before triggering revalidation. The tail-switch path
// uses this so a localStorage-persisted entry from a prior session
// can't render under the freshly-selected tail's header.
// (Pilots reported: "I switched aircraft, the flight-log table showed
// entries that didn't match the current tail or weren't the latest" —
// that was week-old persisted data from an earlier visit to the same
// tail. Blanking ensures a skeleton/empty render while the fresh
// fetch lands instead of a stale list the pilot can't distinguish
// from current data.)
// Single-row summary keys keep last-good even in blank-first mode —
// they refresh quickly and the small data is self-evidently "an older
// snapshot of the right thing" if briefly stale.
const LIST_KEY_PREFIXES = [
  'times-', 'vor-', 'vor-latest-', 'tire-', 'oil-', 'oil-chart-',
  'oil-last-added-', 'mx-', 'mx-events-', 'squawks-', 'ads-',
  'notes-', 'docs-', 'crew-', 'equipment-', 'calendar-',
];

function isListKey(k: string): boolean {
  // summary-* keys can collide with the broad `mx-` prefix
  // ("summary-mx-..." starts with "summary-", so we're safe — but be
  // explicit for future maintainers).
  if (k.startsWith('summary-')) return false;
  return LIST_KEY_PREFIXES.some(p => k.startsWith(p));
}

export function useAircraftRevalidator(globalMutate: ScopedMutator) {
  const { cache: swrCache } = useSWRConfig();

  return useCallback((aircraftId: string, opts?: { blankFirst?: boolean }) => {
    const matcher = matchesAircraft(aircraftId);
    // Two-pass clear:
    //   Pass A — walk every key currently in the cache provider that
    //     matches the aircraft (catches paginated variants, calendar
    //     months opened earlier in the session, etc.).
    //   Pass B — walk the canonical list of aircraft-scoped keys with
    //     default args (catches keys whose hook mounted but whose
    //     first fetch suspended on iOS *before* SWR's cache.set
    //     landed — those wouldn't show up in cache.keys() yet, but
    //     their FETCH[key] zombie still pins future dedupe checks).
    // Both passes route through `globalMutate(key)`, which clears
    // FETCH[key] / PRELOAD[key] internally and triggers the
    // revalidator if a hook is currently subscribed. Set-based dedupe
    // so duplicate keys don't double-fire mutate.
    const keys = new Set<string>();
    for (const k of Array.from(swrCache.keys())) {
      if (typeof k === 'string' && matcher(k)) keys.add(k);
    }
    for (const k of allForAircraft(aircraftId)) keys.add(k);
    // tsconfig targets es5 without downlevelIteration — same Array.from
    // wrap the cache.keys() walk above uses.
    for (const k of Array.from(keys)) {
      if (opts?.blankFirst && isListKey(k)) {
        globalMutate(k, undefined, { revalidate: true });
      } else {
        globalMutate(k);
      }
    }
  }, [globalMutate, swrCache]);
}

"use client";

import type { Cache, State } from "swr";

const CACHE_KEY = "aft_swr_cache";
// v3: bumped after fixing ghost-empty fetchers (TimesTab/NotesTab/Calendar
// crew/ADs equipment/Howard data + useFleetData boot). Version bump forces
// a one-time wipe so existing pilots whose localStorage has cached an
// empty result as success start clean on next load.
const CACHE_VERSION = 3;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Cap the persisted cache so the synchronous hydrate on page load and
// the beforeunload serialize don't grow unbounded across weeks of use.
// 150 entries comfortably covers a session's working set (active aircraft +
// fleet summary + a handful of tab queries) without producing a multi-MB
// JSON blob that stalls boot.
const MAX_PERSIST_ENTRIES = 150;
// Skip persisting any single entry larger than this — large objects
// (full flight-log dumps, big maintenance lists) cost more to serialize
// than they save by being warm on next load.
const MAX_PERSIST_VALUE_BYTES = 50 * 1024;

interface CacheEntry {
  v: number;    // version
  ts: number;   // timestamp when cached
  data: [string, State<any, any>][];
}

/**
 * SWR cache provider backed by localStorage.
 * On init, hydrates from localStorage (discarding stale entries).
 * On pagehide (mobile-safe; beforeunload doesn't reliably fire on iOS),
 * persists a bounded slice of the in-memory map.
 *
 * The persisted slice is capped at MAX_PERSIST_ENTRIES (the most-recently
 * inserted keys win) and skips any single value larger than
 * MAX_PERSIST_VALUE_BYTES, so the sync JSON.parse on the next load stays
 * fast even after weeks of usage.
 */
export function localStorageCacheProvider(parentCache: Readonly<Cache<any>>): Cache<any> {
  let seed: [string, State<any, any>][] = [];

  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed: CacheEntry = JSON.parse(raw);
        if (parsed.v === CACHE_VERSION && Date.now() - parsed.ts < MAX_AGE_MS) {
          seed = parsed.data;
        } else {
          localStorage.removeItem(CACHE_KEY);
        }
      }
    } catch {
      // Corrupted cache — start fresh
      localStorage.removeItem(CACHE_KEY);
    }
  }

  const map = new Map<string, State<any, any>>(seed);

  const persist = () => {
    try {
      // Map iterates in insertion order — the most-recently-set keys
      // are at the tail, which is what we want to keep.
      const allEntries = Array.from(map.entries());
      const tail = allEntries.slice(-MAX_PERSIST_ENTRIES);
      const data: [string, State<any, any>][] = [];
      for (const [k, v] of tail) {
        try {
          const json = JSON.stringify(v);
          if (json.length > MAX_PERSIST_VALUE_BYTES) continue;
          data.push([k, v]);
        } catch {
          // Non-serializable value (function, circular ref) — skip.
        }
      }
      const entry: CacheEntry = {
        v: CACHE_VERSION,
        ts: Date.now(),
        data,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
    } catch {
      // localStorage full or unavailable — silently skip
    }
  };

  if (typeof window !== "undefined") {
    // pagehide fires on iOS/Safari when the tab is backgrounded or
    // navigated away; beforeunload doesn't. Both paths converge here.
    window.addEventListener("pagehide", persist);
  }

  return {
    keys: () => map.keys(),
    get: (key: string) => map.get(key),
    set: (key: string, value: State<any, any>) => { map.set(key, value); },
    delete: (key: string) => { map.delete(key); },
  };
}

/**
 * Wipe the persisted SWR cache. Call from the auth-state listener on
 * SIGNED_OUT so the next user on a shared device doesn't see the prior
 * user's notes/squawks/aircraft hydrated from localStorage. The
 * in-memory SWR map needs a separate `globalMutate(() => true,
 * undefined, false)` from the caller — this helper only clears the
 * persisted blob.
 */
export function clearPersistedSwrCache(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Storage unavailable — nothing to do.
  }
}

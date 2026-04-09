"use client";

import type { Cache, State } from "swr";

const CACHE_KEY = "aft_swr_cache";
const CACHE_VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  v: number;    // version
  ts: number;   // timestamp when cached
  data: [string, State<any, any>][];
}

/**
 * SWR cache provider backed by localStorage.
 * On init, hydrates from localStorage (discarding stale entries).
 * On beforeunload, persists the in-memory map back to localStorage.
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

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      try {
        const entry: CacheEntry = {
          v: CACHE_VERSION,
          ts: Date.now(),
          data: Array.from(map.entries()),
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
      } catch {
        // localStorage full or unavailable — silently skip
      }
    });
  }

  return {
    keys: () => map.keys(),
    get: (key: string) => map.get(key),
    set: (key: string, value: State<any, any>) => { map.set(key, value); },
    delete: (key: string) => { map.delete(key); },
  };
}

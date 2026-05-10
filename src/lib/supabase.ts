// =============================================================
// BROWSER Supabase client — cookie-based auth (@supabase/ssr)
//
// Migrated from createClient (localStorage) → createBrowserClient
// (cookies) on 2026-05-10 to eliminate the iOS GoTrue-lock pressure
// that was causing spurious "Session expired" forced logouts. With
// cookies, same-origin fetches carry the access_token automatically;
// the browser no longer has to call getSession() to attach a Bearer
// header on every API call.
//
// What's retained from the previous setup:
//   - 15s timeout on REST (FETCH_TIMEOUT_MS)
//   - 60s timeout on storage uploads (STORAGE_FETCH_TIMEOUT_MS)
//   - In-flight read registry + abortInFlightSupabaseReads() for
//     tail-switch cancellation (still relevant: direct supabase reads
//     hold WKWebView sockets and a wedged read can starve the
//     destination tail's fetches)
// =============================================================

import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const FETCH_TIMEOUT_MS = 15_000;
const STORAGE_FETCH_TIMEOUT_MS = 60_000;

const isStorageUrl = (url: string) => url.includes('/storage/v1/object/');

// Read-only request registry. iOS WKWebView's HTTP/1.1 connection
// pool is shallow (~6 sockets per host); a wedged A-aircraft fetcher
// can starve B's first fetches indefinitely on tail switch even
// though the foreground app never backgrounded. AppShell calls
// `abortInFlightSupabaseReads` on tail switch to free those sockets
// so the destination's revalidate can land. We only register reads
// (GET/HEAD) — mutations (POST/PATCH/PUT/DELETE) are never aborted
// from outside, since aborting an in-flight write could leave the
// caller's UI inconsistent with the database.
const inFlightReads = new Set<AbortController>();

export function abortInFlightSupabaseReads(): void {
  if (inFlightReads.size === 0) return;
  const reason = new DOMException('supabase_aborted_for_tail_switch', 'AbortError');
  for (const c of Array.from(inFlightReads)) {
    try { c.abort(reason); } catch { /* already aborted */ }
  }
  inFlightReads.clear();
}

const fetchWithTimeout: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const timeoutMs = isStorageUrl(url) ? STORAGE_FETCH_TIMEOUT_MS : FETCH_TIMEOUT_MS;
  const method = (init?.method || 'GET').toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';

  const controller = new AbortController();
  // Forward an upstream abort signal — authFetch / SWR can cancel
  // through their own AbortController and we shouldn't strand the
  // request when they do.
  if (init?.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  if (isRead) inFlightReads.add(controller);
  const timer = setTimeout(() => controller.abort(new DOMException('supabase_fetch_timeout', 'TimeoutError')), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    if (isRead) inFlightReads.delete(controller);
  });
};

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
});

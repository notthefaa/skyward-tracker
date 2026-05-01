// =============================================================
// AUTHENTICATED FETCH — Client-side helper
// Wraps fetch() to automatically attach the Supabase access token
// as a Bearer token in the Authorization header.
//
// Usage:
//   import { authFetch } from '@/lib/authFetch';
//   const res = await authFetch('/api/invite', {
//     method: 'POST',
//     body: JSON.stringify({ email, role, aircraftIds })
//   });
//
// 401 handling
// ------------
// If the server returns 401 (token expired or invalid) we try a
// single token refresh + retry before bubbling the response up.
// On a second 401 we dispatch the `authfetch:unauthorized` window
// event so AppShell can route the user back to sign-in instead of
// every caller having to invent its own re-auth UX.
//
// iOS PWA hang protection
// -----------------------
// iOS Safari suspends in-flight fetches when the PWA backgrounds and
// doesn't always finalize them on resume — the supabase REST client
// has its own 15s wrap (lib/supabase.ts) but `fetch()` to /api/*
// routes is plain global fetch with no deadline, which previously
// stranded "Saving…" forever after a quick app-switch. Every
// authFetch now races against AUTH_FETCH_TIMEOUT_MS and aborts a
// hung request so the caller's try/catch + `setIsSubmitting(false)`
// path can run instead of the spinner sitting indefinitely. Callers
// can pass `timeoutMs` to override (image-upload paths may want a
// longer budget) or 0 to disable. Upstream signals are forwarded.
//
// In-flight registry for abort-on-resume
// ---------------------------------------
// Every authFetch's controller is registered in `inFlight` and
// removed on settle. AppShell's resume handler calls
// `abortAllInFlightAuthFetches()` so any request iOS suspended
// mid-flight fails *immediately* on resume instead of waiting out
// the 30 s timeout — the caller's catch path runs in ~1 s and the
// pilot sees "Connection lost — try again" instead of a stuck
// spinner. Surfaced as `code: 'AUTHFETCH_RESUMED'` so callers can
// tell a user-facing toast apart from a hard timeout.
// =============================================================

import { supabase } from './supabase';

const UNAUTHORIZED_EVENT = 'authfetch:unauthorized';
const AUTH_FETCH_TIMEOUT_MS = 30_000;

const inFlight = new Set<AbortController>();

/**
 * Abort every authFetch currently in-flight. Used by the resume
 * handler so iOS-suspended promises fail fast on foregrounding
 * instead of waiting out the 30 s timeout.
 */
export function abortAllInFlightAuthFetches(): void {
  if (inFlight.size === 0) return;
  const reason = new DOMException('authfetch_resumed', 'AbortError');
  // Snapshot before iterating — the finally block in fetchWithDeadline
  // mutates the Set as each aborted promise rejects. es5 target needs
  // Array.from for Set iteration regardless.
  for (const c of Array.from(inFlight)) {
    try { c.abort(reason); } catch { /* already aborted */ }
  }
  inFlight.clear();
}

export type AuthFetchOptions = RequestInit & { timeoutMs?: number };

async function buildHeaders(options: RequestInit): Promise<Headers> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(options.headers);
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

/**
 * Wraps `fetch` in an AbortController that fires after `timeoutMs`.
 * On expiry the underlying fetch is aborted and we throw a labelled
 * Error so callers (and the toast layer) can distinguish a network
 * timeout from other failures. Upstream `signal` is forwarded so
 * SWR / explicit cancellation still works.
 */
async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  if (timeoutMs <= 0) return fetch(url, init);
  const controller = new AbortController();
  inFlight.add(controller);
  const upstream = init.signal;
  if (upstream) {
    if (upstream.aborted) controller.abort(upstream.reason);
    else upstream.addEventListener('abort', () => controller.abort(upstream.reason), { once: true });
  }
  const timer = setTimeout(() => {
    controller.abort(new DOMException('authfetch_timeout', 'TimeoutError'));
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    // Translate AbortError-from-timeout / resume-broadcast into a
    // stable Error the UI layer can match on. Upstream-cancelled
    // aborts re-throw as is.
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      const e = new Error("Network's slow — request timed out. Try again.");
      (e as any).code = 'AUTHFETCH_TIMEOUT';
      throw e;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      // Could be timeout-routed-through-abort, resume-broadcast, or
      // upstream cancel. Inspect controller.signal.reason — that's
      // what we set when our timer fired or resume aborted.
      const reason: any = controller.signal.reason;
      if (reason instanceof DOMException && reason.name === 'TimeoutError') {
        const e = new Error("Network's slow — request timed out. Try again.");
        (e as any).code = 'AUTHFETCH_TIMEOUT';
        throw e;
      }
      if (reason instanceof DOMException && reason.message === 'authfetch_resumed') {
        const e = new Error('Connection was lost — try again.');
        (e as any).code = 'AUTHFETCH_RESUMED';
        throw e;
      }
    }
    throw err;
  } finally {
    clearTimeout(timer);
    inFlight.delete(controller);
  }
}

export async function authFetch(
  url: string,
  options: AuthFetchOptions = {}
): Promise<Response> {
  const { timeoutMs = AUTH_FETCH_TIMEOUT_MS, ...init } = options;
  const headers = await buildHeaders(init);
  const res = await fetchWithDeadline(url, { ...init, headers }, timeoutMs);

  if (res.status !== 401) return res;

  // First 401: try to refresh the session, then retry once. A live
  // session whose access token just expired is the most common cause
  // and refreshing usually succeeds without user interaction.
  const { data: refreshed } = await supabase.auth.refreshSession();
  if (!refreshed?.session) {
    notifyUnauthorized();
    return res;
  }

  const retryHeaders = await buildHeaders(init);
  // Fresh deadline on the retry — the refresh leg can eat several
  // seconds on a slow link and we don't want to penalize the retry
  // for time spent in the refresh.
  const retried = await fetchWithDeadline(url, { ...init, headers: retryHeaders }, timeoutMs);
  if (retried.status === 401) notifyUnauthorized();
  return retried;
}

function notifyUnauthorized() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
}

/** Subscribe to 401-after-refresh events (typically AppShell). */
export function onAuthFetchUnauthorized(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(UNAUTHORIZED_EVENT, handler);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
}

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
// path can run instead of the spinner sitting indefinitely.
//
// 15s default matches the supabase REST budget — anything beyond
// that on a non-upload route is almost always a wedged socket on
// iOS resume, not a legitimately slow API. Upload paths (scan,
// documents, send-workpackage) pass `timeoutMs: UPLOAD_TIMEOUT_MS`
// to keep the longer budget cellular needs. Pass 0 to disable.
// Upstream signals are forwarded.
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
import { recoveryReload } from './iosRecovery';
import { classifyRefreshOutcome, type RefreshOutcome } from './refreshOutcome';
export { classifyRefreshOutcome, type RefreshOutcome } from './refreshOutcome';

const UNAUTHORIZED_EVENT = 'authfetch:unauthorized';
const AUTH_FETCH_TIMEOUT_MS = 15_000;
/** Use as `timeoutMs: UPLOAD_TIMEOUT_MS` on FormData/PDF-gen routes
 *  that legitimately need more than 15s on cellular. */
export const UPLOAD_TIMEOUT_MS = 60_000;

const inFlight = new Set<AbortController>();

// Post-resume self-heal window. AppShell calls `markPostResume` on
// every visibilitychange/pageshow/online resume; if a subsequent
// authFetch hits its 15s timeout inside this window, the WKWebView's
// network pool is almost certainly still wedged from suspension and
// only a JS-process reset will recover it. Auto-firing recoveryReload
// here mimics the user's manual pull-to-refresh-then-reload workaround
// without making them watch a spinner timeout first. Bounded by the
// 30s reload cooldown in iosRecovery so a genuinely-offline user
// doesn't bounce in a loop.
let lastPostResumeAt = 0;
const POST_RESUME_RECOVERY_WINDOW_MS = 5 * 60 * 1000;
export function markPostResume(): void {
  lastPostResumeAt = Date.now();
}

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

/**
 * supabase.auth.getSession() is gated by GoTrueClient's internal
 * session lock. If a concurrent refresh stalls (an iOS-suspended
 * fetch the supabase client hasn't yet aborted), getSession waits on
 * that lock indefinitely. Race against the deadline so a stuck lock
 * can't outlast the caller's timeoutMs budget — on miss we send the
 * request unauthenticated and let the 401-retry path recover.
 */
async function buildHeaders(options: RequestInit, timeoutMs: number): Promise<Headers> {
  const headers = new Headers(options.headers);
  let session: { access_token?: string } | null = null;
  if (timeoutMs > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const sessionPromise = supabase.auth.getSession()
      .then(r => r.data.session as any)
      .catch(() => null);
    try {
      session = await Promise.race([sessionPromise, deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } else {
    const { data } = await supabase.auth.getSession();
    session = data.session;
  }
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
        // Post-resume self-heal: a 15s timeout right after a resume
        // event almost always means the WKWebView pool is still
        // wedged. Reload eagerly instead of leaving the user with a
        // toast they can only resolve by manually pull-to-refresh.
        // Outer cooldown in recoveryReload prevents reload loops.
        if (lastPostResumeAt && Date.now() - lastPostResumeAt < POST_RESUME_RECOVERY_WINDOW_MS) {
          recoveryReload('authfetch-timeout-post-resume');
        }
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
  const headers = await buildHeaders(init, timeoutMs);
  const res = await fetchWithDeadline(url, { ...init, headers }, timeoutMs);

  if (res.status !== 401) return res;

  // First 401: try to refresh the session, then retry once. A live
  // session whose access token just expired is the most common cause
  // and refreshing usually succeeds without user interaction.
  //
  // iOS PWA hang protection — refreshSession sits behind the same
  // GoTrue session lock that buildHeaders deadline-races. Without
  // a race here, a stuck lock from an iOS-suspended prior refresh
  // hangs this await forever and the caller's spinner never clears.
  //
  // CRITICAL distinction between two failure modes (see
  // `classifyRefreshOutcome`):
  //   - refreshPromise resolved + no session → session is genuinely
  //     dead. Notify unauthorized so AppShell signs the user out.
  //   - deadline race won (refresh hung past timeoutMs) → we don't
  //     KNOW whether the session is dead; the supabase client just
  //     couldn't tell us in time. Treat as transient (throw timeout
  //     so caller's catch fires) and DO NOT notify unauthorized.
  //     A wedged GoTrue lock from a prior iOS-suspended request
  //     used to spuriously log users out here.
  const refreshOutcome: RefreshOutcome = await classifyRefreshOutcome(
    () => supabase.auth.refreshSession().then(r => (r.data as any)?.session ?? null),
    timeoutMs,
  );
  if (refreshOutcome.kind === 'timed_out') {
    // Wedged refresh — almost always a stuck GoTrue lock from an
    // iOS-suspended prior call. Treat exactly like a fetch-timeout:
    // throw a transient error so the caller's catch path runs and
    // the spinner clears. The user keeps their session.
    //
    // Post-resume escalation: if we're inside the post-resume self-
    // heal window, the WKWebView is almost certainly still wedged —
    // fire recoveryReload so the user doesn't have to manually
    // pull-to-refresh out of it.
    if (lastPostResumeAt && Date.now() - lastPostResumeAt < POST_RESUME_RECOVERY_WINDOW_MS) {
      recoveryReload('refresh-timeout-post-resume');
    }
    const e = new Error("Network's slow — couldn't verify your session. Try again.");
    (e as any).code = 'AUTHFETCH_TIMEOUT';
    throw e;
  }
  if (!refreshOutcome.session) {
    notifyUnauthorized();
    return res;
  }

  const retryHeaders = await buildHeaders(init, timeoutMs);
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

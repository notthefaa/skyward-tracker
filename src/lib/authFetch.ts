// =============================================================
// AUTHENTICATED FETCH — Client-side helper
//
// Migrated to cookie-based auth (@supabase/ssr) on 2026-05-10.
// Same-origin fetches automatically carry the Supabase auth cookie;
// this helper no longer needs to call getSession() to attach a
// Bearer header. That removes the iOS GoTrue-lock pressure that was
// producing spurious "Session expired" forced logouts.
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
// Cookie refresh happens server-side in middleware.ts on every
// request, so 401s here mean the session is genuinely dead (refresh
// token expired or revoked). On 401 we dispatch
// `authfetch:unauthorized` so AppShell can route the user back to
// sign-in. No client-side refresh-and-retry loop — middleware did
// that work before the request reached the route handler.
//
// iOS PWA hang protection
// -----------------------
// iOS Safari suspends in-flight fetches when the PWA backgrounds.
// On resume the promises don't always finalize; without a deadline
// the caller's spinner sits forever. Every authFetch races against
// AUTH_FETCH_TIMEOUT_MS and aborts on miss so the caller's catch
// path fires.
//
// Upload paths (scan, documents, send-workpackage) pass
// `timeoutMs: UPLOAD_TIMEOUT_MS` for the longer cellular budget.
// Pass 0 to disable timeouts entirely. Upstream signals are forwarded.
//
// In-flight registry for abort-on-resume
// ---------------------------------------
// Every authFetch's controller is registered in `inFlight` and
// removed on settle. AppShell's resume handler calls
// `abortAllInFlightAuthFetches()` so iOS-suspended requests fail
// fast on foregrounding instead of waiting out the timeout.
// Surfaced as `code: 'AUTHFETCH_RESUMED'`.
// =============================================================

import { recoveryReload } from './iosRecovery';

// Re-exported from refreshOutcome.ts so legacy imports don't break.
// Kept exported for tests + any external caller that needs the helper.
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
// only a JS-process reset will recover it.
let lastPostResumeAt = 0;
const POST_RESUME_RECOVERY_WINDOW_MS = 5 * 60 * 1000;
export function markPostResume(): void {
  lastPostResumeAt = Date.now();
}

/**
 * Abort every authFetch currently in-flight. Used by the resume
 * handler so iOS-suspended promises fail fast on foregrounding.
 */
export function abortAllInFlightAuthFetches(): void {
  if (inFlight.size === 0) return;
  const reason = new DOMException('authfetch_resumed', 'AbortError');
  for (const c of Array.from(inFlight)) {
    try { c.abort(reason); } catch { /* already aborted */ }
  }
  inFlight.clear();
}

export type AuthFetchOptions = RequestInit & { timeoutMs?: number };

/**
 * Wraps `fetch` in an AbortController that fires after `timeoutMs`.
 * Translates timeout/abort errors into stable {code} Errors the UI
 * layer can match on. Upstream `signal` is forwarded.
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
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      const e = new Error("Network's slow — request timed out. Try again.");
      (e as any).code = 'AUTHFETCH_TIMEOUT';
      throw e;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      const reason: any = controller.signal.reason;
      if (reason instanceof DOMException && reason.name === 'TimeoutError') {
        // Post-resume self-heal: a timeout right after a resume event
        // almost always means the WKWebView pool is still wedged.
        // Reload eagerly. Cooldown in recoveryReload prevents loops.
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

/**
 * Build outbound headers. Cookie carries the auth — we just set
 * Content-Type when there's a body and no override.
 */
function buildHeaders(options: RequestInit): Headers {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

export async function authFetch(
  url: string,
  options: AuthFetchOptions = {}
): Promise<Response> {
  const { timeoutMs = AUTH_FETCH_TIMEOUT_MS, ...init } = options;
  const headers = buildHeaders(init);
  // credentials: 'same-origin' is the default for fetch() and sends
  // cookies on same-origin requests, which is what we want. Setting
  // explicitly so the intent is loud (and so a future cross-origin
  // call site can't silently strip credentials).
  const res = await fetchWithDeadline(
    url,
    { ...init, headers, credentials: init.credentials ?? 'same-origin' },
    timeoutMs,
  );
  if (res.status === 401) {
    // Cookie middleware already attempted refresh on the way in. A 401
    // here means the refresh token is genuinely dead — sign the user
    // out instead of looping a client-side refresh that won't help.
    notifyUnauthorized();
  }
  return res;
}

function notifyUnauthorized() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
}

/** Subscribe to 401-from-API events (typically AppShell). */
export function onAuthFetchUnauthorized(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(UNAUTHORIZED_EVENT, handler);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
}

// =============================================================
// iOS PWA NETWORK-WEDGE RECOVERY
//
// Symptom: after the PWA backgrounds for hours, iOS sometimes
// returns the WKWebView with a wedged network stack — fresh
// fetches don't go to the wire, they just sit until our timeouts
// fire. The app appears stuck and the only manual fix is to kill
// the PWA from the app switcher and relaunch (which spins up a
// fresh WKWebView process).
//
// `probeNetwork` fires a short, side-effect-free GET that we
// expect to succeed in milliseconds on a healthy connection. If
// it doesn't, callers can `recoveryReload()` to reset the JS
// process — that clears in-flight promises, the supabase client's
// session-refresh state, SWR's FETCH map, and React state, which
// is enough to recover from most JS-side fetch wedges.
//
// `probeNetworkDeep` adds a supabase auth round-trip in parallel.
// Field reports showed `/api/version` succeeding on a leftover
// warm socket while the heavier supabase REST pool was still
// half-dead — the user'd see the dashboard render from cache
// then hang the moment they opened any non-SWR-backed modal.
// Probing both pools catches partial wedges the lightweight
// version-only probe misses.
//
// `recoveryReload` is rate-limited via localStorage to prevent
// reload loops when the network is genuinely down (airplane mode,
// bad cell, captive portal). The cooldown survives the reload
// itself, so the post-reload page won't immediately reload again
// if its first fetches still fail.
// =============================================================

import { supabase } from './supabase';

const PROBE_URL = '/api/version';
const RECOVERY_RELOAD_KEY = 'aft_recovery_reload_at';
const RECOVERY_RELOAD_COOLDOWN_MS = 30_000;

export async function probeNetwork(timeoutMs = 5_000): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  if (navigator.onLine === false) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(PROBE_URL, { signal: ctrl.signal, cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Two-stack probe: the Edge route (/api/version) AND a supabase
 * auth round-trip. Returns true only when both come back inside
 * `timeoutMs`. The supabase leg is skipped (and counted as healthy)
 * for logged-out callers — there's no auth pool to probe and we
 * shouldn't bounce them off the welcome page on resume.
 */
export async function probeNetworkDeep(timeoutMs = 5_000): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  if (navigator.onLine === false) return false;

  const versionProbe = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(PROBE_URL, { signal: ctrl.signal, cache: 'no-store' });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  })();

  // Race the entire supabase leg against the deadline. getSession is
  // normally a cache hit, but if the GoTrue lock is held by a
  // wedged refresh it can stall — that itself is a wedge signal,
  // so deadline-loss returns false (probe fails → caller reloads).
  const supabaseProbe = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const inner = (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return true;
      const r = await supabase.auth.getUser();
      return !r.error;
    })().catch(() => false);
    try {
      return await Promise.race([inner, deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  const [edgeOk, supaOk] = await Promise.all([versionProbe, supabaseProbe]);
  return edgeOk && supaOk;
}

/**
 * Force a full page reload to recover from a wedged network state.
 * Returns true if the reload was triggered, false if the cooldown
 * suppressed it (avoids reload loops when the network is genuinely
 * unreachable).
 *
 * `reason` is logged via console.warn so Safari Web Inspector
 * captures a breadcrumb when this fires. The lifecycle hardening
 * commits aim to make this path inert in routine operation — if it
 * fires in the field, the reason string narrows the next root-cause
 * pass.
 */
export function recoveryReload(reason: string = 'unspecified'): boolean {
  if (typeof window === 'undefined') return false;
  if (navigator.onLine === false) return false;
  try {
    const last = Number(localStorage.getItem(RECOVERY_RELOAD_KEY) || 0);
    if (Number.isFinite(last) && Date.now() - last < RECOVERY_RELOAD_COOLDOWN_MS) {
      // eslint-disable-next-line no-console
      console.warn('[lifecycle] recoveryReload suppressed by cooldown —', { reason });
      return false;
    }
    localStorage.setItem(RECOVERY_RELOAD_KEY, String(Date.now()));
  } catch {
    // localStorage can throw in private mode / when full — proceed
    // anyway. The cooldown is belt-and-suspenders, not load-bearing.
  }
  // eslint-disable-next-line no-console
  console.warn('[lifecycle] recoveryReload firing —', { reason });
  window.location.reload();
  return true;
}

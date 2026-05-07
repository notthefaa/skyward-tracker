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
// `recoveryReload` is rate-limited via localStorage to prevent
// reload loops when the network is genuinely down (airplane mode,
// bad cell, captive portal). The cooldown survives the reload
// itself, so the post-reload page won't immediately reload again
// if its first fetches still fail.
// =============================================================

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

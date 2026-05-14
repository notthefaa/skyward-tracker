"use client";

import { useEffect, useRef } from "react";
import { supabase, abortInFlightSupabaseReads } from "@/lib/supabase";
import { abortAllInFlightAuthFetches, markPostResume } from "@/lib/authFetch";
import { probeNetworkDeep, recoveryReload } from "@/lib/iosRecovery";
import type { AircraftWithMetrics } from "@/lib/types";

// iOS PWAs / Safari suspend in-flight fetches AND pause the supabase
// auto-refresh timer when the app backgrounds. On resume:
// (a) old fetches may never finalize, and (b) the JWT in memory can
// be hours past expiry. Without intervention the first round of
// refetches goes out with a dead token, gets 401s, and SWR's 2 retries
// × 3s + the 15s fetch timeout burns 30+ seconds before any tab shows
// data again.
//
// Three resume signals, all coalesced through `triggerResume`:
//   • visibilitychange — primary on most platforms.
//   • pageshow — fires on iOS PWA bfcache restore and after long
//     backgrounds where visibilitychange skips. Without this listener
//     we missed a class of resumes entirely; the dead FETCH[key] map
//     stayed pinned and tabs sat blank until aircraft-switch.
//   • online — defensive depth. iOS sometimes lets us resume before
//     the radio is back; firing again on `online` guarantees we
//     revalidate once connectivity is real.
//
// We use `revalidateAircraftCache` so a flaky first refetch on a
// half-warm socket doesn't strand the user on a blank screen —
// last-good values stay rendered while SWR replaces them. A safety
// revalidate fires at +10s in case the immediate one failed; if it
// succeeded, the second one is a cache hit no-op.
//
// The session refresh has to complete before revalidation so the
// refetches don't race a stale JWT. Generation counter prevents a
// slow refresh from one resume from stomping a newer resume.
export function useResumeFromBackground({
  activeTail,
  allAircraftList,
  revalidateAircraftCache,
  checkGroundedStatus,
}: {
  activeTail: string;
  allAircraftList: AircraftWithMetrics[];
  revalidateAircraftCache: (aircraftId: string) => void;
  checkGroundedStatus: (tail: string) => void;
}) {
  const resumeGenerationRef = useRef(0);
  const lastResumeAtRef = useRef(0);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    let hiddenAt = 0;
    const RESUME_THRESHOLD_MS = 2_000;
    const REFRESH_TIMEOUT_MS = 8_000;
    const RESUME_DEDUP_MS = 1_500;
    const SAFETY_REVALIDATE_MS = 10_000;
    // Past this much time hidden, the iOS WKWebView's network stack
    // often returns wedged — fresh fetches sit forever. Probe
    // `/api/version` before doing anything else; if it doesn't respond
    // in PROBE_TIMEOUT_MS, hard-reload the page so we get a fresh JS
    // process (and the supabase client / SWR / in-flight promise state
    // that comes with it). This automates the user's manual close-and-
    // reopen workaround.
    //
    // After the abort+canonical-key revalidation hardening landed, the
    // routine resume path stopped needing a reload at the 90s mark —
    // the FETCH-zombie clear lets SWR refire fresh fetches without the
    // JS-process reset. Bumped to 5min so the reload is a true
    // last-resort for genuinely wedged WKWebView network stacks, not
    // the routine-after-a-couple-minutes path. Probe is still cheap
    // (~30 byte GET, gated on navigator.onLine) and the 30s reload
    // cooldown in iosRecovery still prevents loops.
    const PROBE_AFTER_HIDDEN_MS = 5 * 60 * 1000;
    const PROBE_TIMEOUT_MS = 4_000;
    // Past this much suspension, skip the probe-and-maybe-reload dance
    // and just reload. The user has been gone hours — they're not
    // mid-form, the JS process is almost certainly stale, and a brief
    // reload is cheaper than the spinner-then-pull-refresh recovery
    // they otherwise have to do manually. 30s cooldown in
    // recoveryReload still prevents loops.
    const LONG_SUSPENSION_RELOAD_MS = 2 * 60 * 60 * 1000;
    // Pill threshold is separate from the resume threshold. Quick
    // screen-flicks (lock for a few seconds, switch tabs) still
    // trigger abort+revalidate so iOS can't wedge a fetch silently —
    // but we don't show the "Reconnecting…" pill for those, because it
    // makes the app feel unstable when nothing real happened. Only
    // backgrounds long enough that the user themselves would notice
    // the gap warrant the indicator.
    const PILL_AFTER_HIDDEN_MS = 15_000;

    const triggerResume = (forceRefresh: boolean, hiddenForMs = 0, showPill = true) => {
      const now = Date.now();
      if (now - lastResumeAtRef.current < RESUME_DEDUP_MS) return;
      lastResumeAtRef.current = now;

      // Notify authFetch so its 15s timeout path can self-heal if the
      // network stack is still wedged after our probe-and-revalidate
      // cycle (e.g., the cheap probe falsely passed but a real
      // request still hangs). Bounded by the 5min recovery window in
      // authFetch + the 30s recoveryReload cooldown.
      markPostResume();

      // Surface a small "Reconnecting…" pill so the abort+revalidate
      // cycle reads as intentional. Auto-clears in ~1.5s; the indicator
      // listens for the event in ReconnectingIndicator.tsx. Gated on
      // PILL_AFTER_HIDDEN_MS so brief backgrounds don't spam it.
      if (showPill && hiddenForMs >= PILL_AFTER_HIDDEN_MS) {
        window.dispatchEvent(new CustomEvent('aft:reconnecting'));
      }

      // Abort iOS-suspended in-flight reads (supabase + authFetch)
      // immediately so submit forms surface their catch-path within
      // ~1s instead of waiting out the 15s timeout, and so dead sockets
      // stop occupying iOS's shallow connection pool while fresh
      // fetches queue. Caller code maps the AUTHFETCH_RESUMED error to
      // a "Connection was lost — try again" toast. Safe to call
      // unconditionally — both are no-ops when nothing is in-flight.
      //
      // ABORT + LONG-SUSPENSION RELOAD + PROBE run BEFORE the
      // activeTail/ac bail so admins, un-hydrated boots, and logged-out
      // callers all get the network protection. The bail below only
      // gates aircraft-scoped revalidation, which genuinely needs an
      // aircraft.
      abortInFlightSupabaseReads();
      abortAllInFlightAuthFetches();

      const gen = ++resumeGenerationRef.current;
      (async () => {
        // Very long suspension: skip the probe gamble, just reload.
        // After hours away the JS process is almost certainly stale
        // and the manual fix the user does (kill + reopen the PWA) is
        // faster than waiting out spinners. Cooldown protects
        // genuinely-offline users from a reload loop.
        if (hiddenForMs >= LONG_SUSPENSION_RELOAD_MS) {
          if (recoveryReload('long-suspension')) return;
        }
        // Long-suspension probe: if the network is wedged, no amount
        // of refreshSession + revalidate will recover — only a fresh
        // process will. Probes BOTH the Edge stack AND a supabase
        // round-trip — the cheap version-only probe was false-passing
        // on partially-wedged pools, leaving the user with a fine
        // dashboard but every fresh fetch hung.
        if (hiddenForMs >= PROBE_AFTER_HIDDEN_MS) {
          const ok = await probeNetworkDeep(PROBE_TIMEOUT_MS);
          if (!ok) {
            if (recoveryReload('resume-probe-failed')) return;
          }
          if (resumeGenerationRef.current !== gen) return;
        }

        // Aircraft-scoped revalidation. Skip when there's no active
        // tail — the abort + probe + reload work above has already
        // run, which is what the network actually needed.
        if (!activeTail) return;
        const ac = allAircraftList.find(a => a.tail_number === activeTail);
        if (!ac) return;

        if (forceRefresh) {
          // Race the refresh against a tight timeout — we'd rather
          // revalidate with a stale token (and let SWR retry on 401)
          // than leave the user staring at stale data while a hung
          // refresh call sits indefinitely.
          await Promise.race([
            supabase.auth.refreshSession().catch(() => {}),
            new Promise<void>(resolve => setTimeout(resolve, REFRESH_TIMEOUT_MS)),
          ]);
        }
        if (resumeGenerationRef.current !== gen) return;
        revalidateAircraftCache(ac.id);
        checkGroundedStatus(activeTail);
        // Defensive second pass — covers the case where the immediate
        // revalidate raced a half-warm socket and errored out. SWR's
        // errorRetryCount is 2, so without this the user is stuck until
        // they manually pull-to-refresh.
        setTimeout(() => {
          if (resumeGenerationRef.current !== gen) return;
          revalidateAircraftCache(ac.id);
        }, SAFETY_REVALIDATE_MS);
      })();
    };

    const onVis = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const wasHidden = hiddenAt;
      hiddenAt = 0;
      if (!wasHidden) return;
      const gap = Date.now() - wasHidden;
      if (gap < RESUME_THRESHOLD_MS) return;
      triggerResume(true, gap);
    };
    // pageshow with persisted=true means bfcache restore — those skip
    // visibilitychange entirely. Even when persisted=false, firing
    // resume on pageshow is harmless: dedup guards against double-wipe
    // when both events fire on a normal foregrounding.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        // bfcache restores after a long background warrant the same
        // probe — pass a synthetic gap so the probe path engages.
        triggerResume(true, PROBE_AFTER_HIDDEN_MS);
      }
    };
    // Network came back from offline — user wants to see the pill so
    // they know the app is catching back up. Pass a synthetic gap past
    // PILL_AFTER_HIDDEN_MS so the pill fires regardless of how long
    // they were actually offline.
    const onOnline = () => triggerResume(false, PILL_AFTER_HIDDEN_MS);

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
    };
  }, [activeTail, allAircraftList, revalidateAircraftCache, checkGroundedStatus]);
}

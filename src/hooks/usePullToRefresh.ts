"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  /** Minimum downward distance (px) before pull-to-refresh engages.
   *  Prevents accidental activation when scrolling up inside content. */
  activationDistance?: number;
  /** Hard ceiling on how long the 'refreshing' phase can hold the spinner.
   *  If `onRefresh` never resolves (hung supabase request, dead socket, etc.)
   *  the watchdog forces phase back to 'idle' so the user can pull again
   *  without restarting the app. */
  watchdogMs?: number;
}

export function usePullToRefresh({ onRefresh, threshold = 80, activationDistance = 15, watchdogMs = 20_000 }: UsePullToRefreshOptions) {
  const [pullProgress, setPullProgress] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'pulling' | 'refreshing' | 'done'>('idle');
  const [enabled, setEnabled] = useState(true);

  const startY = useRef(0);
  const active = useRef(false);
  const engaged = useRef(false);
  const scrollEl = useRef<HTMLElement | null>(null);
  // Bumped on every refresh attempt; the watchdog only fires phase-reset
  // for the attempt it was scheduled with, so a slow refresh that finally
  // resolves after the watchdog ran can't stomp on a *subsequent* pull.
  const refreshSeqRef = useRef(0);

  // Native non-passive touchmove to enable preventDefault on iOS
  useEffect(() => {
    const handler = (e: TouchEvent) => {
      if (!active.current || !engaged.current) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta > 0) {
        e.preventDefault();
      }
    };

    document.addEventListener('touchmove', handler, { passive: false });
    return () => document.removeEventListener('touchmove', handler);
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    if (phase === 'refreshing' || phase === 'done') return;
    const el = e.currentTarget as HTMLElement;
    scrollEl.current = el;

    // CRITICAL: Only allow pull-to-refresh when scroll is at the very top
    if (el.scrollTop > 0) return;

    startY.current = e.touches[0].clientY;
    active.current = true;
    engaged.current = false; // Not engaged until activation distance is met
  }, [phase, enabled]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!active.current || !enabled) return;
    const el = scrollEl.current;

    // If the content has scrolled down at all, abort immediately
    if (el && el.scrollTop > 0) {
      active.current = false;
      engaged.current = false;
      setPullProgress(0);
      if (phase === 'pulling') setPhase('idle');
      return;
    }

    const delta = e.touches[0].clientY - startY.current;

    // If the user is swiping up, don't engage
    if (delta <= 0) {
      engaged.current = false;
      setPullProgress(0);
      if (phase === 'pulling') setPhase('idle');
      return;
    }

    // Require a minimum downward distance before engaging pull-to-refresh.
    // This prevents accidental activation when the user is trying to scroll up
    // after reaching the top of the content.
    if (!engaged.current) {
      if (delta < activationDistance) {
        // Not yet engaged — don't show any indicator
        return;
      }
      // Passed the activation threshold — now we're in pull-to-refresh mode
      engaged.current = true;
    }

    // Calculate progress from the point of engagement
    const engagedDelta = delta - activationDistance;
    const progress = Math.min((engagedDelta * 0.5) / threshold, 1.4);
    setPullProgress(progress);
    if (phase !== 'pulling') setPhase('pulling');
  }, [phase, threshold, activationDistance, enabled]);

  const onTouchEnd = useCallback(async () => {
    if (!active.current || !enabled) return;
    active.current = false;

    // Only trigger refresh if we were actually engaged (past activation distance)
    if (engaged.current && pullProgress >= 1) {
      setPhase('refreshing');
      setPullProgress(1);

      // Watchdog: if onRefresh hangs (stuck supabase RPC, dead socket),
      // bail out of the spinner after `watchdogMs` so the user isn't
      // stranded staring at a refresh that never ends. The seq guard
      // makes sure a hung onRefresh that *does* eventually resolve can't
      // re-flash the spinner over a fresh state — the watchdog bumps the
      // seq itself on fire, so the late-resolving onRefresh sees a
      // mismatch and bails out of the rest of the close-out sequence.
      const seq = ++refreshSeqRef.current;
      const watchdog = setTimeout(() => {
        if (refreshSeqRef.current !== seq) return;
        console.warn(`[PullToRefresh] onRefresh exceeded ${watchdogMs}ms — forcing reset`);
        refreshSeqRef.current++;
        setPullProgress(0);
        setPhase('idle');
      }, watchdogMs);

      try {
        await onRefresh();
      } catch (err) {
        console.error('[PullToRefresh]', err);
      } finally {
        clearTimeout(watchdog);
      }

      // If the watchdog already reset us, don't run the normal close.
      if (refreshSeqRef.current !== seq) {
        engaged.current = false;
        return;
      }

      setPhase('done');
      setPullProgress(0);
      await new Promise(r => setTimeout(r, 600));
      // Same guard for the post-done idle transition: if a new pull
      // started during the 600 ms cooldown, leave its phase alone.
      if (refreshSeqRef.current === seq) setPhase('idle');
    } else {
      setPullProgress(0);
      setPhase('idle');
    }

    engaged.current = false;
  }, [pullProgress, onRefresh, enabled, watchdogMs]);

  return {
    pullHandlers: { onTouchStart, onTouchMove, onTouchEnd },
    pullProgress,
    phase,
    /** Disable pull-to-refresh (e.g. when a modal is open) */
    setEnabled,
  };
}

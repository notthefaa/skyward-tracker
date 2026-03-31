"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
}

export function usePullToRefresh({ onRefresh, threshold = 80 }: UsePullToRefreshOptions) {
  const [pullProgress, setPullProgress] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'pulling' | 'refreshing' | 'done'>('idle');

  const startY = useRef(0);
  const active = useRef(false);
  const scrollEl = useRef<HTMLElement | null>(null);

  // Native non-passive touchmove to enable preventDefault on iOS
  useEffect(() => {
    const handler = (e: TouchEvent) => {
      if (!active.current) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta > 5) {
        e.preventDefault();
      }
    };

    // We attach to document so it catches the event before iOS does
    document.addEventListener('touchmove', handler, { passive: false });
    return () => document.removeEventListener('touchmove', handler);
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (phase === 'refreshing' || phase === 'done') return;
    const el = e.currentTarget as HTMLElement;
    scrollEl.current = el;
    if (el.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
    active.current = true;
  }, [phase]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!active.current) return;
    const el = scrollEl.current;
    if (el && el.scrollTop > 0) {
      active.current = false;
      setPullProgress(0);
      setPhase('idle');
      return;
    }

    const delta = e.touches[0].clientY - startY.current;
    if (delta <= 0) {
      setPullProgress(0);
      if (phase === 'pulling') setPhase('idle');
      return;
    }

    // Progress 0 to 1+ with diminishing returns
    const progress = Math.min((delta * 0.5) / threshold, 1.4);
    setPullProgress(progress);
    if (phase !== 'pulling') setPhase('pulling');
  }, [phase, threshold]);

  const onTouchEnd = useCallback(async () => {
    if (!active.current) return;
    active.current = false;

    if (pullProgress >= 1) {
      setPhase('refreshing');
      setPullProgress(1);

      try {
        await onRefresh();
      } catch (err) {
        console.error('[PullToRefresh]', err);
      }

      // Show "done" briefly before hiding
      setPhase('done');
      setPullProgress(0);
      await new Promise(r => setTimeout(r, 600));
      setPhase('idle');
    } else {
      setPullProgress(0);
      setPhase('idle');
    }
  }, [pullProgress, onRefresh]);

  return {
    pullHandlers: { onTouchStart, onTouchMove, onTouchEnd },
    pullProgress,
    phase,
  };
}

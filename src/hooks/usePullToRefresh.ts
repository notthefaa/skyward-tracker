"use client";

import { useRef, useState, useCallback } from "react";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
}

export function usePullToRefresh({ onRefresh, threshold = 70 }: UsePullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'pulling' | 'releasing' | 'refreshing'>('idle');

  const startY = useRef(0);
  const tracking = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (isRefreshing) return;
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
    tracking.current = true;
  }, [isRefreshing]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!tracking.current || isRefreshing) return;
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop > 0) {
      tracking.current = false;
      setPullDistance(0);
      setPhase('idle');
      return;
    }

    const delta = e.touches[0].clientY - startY.current;
    if (delta <= 0) {
      setPullDistance(0);
      setPhase('idle');
      return;
    }

    // Diminishing resistance — feels like pulling against a rubber band
    const resisted = Math.pow(delta, 0.7);
    const clamped = Math.min(resisted, 130);

    setPullDistance(clamped);
    setPhase('pulling');
  }, [isRefreshing]);

  const onTouchEnd = useCallback(async () => {
    if (!tracking.current || isRefreshing) return;
    tracking.current = false;

    // Read current pullDistance from a synchronous snapshot
    // We use a callback form of setState to get the current value
    let finalPull = 0;
    setPullDistance(prev => { finalPull = prev; return prev; });

    if (finalPull >= threshold) {
      // Threshold reached — hold at a resting height while refreshing
      setPhase('refreshing');
      setIsRefreshing(true);
      setPullDistance(52);

      try {
        await onRefresh();
      } finally {
        // Smooth spring-back
        setPhase('releasing');
        setPullDistance(0);
        setTimeout(() => {
          setIsRefreshing(false);
          setPhase('idle');
        }, 350);
      }
    } else {
      // Didn't reach threshold — spring back
      setPhase('releasing');
      setPullDistance(0);
      setTimeout(() => setPhase('idle'), 350);
    }
  }, [threshold, isRefreshing, onRefresh]);

  return {
    pullHandlers: { onTouchStart, onTouchMove, onTouchEnd },
    pullDistance,
    isRefreshing,
    phase,
    // Derived from state so it's always fresh on render
    pullProgress: Math.min(pullDistance / threshold, 1),
  };
}

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
  const rafId = useRef<number | null>(null);
  const currentPull = useRef(0);

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
      currentPull.current = 0;
      setPullDistance(0);
      setPhase('idle');
      return;
    }

    const delta = e.touches[0].clientY - startY.current;
    if (delta <= 0) {
      currentPull.current = 0;
      setPullDistance(0);
      setPhase('idle');
      return;
    }

    // Diminishing resistance — feels like pulling against a rubber band
    const resisted = Math.pow(delta, 0.7);
    const clamped = Math.min(resisted, 130);
    currentPull.current = clamped;

    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      setPullDistance(clamped);
      setPhase('pulling');
    });
  }, [isRefreshing]);

  const onTouchEnd = useCallback(async () => {
    if (!tracking.current || isRefreshing) return;
    tracking.current = false;

    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }

    const finalPull = currentPull.current;

    if (finalPull >= threshold) {
      // Threshold reached — hold at a small resting height while refreshing
      setPhase('refreshing');
      setIsRefreshing(true);
      setPullDistance(48);

      try {
        await onRefresh();
      } finally {
        // Smooth spring-back after refresh completes
        setPhase('releasing');
        setPullDistance(0);
        setTimeout(() => {
          setIsRefreshing(false);
          setPhase('idle');
        }, 350);
      }
    } else {
      // Didn't reach threshold — spring back immediately
      setPhase('releasing');
      setPullDistance(0);
      currentPull.current = 0;
      setTimeout(() => setPhase('idle'), 350);
    }
  }, [threshold, isRefreshing, onRefresh]);

  return {
    pullHandlers: { onTouchStart, onTouchMove, onTouchEnd },
    pullDistance,
    isRefreshing,
    phase,
    pullProgress: Math.min(currentPull.current / threshold, 1),
  };
}

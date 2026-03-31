"use client";

import { useRef, useState, useCallback } from "react";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
}

export function usePullToRefresh({ onRefresh, threshold = 64 }: UsePullToRefreshOptions) {
  const [pullOffset, setPullOffset] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'pulling' | 'refreshing' | 'settling'>('idle');

  const startY = useRef(0);
  const active = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (isRefreshing) return;
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
    active.current = true;
  }, [isRefreshing]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!active.current || isRefreshing) return;
    const el = e.currentTarget as HTMLElement;

    // If the user scrolled down mid-gesture, cancel
    if (el.scrollTop > 0) {
      active.current = false;
      setPullOffset(0);
      setPhase('idle');
      return;
    }

    const rawDelta = e.touches[0].clientY - startY.current;
    if (rawDelta <= 0) {
      if (pullOffset !== 0) {
        setPullOffset(0);
        setPhase('idle');
      }
      return;
    }

    // Rubber-band resistance
    const resisted = Math.min(rawDelta * 0.45, 120);
    setPullOffset(resisted);
    setPhase('pulling');
  }, [isRefreshing, pullOffset]);

  const onTouchEnd = useCallback(async () => {
    if (!active.current || isRefreshing) return;
    active.current = false;

    if (pullOffset >= threshold) {
      // Snap to a resting offset during refresh
      setPullOffset(52);
      setPhase('refreshing');
      setIsRefreshing(true);

      try {
        await onRefresh();
      } finally {
        // Spring back to 0
        setPhase('settling');
        setPullOffset(0);
        setTimeout(() => {
          setIsRefreshing(false);
          setPhase('idle');
        }, 400);
      }
    } else {
      // Didn't pull far enough — spring back
      setPhase('settling');
      setPullOffset(0);
      setTimeout(() => setPhase('idle'), 400);
    }
  }, [pullOffset, threshold, isRefreshing, onRefresh]);

  return {
    pullHandlers: { onTouchStart, onTouchMove, onTouchEnd },
    pullOffset,
    isRefreshing,
    phase,
    pullProgress: Math.min(pullOffset / threshold, 1),
  };
}

"use client";

import { useRef, useState, useCallback, useEffect } from "react";

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
  const scrollEl = useRef<HTMLElement | null>(null);
  const wasAtTop = useRef(false);

  // Attach a non-passive native touchmove listener to enable preventDefault on iOS
  useEffect(() => {
    const el = scrollEl.current;
    if (!el) return;

    const handleNativeTouchMove = (e: TouchEvent) => {
      // Only prevent default when we're actively managing a pull gesture
      if (active.current && wasAtTop.current) {
        const rawDelta = e.touches[0].clientY - startY.current;
        if (rawDelta > 0) {
          e.preventDefault();
        }
      }
    };

    // { passive: false } is critical — iOS Safari ignores preventDefault on passive listeners
    el.addEventListener('touchmove', handleNativeTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', handleNativeTouchMove);
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (isRefreshing) return;
    const el = e.currentTarget as HTMLElement;
    scrollEl.current = el;

    // Only engage if scrolled to the very top
    wasAtTop.current = el.scrollTop <= 0;
    if (!wasAtTop.current) return;

    startY.current = e.touches[0].clientY;
    active.current = true;
  }, [isRefreshing]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!active.current || isRefreshing || !wasAtTop.current) return;

    const el = e.currentTarget as HTMLElement;

    // If somehow scrolled down, cancel the pull
    if (el.scrollTop > 0) {
      active.current = false;
      wasAtTop.current = false;
      setPullOffset(0);
      setPhase('idle');
      return;
    }

    const rawDelta = e.touches[0].clientY - startY.current;

    if (rawDelta <= 0) {
      // Pushing up — let normal scroll handle it
      if (pullOffset !== 0) {
        setPullOffset(0);
        setPhase('idle');
      }
      return;
    }

    // Lock scrolling on the container while pulling down
    el.style.overflow = 'hidden';

    // Rubber-band resistance curve
    const resisted = Math.min(rawDelta * 0.42, 120);
    setPullOffset(resisted);
    setPhase('pulling');
  }, [isRefreshing, pullOffset]);

  const onTouchEnd = useCallback(async () => {
    // Re-enable scrolling
    if (scrollEl.current) {
      scrollEl.current.style.overflow = '';
    }

    if (!active.current || isRefreshing) return;
    active.current = false;
    wasAtTop.current = false;

    if (pullOffset >= threshold) {
      // Threshold reached — show refreshing state
      setPhase('refreshing');
      setIsRefreshing(true);
      setPullOffset(56);

      try {
        await onRefresh();
      } catch (err) {
        console.error('[PullToRefresh] Refresh error:', err);
      }

      // Brief pause so React can paint updated data before we animate away
      await new Promise(resolve => setTimeout(resolve, 250));

      // Smooth spring-back
      setPhase('settling');
      setPullOffset(0);

      setTimeout(() => {
        setIsRefreshing(false);
        setPhase('idle');
      }, 400);
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

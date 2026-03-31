"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  /** Minimum pull distance in pixels before a refresh triggers */
  threshold?: number;
  /** CSS selector or ref for the scrollable container. Defaults to the element the handlers are attached to. */
}

interface PullToRefreshState {
  isPulling: boolean;
  isRefreshing: boolean;
  pullDistance: number;
}

/**
 * Pull-to-refresh hook for mobile PWA.
 * 
 * Returns touch event handlers to attach to the scrollable container,
 * plus state for rendering the pull indicator.
 * 
 * Only activates when the container is scrolled to the top (scrollTop <= 0).
 */
export function usePullToRefresh({ onRefresh, threshold = 80 }: UsePullToRefreshOptions) {
  const [state, setState] = useState<PullToRefreshState>({
    isPulling: false,
    isRefreshing: false,
    pullDistance: 0,
  });

  const startY = useRef(0);
  const currentY = useRef(0);
  const isPullingRef = useRef(false);
  const containerRef = useRef<HTMLElement | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const el = e.currentTarget as HTMLElement;
    containerRef.current = el;

    // Only start pull-to-refresh if scrolled to the top
    if (el.scrollTop > 0) return;

    startY.current = e.touches[0].clientY;
    currentY.current = startY.current;
    isPullingRef.current = false;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (state.isRefreshing) return;

    const el = containerRef.current;
    if (!el || el.scrollTop > 0) return;

    currentY.current = e.touches[0].clientY;
    const delta = currentY.current - startY.current;

    // Only track downward pulls
    if (delta <= 0) {
      if (isPullingRef.current) {
        isPullingRef.current = false;
        setState(prev => ({ ...prev, isPulling: false, pullDistance: 0 }));
      }
      return;
    }

    // Apply resistance — diminishing returns as you pull further
    const resistedDelta = Math.min(delta * 0.4, 140);

    isPullingRef.current = true;
    setState(prev => ({ ...prev, isPulling: true, pullDistance: resistedDelta }));
  }, [state.isRefreshing]);

  const onTouchEnd = useCallback(async () => {
    if (!isPullingRef.current || state.isRefreshing) {
      setState(prev => ({ ...prev, isPulling: false, pullDistance: 0 }));
      return;
    }

    const delta = currentY.current - startY.current;
    const resistedDelta = Math.min(delta * 0.4, 140);

    if (resistedDelta >= threshold) {
      // Threshold reached — trigger refresh
      setState({ isPulling: false, isRefreshing: true, pullDistance: threshold * 0.6 });

      try {
        await onRefresh();
      } finally {
        // Brief delay so the user sees the spinner complete
        setTimeout(() => {
          setState({ isPulling: false, isRefreshing: false, pullDistance: 0 });
        }, 300);
      }
    } else {
      // Didn't pull far enough — snap back
      setState({ isPulling: false, isRefreshing: false, pullDistance: 0 });
    }

    isPullingRef.current = false;
  }, [onRefresh, threshold, state.isRefreshing]);

  return {
    pullHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
    isPulling: state.isPulling,
    isRefreshing: state.isRefreshing,
    pullDistance: state.pullDistance,
    /** The pull progress as 0-1 (reaches 1 at threshold) */
    pullProgress: Math.min(state.pullDistance / threshold, 1),
  };
}

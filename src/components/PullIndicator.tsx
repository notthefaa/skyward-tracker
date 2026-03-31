"use client";

import { Loader2, ArrowDown } from "lucide-react";

interface PullIndicatorProps {
  pullOffset: number;
  pullProgress: number;
  isRefreshing: boolean;
  phase: 'idle' | 'pulling' | 'refreshing' | 'settling';
}

export default function PullIndicator({ pullOffset, pullProgress, isRefreshing, phase }: PullIndicatorProps) {
  // Always render — use opacity and transform to show/hide.
  // This avoids mount/unmount flicker.
  const isVisible = phase !== 'idle';
  const reachedThreshold = pullProgress >= 1;

  const label = isRefreshing
    ? 'Refreshing...'
    : reachedThreshold
      ? 'Release to refresh'
      : 'Pull to refresh';

  const colorClass = isRefreshing
    ? 'text-[#F08B46]'
    : reachedThreshold
      ? 'text-[#56B94A]'
      : 'text-gray-400';

  // Fade in quickly — fully opaque by 35% of threshold
  const opacity = isVisible ? Math.min(pullProgress / 0.35, 1) : 0;
  if (isRefreshing) {
    // Keep full opacity during refresh
  }

  // Animate smoothly when settling/refreshing, follow finger when pulling
  const useTransition = phase === 'settling' || phase === 'refreshing';

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 5,
        // Sits above main, translated down by pullOffset
        // Start at -48 (hidden above) and slide down
        transform: `translateY(${isVisible ? pullOffset - 48 + Math.min(pullOffset * 0.3, 16) : -48}px)`,
        transition: useTransition ? 'transform 0.4s cubic-bezier(0.2, 0.9, 0.3, 1), opacity 0.3s ease-out' : 'none',
        opacity: isRefreshing ? 1 : opacity,
      }}
    >
      <div className="flex items-center gap-2">
        {isRefreshing ? (
          <Loader2 size={16} className="text-[#F08B46] animate-spin" />
        ) : (
          <ArrowDown
            size={16}
            className={colorClass}
            style={{
              transition: 'transform 0.2s ease-out',
              transform: reachedThreshold ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        )}
        <span
          className={`text-[10px] font-oswald font-bold uppercase tracking-widest ${colorClass}`}
          style={{ transition: 'color 0.15s ease-out' }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

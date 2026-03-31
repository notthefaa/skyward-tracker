"use client";

import { Loader2, ArrowDown } from "lucide-react";

interface PullIndicatorProps {
  pullOffset: number;
  pullProgress: number;
  isRefreshing: boolean;
  phase: 'idle' | 'pulling' | 'refreshing' | 'settling';
}

export default function PullIndicator({ pullOffset, pullProgress, isRefreshing, phase }: PullIndicatorProps) {
  const isActive = phase !== 'idle';
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

  // Fade in by ~30% of threshold
  const opacity = isRefreshing ? 1 : (isActive ? Math.min(pullProgress / 0.3, 1) : 0);

  // Smooth CSS transitions when settling or refreshing; instant when pulling
  const smooth = phase === 'settling' || phase === 'refreshing';

  // Position the indicator: starts hidden at -40, slides in as pull grows
  const indicatorY = isActive ? Math.min(pullOffset - 10, 30) : -40;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 5,
        transform: `translateY(${indicatorY}px)`,
        opacity,
        transition: smooth
          ? 'transform 0.4s cubic-bezier(0.2, 0.9, 0.3, 1), opacity 0.3s ease-out'
          : 'opacity 0.1s ease-out',
        willChange: isActive ? 'transform, opacity' : 'auto',
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

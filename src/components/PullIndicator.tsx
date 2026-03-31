"use client";

import { Loader2, ArrowDown } from "lucide-react";

interface PullIndicatorProps {
  pullDistance: number;
  pullProgress: number;
  isRefreshing: boolean;
  phase: 'idle' | 'pulling' | 'releasing' | 'refreshing';
}

export default function PullIndicator({ pullDistance, pullProgress, isRefreshing, phase }: PullIndicatorProps) {
  if (phase === 'idle') return null;

  const reachedThreshold = pullProgress >= 1;
  const label = isRefreshing 
    ? 'Refreshing...' 
    : reachedThreshold 
      ? 'Release to refresh' 
      : 'Pull to refresh';

  // Transition height smoothly when releasing or refreshing, follow finger exactly when pulling
  const animateHeight = phase === 'releasing' || phase === 'refreshing';

  // Fade in the content as the user pulls — fully visible by 30% progress
  const contentOpacity = isRefreshing ? 1 : Math.min(pullProgress / 0.3, 1);

  return (
    <div 
      style={{ 
        height: pullDistance,
        transition: animateHeight ? 'height 0.35s cubic-bezier(0.2, 0.9, 0.3, 1)' : 'none',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        minHeight: 0,
      }}
    >
      <div 
        className="flex items-center gap-2"
        style={{ opacity: contentOpacity, transition: 'opacity 0.15s ease-out' }}
      >
        {isRefreshing ? (
          <Loader2 size={16} className="text-[#F08B46] animate-spin" />
        ) : (
          <ArrowDown
            size={16}
            className={reachedThreshold ? 'text-[#56B94A]' : 'text-gray-400'}
            style={{
              transition: 'transform 0.15s ease-out',
              transform: reachedThreshold ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        )}
        <span 
          className={`text-[10px] font-bold uppercase tracking-widest ${
            isRefreshing ? 'text-[#F08B46]' : reachedThreshold ? 'text-[#56B94A]' : 'text-gray-400'
          }`}
          style={{ transition: 'color 0.15s ease-out' }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

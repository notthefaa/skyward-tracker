"use client";

import { Loader2 } from "lucide-react";

interface PullIndicatorProps {
  pullDistance: number;
  pullProgress: number;
  isRefreshing: boolean;
  phase: 'idle' | 'pulling' | 'releasing' | 'refreshing';
}

export default function PullIndicator({ pullDistance, pullProgress, isRefreshing, phase }: PullIndicatorProps) {
  if (phase === 'idle') return null;

  const reachedThreshold = pullProgress >= 1;
  const label = isRefreshing ? 'Refreshing...' : reachedThreshold ? 'Release to refresh' : 'Pull to refresh';

  // Use CSS transition for releasing/refreshing, no transition while actively pulling
  const useTransition = phase === 'releasing' || phase === 'refreshing';

  return (
    <div 
      className="flex flex-col items-center justify-end overflow-hidden pointer-events-none"
      style={{ 
        height: pullDistance,
        transition: useTransition ? 'height 0.35s cubic-bezier(0.2, 0.9, 0.3, 1)' : 'none',
        marginTop: -8,
        marginBottom: pullDistance > 0 ? 4 : 0,
      }}
    >
      <div className="flex items-center gap-2 pb-2">
        <Loader2
          size={16}
          className={isRefreshing ? 'text-[#F08B46] animate-spin' : reachedThreshold ? 'text-[#56B94A]' : 'text-gray-400'}
          style={{
            transition: 'transform 0.15s ease-out, color 0.15s ease-out',
            transform: isRefreshing ? 'none' : `rotate(${pullProgress * 360}deg)`,
          }}
        />
        <span 
          className={`text-[10px] font-bold uppercase tracking-widest transition-colors duration-150 ${
            isRefreshing ? 'text-[#F08B46]' : reachedThreshold ? 'text-[#56B94A]' : 'text-gray-400'
          }`}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

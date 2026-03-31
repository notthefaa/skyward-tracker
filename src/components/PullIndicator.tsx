"use client";

import { Loader2 } from "lucide-react";

interface PullIndicatorProps {
  pullDistance: number;
  pullProgress: number;
  isRefreshing: boolean;
}

export default function PullIndicator({ pullDistance, pullProgress, isRefreshing }: PullIndicatorProps) {
  if (pullDistance <= 0 && !isRefreshing) return null;

  return (
    <div 
      className="flex justify-center items-center overflow-hidden transition-all duration-150 ease-out"
      style={{ height: pullDistance > 0 || isRefreshing ? Math.max(pullDistance, isRefreshing ? 48 : 0) : 0 }}
    >
      <div 
        className="transition-all duration-150 ease-out"
        style={{ 
          opacity: Math.max(pullProgress, isRefreshing ? 1 : 0),
          transform: `scale(${Math.max(0.5, Math.min(pullProgress, 1))}) rotate(${pullProgress * 360}deg)`,
        }}
      >
        <Loader2 
          size={24} 
          className={`text-[#F08B46] ${isRefreshing ? 'animate-spin' : ''}`} 
        />
      </div>
    </div>
  );
}

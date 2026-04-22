"use client";

import { Loader2, ArrowDown, Check } from "lucide-react";

interface PullIndicatorProps {
  pullProgress: number;
  phase: 'idle' | 'pulling' | 'refreshing' | 'done';
}

export default function PullIndicator({ pullProgress, phase }: PullIndicatorProps) {
  if (phase === 'idle') return null;

  const reachedThreshold = pullProgress >= 1;

  let icon: React.ReactNode;
  let label: string;
  let colorClass: string;
  let bgClass: string;

  if (phase === 'done') {
    icon = <Check size={14} strokeWidth={3} />;
    label = 'Updated';
    colorClass = 'text-[#56B94A]';
    bgClass = 'bg-green-50 border-green-200';
  } else if (phase === 'refreshing') {
    icon = <Loader2 size={14} className="animate-spin" />;
    label = 'Refreshing...';
    colorClass = 'text-mxOrange';
    bgClass = 'bg-orange-50 border-orange-200';
  } else if (reachedThreshold) {
    icon = <ArrowDown size={14} style={{ transform: 'rotate(180deg)' }} />;
    label = 'Release to refresh';
    colorClass = 'text-[#56B94A]';
    bgClass = 'bg-green-50 border-green-200';
  } else {
    icon = <ArrowDown size={14} style={{ transform: `rotate(${pullProgress * 180}deg)`, transition: 'transform 0.1s ease-out' }} />;
    label = 'Pull to refresh';
    colorClass = 'text-gray-500';
    bgClass = 'bg-white border-gray-200';
  }

  // During pull: opacity ramps up from 0.3 progress to 0.7 progress
  // During refreshing/done: always fully visible
  const opacity = (phase === 'refreshing' || phase === 'done')
    ? 1
    : Math.min(Math.max((pullProgress - 0.15) / 0.5, 0), 1);

  return (
    <div
      className="fixed left-0 right-0 flex justify-center pointer-events-none"
      style={{
        top: 'calc(3.5rem + env(safe-area-inset-top, 0px))',
        zIndex: 50,
        opacity,
        transition: (phase === 'done') ? 'opacity 0.5s ease-out' : 'opacity 0.15s ease-out',
      }}
    >
      <div
        className={`flex items-center gap-2 px-4 py-2 rounded-b-lg border border-t-0 shadow-sm ${bgClass}`}
        style={{
          transform: (phase === 'refreshing' || phase === 'done')
            ? 'translateY(0)'
            : `translateY(${Math.min(pullProgress * 8, 8) - 8}px)`,
          transition: (phase === 'refreshing' || phase === 'done')
            ? 'transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1)'
            : 'none',
        }}
      >
        <span className={colorClass}>{icon}</span>
        <span className={`text-[10px] font-oswald font-bold uppercase tracking-widest whitespace-nowrap ${colorClass}`}>
          {label}
        </span>
      </div>
    </div>
  );
}

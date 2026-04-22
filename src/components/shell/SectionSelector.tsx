"use client";

import type { LucideIcon } from "lucide-react";

/**
 * Shared pill/tab selector used at the top of multi-view sections.
 * Mirrors the MaintenanceTab pattern — a row of pills with a bottom
 * border that becomes the pill's accent color when active.
 *
 * Items route two ways:
 *   - within the currently-rendered tab (the parent handles via onSelect)
 *   - across app tabs (parent dispatches the appropriate navigation)
 *
 * This component doesn't know which; it just calls onSelect(key).
 */

export interface SelectorItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Active-state color — border + text. Matches the section's
   * canonical accent so the selector feels like an extension of
   * the page it heads. */
  color: string;
}

interface Props {
  items: SelectorItem[];
  selectedKey: string;
  onSelect: (key: string) => void;
  /** Reduce text size / padding for denser mobile layouts. Default tight. */
  compact?: boolean;
}

export default function SectionSelector({ items, selectedKey, onSelect, compact = false }: Props) {
  const textSize = compact ? 'text-[10px]' : 'text-xs';
  const py = compact ? 'py-2' : 'py-3';

  return (
    <div className="flex mb-4 border-b-2 border-gray-200 overflow-x-auto scrollbar-hide sticky top-0 z-10 bg-neutral-100 -mt-4 pt-4">
      {items.map(it => {
        const active = it.key === selectedKey;
        const Icon = it.icon;
        return (
          <button
            key={it.key}
            onClick={() => onSelect(it.key)}
            aria-current={active ? 'page' : undefined}
            className={`flex-1 min-w-[5.5rem] ${py} ${textSize} font-oswald font-bold uppercase tracking-widest transition-colors active:scale-95 flex items-center justify-center gap-1.5 border-b-2 -mb-[2px]`}
            style={
              active
                ? { borderColor: it.color, color: it.color }
                : { borderColor: 'transparent', color: '#9CA3AF' }
            }
          >
            <Icon size={compact ? 13 : 16} />
            <span className="whitespace-nowrap">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

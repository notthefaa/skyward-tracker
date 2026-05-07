"use client";

// Shared visual renderer for NavTray items. Used both by the
// eager static path and the lazy-loaded NavTraySortable. Kept as
// a function (not a component) so it can accept dnd-kit refs/
// listeners directly without an extra wrapper element.

import type { TrayItem } from "./NavTray";

interface RenderArgs {
  item: TrayItem;
  reordering: boolean;
  isDragging?: boolean;
  isSelected: boolean;
  unreadBadgeKey?: string;
  unreadCount?: number;
  onSelect: (key: string) => void;
  // Optional dnd-kit bindings (only set during reorder mode)
  setNodeRef?: (el: HTMLElement | null) => void;
  style?: React.CSSProperties;
  // dnd-kit's DraggableAttributes / SyntheticListenerMap aren't a
  // plain index signature, so accept the loose object shape and
  // spread them through verbatim.
  attributes?: Record<string, unknown> | object;
  listeners?: Record<string, unknown> | object;
}

export function renderTrayItemContent({
  item,
  reordering,
  isDragging = false,
  isSelected,
  unreadBadgeKey,
  unreadCount,
  onSelect,
  setNodeRef,
  style,
  attributes,
  listeners,
}: RenderArgs) {
  // dnd-kit sets aria-disabled=true on the wrapper whenever the
  // sortable is disabled. The static-path doesn't use dnd-kit so
  // there's nothing to strip; the sortable path passes attributes
  // through verbatim (we only mount it when reordering=true).
  const safeAttributes = (attributes ?? {}) as Record<string, unknown>;
  const safeListeners = (listeners ?? {}) as Record<string, unknown>;

  const Icon = item.icon;

  // Active item renders in navy; inactive items in gray-400. Matches
  // the main bottom nav's "highlight where you are" pattern. Disabled
  // ("soon") items always render in gray regardless of selection.
  const iconColor = item.soon && !reordering
    ? '#9CA3AF'
    : isSelected ? '#091F3C' : '#9CA3AF';
  const labelTextClass = item.soon && !reordering
    ? 'text-gray-400'
    : isSelected ? 'text-navy' : 'text-gray-400';

  return (
    <div
      key={item.key}
      ref={setNodeRef as ((el: HTMLDivElement | null) => void) | undefined}
      style={style}
      {...safeAttributes}
      {...(reordering ? safeListeners : {})}
      className={`flex flex-col items-center justify-center gap-1 py-1 rounded-lg
        ${reordering ? 'shrink-0 w-16' : 'flex-1 min-w-[3.5rem]'}
        ${isDragging ? 'opacity-90 shadow-lg bg-white/90 rounded-xl scale-105' : ''}
        ${reordering && !isDragging ? 'bg-white/40 ring-1 ring-gray-300/50' : ''}
        ${!reordering && item.soon ? 'opacity-40 cursor-default' : ''}
        ${!reordering && !item.soon ? 'active:scale-95 active:bg-white/60 cursor-pointer transition-transform' : ''}
        ${reordering ? 'cursor-grab active:cursor-grabbing touch-none' : ''}
      `}
      onClick={() => {
        if (reordering || item.soon) return;
        onSelect(item.key);
      }}
    >
      <div className="relative mb-1">
        <Icon size={20} style={{ color: iconColor }} />
        {!reordering && item.key === unreadBadgeKey && (unreadCount ?? 0) > 0 && (
          <span className="absolute -top-1 -right-2 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-danger text-[8px] text-white font-bold items-center justify-center border border-white"></span>
          </span>
        )}
      </div>
      <span className={`text-[10px] font-bold uppercase tracking-widest leading-tight text-center whitespace-nowrap ${labelTextClass}`}>
        {item.label}
      </span>
    </div>
  );
}

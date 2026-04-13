"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LucideIcon } from "lucide-react";
import { GripVertical } from "lucide-react";
import { supabase } from "@/lib/supabase";

// ─── Types ───

export interface TrayItem {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
  soon: boolean;
}

interface NavTrayProps {
  items: readonly TrayItem[];
  visible: boolean;
  userId: string | null;
  storageKey: string; // e.g. "mx" or "more"
  unreadBadgeKey?: string; // item key that should show a badge
  unreadCount?: number;
  onSelect: (key: string) => void;
  onClose: () => void;
}

// ─── Preference persistence (Supabase + localStorage cache) ───

const PREF_PREFIX = 'tray_order_'; // Supabase pref_key prefix
const LS_PREFIX = 'aft_tray_order_'; // localStorage cache prefix

/** Read order from localStorage cache (instant, sync) */
function loadCachedOrder(storageKey: string, userId: string | null): string[] | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}${storageKey}_${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Write order to localStorage cache */
function cacheOrder(storageKey: string, userId: string | null, keys: string[]) {
  if (!userId) return;
  localStorage.setItem(`${LS_PREFIX}${storageKey}_${userId}`, JSON.stringify(keys));
}

/** Load order from Supabase (async, cross-device source of truth) */
async function loadRemoteOrder(storageKey: string, userId: string): Promise<string[] | null> {
  try {
    const { data, error } = await supabase
      .from('aft_user_preferences')
      .select('value')
      .eq('user_id', userId)
      .eq('pref_key', `${PREF_PREFIX}${storageKey}`)
      .maybeSingle();
    if (error || !data) return null;
    return data.value as string[];
  } catch {
    return null;
  }
}

/** Save order to both Supabase and localStorage cache */
function saveOrder(storageKey: string, userId: string | null, keys: string[]) {
  // Instant local cache
  cacheOrder(storageKey, userId, keys);
  // Async remote persist (fire-and-forget)
  if (userId) {
    supabase.from('aft_user_preferences').upsert(
      { user_id: userId, pref_key: `${PREF_PREFIX}${storageKey}`, value: keys },
      { onConflict: 'user_id,pref_key' }
    ).then(({ error }) => {
      if (error) console.warn('Failed to save tray order to Supabase:', error.message);
    });
  }
}

// ─── Sortable Item ───

function SortableItem({
  item,
  reordering,
  unreadBadgeKey,
  unreadCount,
  onSelect,
}: {
  item: TrayItem;
  reordering: boolean;
  unreadBadgeKey?: string;
  unreadCount?: number;
  onSelect: (key: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.key, disabled: !reordering });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.8 : undefined,
  };

  const Icon = item.icon;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(reordering ? listeners : {})}
      className={`flex flex-col items-center justify-center gap-1 rounded-lg transition-all shrink-0
        ${reordering ? 'w-16 py-1.5' : 'w-16 py-1'}
        ${isDragging ? 'scale-110 shadow-lg bg-white/80 rounded-xl' : ''}
        ${reordering && !isDragging ? 'animate-[wiggle_0.3s_ease-in-out_infinite]' : ''}
        ${!reordering && item.soon ? 'opacity-40 cursor-default' : ''}
        ${!reordering && !item.soon ? 'active:scale-95 active:bg-white/60 cursor-pointer' : ''}
        ${reordering ? 'cursor-grab active:cursor-grabbing' : ''}
      `}
      onClick={() => {
        if (reordering || item.soon) return;
        onSelect(item.key);
      }}
    >
      {reordering && (
        <GripVertical size={10} className="text-gray-400 -mb-0.5" />
      )}
      <div className="relative">
        <Icon size={18} style={{ color: item.soon && !reordering ? '#9CA3AF' : item.color }} />
        {!reordering && item.key === unreadBadgeKey && (unreadCount ?? 0) > 0 && (
          <span className="absolute -top-1 -right-2 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#CE3732] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-[#CE3732] text-[8px] text-white font-bold items-center justify-center border border-white"></span>
          </span>
        )}
      </div>
      <span className={`text-[9px] font-bold uppercase tracking-wider leading-tight text-center whitespace-nowrap ${item.soon && !reordering ? 'text-gray-400' : 'text-navy'}`}>
        {item.label}
      </span>
    </div>
  );
}

// ─── Main NavTray Component ───

export default function NavTray({
  items,
  visible,
  userId,
  storageKey,
  unreadBadgeKey,
  unreadCount,
  onSelect,
  onClose,
}: NavTrayProps) {
  // Build ordered list from saved order + defaults
  const [orderedItems, setOrderedItems] = useState<TrayItem[]>([]);
  const [reordering, setReordering] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  /** Apply a saved key-order array to the items list */
  const applyOrder = useCallback((savedKeys: string[]) => {
    const itemMap = new Map(items.map(i => [i.key, i]));
    const ordered: TrayItem[] = [];
    for (const key of savedKeys) {
      const item = itemMap.get(key);
      if (item) {
        ordered.push(item);
        itemMap.delete(key);
      }
    }
    Array.from(itemMap.values()).forEach(item => ordered.push(item));
    setOrderedItems(ordered);
  }, [items]);

  // Initialize: cache first (instant), then sync from Supabase
  useEffect(() => {
    // 1. Instant render from localStorage cache
    const cached = loadCachedOrder(storageKey, userId);
    if (cached) {
      applyOrder(cached);
    } else {
      setOrderedItems([...items]);
    }

    // 2. Async sync from Supabase (cross-device source of truth)
    if (userId) {
      loadRemoteOrder(storageKey, userId).then(remote => {
        if (remote) {
          applyOrder(remote);
          // Update local cache to match remote
          cacheOrder(storageKey, userId, remote);
        }
      });
    }
  }, [items, storageKey, userId, applyOrder]);

  // Close reorder mode when tray hides
  useEffect(() => {
    if (!visible) setReordering(false);
  }, [visible]);

  // ─── Long-press detection ───
  const handlePointerDown = useCallback(() => {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setReordering(true);
    }, 500);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // ─── DnD sensors (only active in reorder mode) ───
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 5 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 0, tolerance: 5 },
  });
  const sensors = useSensors(pointerSensor, touchSensor);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        setOrderedItems(prev => {
          const oldIndex = prev.findIndex(i => i.key === active.id);
          const newIndex = prev.findIndex(i => i.key === over.id);
          const next = arrayMove(prev, oldIndex, newIndex);
          saveOrder(storageKey, userId, next.map(i => i.key));
          return next;
        });
      }
    },
    [storageKey, userId]
  );

  // ─── Scroll fade state ───
  const [showFade, setShowFade] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      setShowFade(el.scrollWidth > el.clientWidth && el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', check);
      ro.disconnect();
    };
  }, [orderedItems, visible]);

  return (
    <>
      {/* Backdrop */}
      {visible && !reordering && (
        <div className="fixed inset-0 z-[9997]" onClick={onClose} />
      )}

      <div
        className={`fixed left-0 right-0 z-[9998] transition-all duration-200 ease-out ${visible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}`}
        style={{ bottom: 'calc(3rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="bg-[#F0EDE8] border-t border-gray-300 shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
          {/* Done button row */}
          {reordering && (
            <div className="flex justify-end px-3 pt-1.5">
              <button
                onClick={() => setReordering(false)}
                className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] active:scale-95 px-2 py-0.5"
              >
                Done
              </button>
            </div>
          )}

          <div className="relative max-w-3xl mx-auto">
            {/* Scrollable row */}
            <div
              ref={scrollRef}
              className="flex items-center gap-1 px-2 py-2 overflow-x-auto scrollbar-hide"
              style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}
              onPointerDown={!reordering ? handlePointerDown : undefined}
              onPointerUp={!reordering ? handlePointerUp : undefined}
              onPointerLeave={!reordering ? handlePointerLeave : undefined}
            >
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedItems.map(i => i.key)}
                  strategy={horizontalListSortingStrategy}
                >
                  {orderedItems.map(item => (
                    <SortableItem
                      key={item.key}
                      item={item}
                      reordering={reordering}
                      unreadBadgeKey={unreadBadgeKey}
                      unreadCount={unreadCount}
                      onSelect={onSelect}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>

            {/* Right fade hint */}
            {showFade && !reordering && (
              <div className="absolute right-0 top-0 bottom-0 w-8 pointer-events-none bg-gradient-to-l from-[#F0EDE8] to-transparent" />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

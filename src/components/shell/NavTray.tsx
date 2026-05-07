"use client";

import { useState, useEffect, useRef, useCallback, lazy, Suspense, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { renderTrayItemContent } from "./NavTrayItemContent";

// Lazy-loaded reorder shell. dnd-kit (~50 KB minified) only ships
// once the user long-presses to enter reorder mode. The Suspense
// fallback re-renders the static items so the tray doesn't flash
// empty during the brief import window.
const NavTraySortable = lazy(() => import("./NavTraySortable"));

// ─── Types ───

type IconComponent = React.ComponentType<{ size?: number; style?: React.CSSProperties; className?: string }>;

export interface TrayItem {
  key: string;
  label: ReactNode;
  icon: IconComponent;
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
  /** Currently-active tray destination. Rendered in navy (vs. the
   * default gray-400 for inactive items) so the tray mirrors the
   * main nav's "highlight where you are" affordance. Null when no
   * tray destination is current. */
  selectedKey?: string | null;
  onSelect: (key: string) => void;
  onClose: () => void;
}

// ─── Preference persistence (Supabase + localStorage cache) ───

const PREF_PREFIX = 'tray_order_';
const LS_PREFIX = 'aft_tray_order_';

function loadCachedOrder(storageKey: string, userId: string | null): string[] | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}${storageKey}_${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function cacheOrder(storageKey: string, userId: string | null, keys: string[]) {
  if (!userId) return;
  localStorage.setItem(`${LS_PREFIX}${storageKey}_${userId}`, JSON.stringify(keys));
}

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

function saveOrder(storageKey: string, userId: string | null, keys: string[]) {
  cacheOrder(storageKey, userId, keys);
  if (userId) {
    supabase.from('aft_user_preferences').upsert(
      { user_id: userId, pref_key: `${PREF_PREFIX}${storageKey}`, value: keys },
      { onConflict: 'user_id,pref_key' }
    ).then(({ error }) => {
      if (error) console.warn('Failed to save tray order to Supabase:', error.message);
    });
  }
}

// ─── Main NavTray Component ───

export default function NavTray({
  items,
  visible,
  userId,
  storageKey,
  unreadBadgeKey,
  unreadCount,
  selectedKey,
  onSelect,
  onClose,
}: NavTrayProps) {
  const [orderedItems, setOrderedItems] = useState<TrayItem[]>([]);
  const [reordering, setReordering] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    const cached = loadCachedOrder(storageKey, userId);
    if (cached) {
      applyOrder(cached);
    } else {
      setOrderedItems([...items]);
    }
    if (userId) {
      loadRemoteOrder(storageKey, userId).then(remote => {
        if (remote) {
          applyOrder(remote);
          cacheOrder(storageKey, userId, remote);
        }
      });
    }
  }, [items, storageKey, userId, applyOrder]);

  useEffect(() => {
    if (!visible) setReordering(false);
  }, [visible]);

  // ─── Long-press detection ───
  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(() => {
    clearLongPress();
    // Warm the dnd-kit chunk so it's likely already in memory by
    // the time the 500ms timer fires and reordering flips on. The
    // import is fire-and-forget; webpack treats it as the same
    // chunk as the dynamic() above, so the second resolve is free.
    void import("./NavTraySortable");
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      setReordering(true);
    }, 500);
  }, [clearLongPress]);

  // ─── Reorder result handler (used by lazy sortable) ───
  const handleReorder = useCallback((next: TrayItem[]) => {
    setOrderedItems(next);
    saveOrder(storageKey, userId, next.map(i => i.key));
  }, [storageKey, userId]);

  // ─── Scroll fade ───
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
      {visible && !reordering && (
        <div className="fixed inset-0 z-[9997]" onClick={onClose} />
      )}

      <nav
        aria-label="Secondary navigation"
        aria-hidden={!visible}
        className={`fixed left-0 right-0 z-[9998] transition-all duration-200 ease-out ${visible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}`}
        style={{ bottom: 'calc(3rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="bg-[#F0EDE8] border-t border-gray-300 shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
          {reordering && (
            <div className="flex justify-between items-center px-3 pt-1.5">
              <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Hold & drag to reorder</span>
              <button
                onClick={() => setReordering(false)}
                className="text-[10px] font-bold uppercase tracking-widest text-info active:scale-95 px-2 py-0.5"
              >
                Done
              </button>
            </div>
          )}

          <div className="relative max-w-3xl mx-auto">
            <div
              ref={scrollRef}
              className={`flex items-center justify-center gap-1 px-2 py-2 scrollbar-hide ${reordering ? 'overflow-x-hidden' : 'overflow-x-auto'}`}
              style={{ WebkitOverflowScrolling: 'touch' }}
              onPointerDown={!reordering ? handlePointerDown : undefined}
              onPointerUp={!reordering ? clearLongPress : undefined}
              onPointerLeave={!reordering ? clearLongPress : undefined}
              onPointerCancel={!reordering ? clearLongPress : undefined}
            >
              {reordering ? (
                <Suspense
                  fallback={orderedItems.map(item => renderTrayItemContent({
                    item,
                    reordering: false,
                    isSelected: item.key === (selectedKey ?? null),
                    unreadBadgeKey,
                    unreadCount,
                    onSelect,
                  }))}
                >
                  <NavTraySortable
                    items={orderedItems}
                    unreadBadgeKey={unreadBadgeKey}
                    unreadCount={unreadCount}
                    selectedKey={selectedKey ?? null}
                    onReorder={handleReorder}
                    onSelect={onSelect}
                  />
                </Suspense>
              ) : (
                orderedItems.map(item => renderTrayItemContent({
                  item,
                  reordering: false,
                  isSelected: item.key === (selectedKey ?? null),
                  unreadBadgeKey,
                  unreadCount,
                  onSelect,
                }))
              )}
            </div>

            {showFade && !reordering && (
              <div className="absolute right-0 top-0 bottom-0 w-8 pointer-events-none bg-gradient-to-l from-[#F0EDE8] to-transparent" />
            )}
          </div>
        </div>
      </nav>
    </>
  );
}

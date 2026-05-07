"use client";

// =============================================================
// NavTraySortable — dnd-kit-powered reorder shell
// =============================================================
// NavTray imports this lazily (next/dynamic) only when the user
// long-presses to enter reorder mode. The eager NavTray bundle
// stays free of @dnd-kit/{core,sortable,utilities} (~50 KB min).
// While the chunk is loading, NavTray keeps rendering the static
// items so the tray doesn't flash empty.

import { useCallback } from "react";
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
import type { TrayItem } from "./NavTray";
import { renderTrayItemContent } from "./NavTrayItemContent";

interface Props {
  items: TrayItem[];
  unreadBadgeKey?: string;
  unreadCount?: number;
  selectedKey?: string | null;
  onReorder: (next: TrayItem[]) => void;
  onSelect: (key: string) => void;
}

function SortableItem({
  item,
  unreadBadgeKey,
  unreadCount,
  isSelected,
  onSelect,
}: {
  item: TrayItem;
  unreadBadgeKey?: string;
  unreadCount?: number;
  isSelected: boolean;
  onSelect: (key: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.key });

  // Only apply translate — no scale/transition-all that fights the drag
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition: isDragging ? 'none' : transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return renderTrayItemContent({
    item,
    reordering: true,
    isDragging,
    isSelected,
    unreadBadgeKey,
    unreadCount,
    onSelect,
    setNodeRef,
    style,
    attributes,
    listeners,
  });
}

export default function NavTraySortable({
  items,
  unreadBadgeKey,
  unreadCount,
  selectedKey,
  onReorder,
  onSelect,
}: Props) {
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 0, tolerance: 8 },
  });
  const sensors = useSensors(pointerSensor, touchSensor);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = items.findIndex(i => i.key === active.id);
      const newIndex = items.findIndex(i => i.key === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      onReorder(arrayMove(items, oldIndex, newIndex));
    },
    [items, onReorder]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map(i => i.key)}
        strategy={horizontalListSortingStrategy}
      >
        {items.map(item => (
          <SortableItem
            key={item.key}
            item={item}
            unreadBadgeKey={unreadBadgeKey}
            unreadCount={unreadCount}
            isSelected={item.key === (selectedKey ?? null)}
            onSelect={onSelect}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

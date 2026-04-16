import { FileText, FolderOpen, Gauge, MessageSquare } from "lucide-react";
import type { SelectorItem } from "./SectionSelector";

/** Unified top-selector for pages inside the "More" nav tray.
 * Each key matches an AppTab, unlike the MX selector which
 * mixes subtabs + app tabs. Clicks dispatch a custom event that
 * AppShell catches and routes via navigateTab. */
export const MORE_SELECTOR_ITEMS: SelectorItem[] = [
  { key: 'notes',      label: 'Notes',      icon: FileText, color: '#525659' },
  { key: 'documents',  label: 'Docs',       icon: FolderOpen, color: '#56B94A' },
  { key: 'equipment',  label: 'Equipment',  icon: Gauge, color: '#3AB0FF' },
  { key: 'howard',     label: 'Howard',     icon: MessageSquare, color: '#e6651b' },
];

export const MORE_NAV_EVENT = 'aft:more-nav';

export function emitMoreNavigate(key: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MORE_NAV_EVENT, { detail: key }));
}

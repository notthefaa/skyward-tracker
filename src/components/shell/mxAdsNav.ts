import { Wrench, AlertTriangle, ClipboardList, ShieldAlert } from "lucide-react";
import type { SelectorItem } from "./SectionSelector";

/** Unified top-selector used on Maintenance / Squawks / Service / ADs
 * pages. One keyspace spans both the 'mx' app tab (maintenance /
 * squawks / service subtabs) and the 'ads' app tab. Clicks dispatch
 * a custom event that AppShell catches and routes appropriately. */
export const MX_ADS_SELECTOR_ITEMS: SelectorItem[] = [
  { key: 'maintenance', label: 'Maintenance', icon: Wrench, color: '#F08B46' },
  { key: 'squawks',     label: 'Squawks',     icon: AlertTriangle, color: '#CE3732' },
  { key: 'service',     label: 'Service',     icon: ClipboardList, color: '#0EA5E9' },
  { key: 'ads',         label: 'ADs',         icon: ShieldAlert, color: '#091F3C' },
];

/** The event's detail is the selected key. AppShell listens globally. */
export const MX_ADS_NAV_EVENT = 'aft:mx-ads-nav';

export function emitMxAdsNavigate(key: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MX_ADS_NAV_EVENT, { detail: key }));
}

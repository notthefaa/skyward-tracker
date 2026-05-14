"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppTab } from "@/lib/types";

const VALID_TABS = [
  'fleet', 'summary', 'times', 'calendar', 'mx', 'notes',
  'howard', 'howard-usage', 'documents', 'equipment', 'ads', 'more',
] as const;

const HISTORY_MAX = 20;

// AppTab state + history stack + browser-back integration.
//
// `navigateTab(tab)` is the canonical way to change tabs anywhere in
// the shell — it pushes the previous tab onto an internal stack and
// also fires `window.history.pushState` so the platform back button
// pops the stack instead of leaving the app. The popstate listener
// reverses one entry at a time.
//
// `activeTab` is initialized from sessionStorage so refreshing inside
// the app lands you back where you were.
export function useTabHistory(initialTab: AppTab = 'fleet') {
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('aft_active_tab');
      if (saved && (VALID_TABS as readonly string[]).includes(saved)) {
        return saved as AppTab;
      }
    }
    return initialTab;
  });

  const tabHistoryRef = useRef<AppTab[]>([]);

  const navigateTab = useCallback((tab: AppTab) => {
    setActiveTab(prev => {
      if (prev !== tab) {
        tabHistoryRef.current.push(prev);
        if (tabHistoryRef.current.length > HISTORY_MAX) tabHistoryRef.current.shift();
        try { window.history.pushState({ tab }, '', ''); } catch {}
      }
      return tab;
    });
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const prev = tabHistoryRef.current.pop();
      if (prev) setActiveTab(prev);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return { activeTab, setActiveTab, navigateTab };
}

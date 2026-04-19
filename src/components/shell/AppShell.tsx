"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { useFleetData, useRealtimeSync, useGroundedStatus, useAircraftRole, usePullToRefresh } from "@/hooks";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { NETWORK_TIMEOUT_MS } from "@/lib/constants";
import { swrKeys } from "@/lib/swrKeys";
import useSWR from "swr";
import { HOWARD_STALE_MS } from "@/lib/howard/quickPrompts";
import { useToast } from "@/components/ToastProvider";
import dynamic from "next/dynamic";
import type { AircraftWithMetrics, AppTab, LogSubTab, MxSubTab } from "@/lib/types";
import {
  Wrench, AlertTriangle, FileText, LogOut,
  ChevronDown, Home, LayoutGrid, Send, ShieldCheck, X, Share, Copy, WifiOff, Loader2, Calendar, Settings,
  MoreHorizontal, FolderOpen, ShieldAlert,
  ListChecks, PenLine, Plane, BarChart3, Gauge, CheckSquare, Plus,
} from "lucide-react";
import { HowardIcon } from "@/components/shell/TrayIcons";

const PilotOnboarding = dynamic(() => import("@/components/PilotOnboarding"));
const HowardWelcome = dynamic(() => import("@/components/HowardWelcome"), { ssr: false });
const HowardTour = dynamic(() => import("@/components/HowardTour"), { ssr: false });
const HowardOnboardingChat = dynamic(() => import("@/components/howard/HowardOnboardingChat"), { ssr: false });
const AircraftModal = dynamic(() => import("@/components/modals/AircraftModal"));
const AdminModals = dynamic(() => import("@/components/modals/AdminModals"));
const SettingsModal = dynamic(() => import("@/components/modals/SettingsModal"));
const FeaturesOverviewModal = dynamic(() => import("@/components/modals/FeaturesOverviewModal"));
const PullIndicator = dynamic(() => import("@/components/PullIndicator"));
import { SummarySkeleton, FleetSkeleton, TabSkeleton } from "@/components/Skeletons";
const SummaryTab = dynamic(() => import("@/components/tabs/SummaryTab"), { loading: () => <SummarySkeleton /> });
const LogRouter = dynamic(() => import("@/components/tabs/LogRouter"), { loading: () => <TabSkeleton /> });
const CalendarTab = dynamic(() => import("@/components/tabs/CalendarTab"), { loading: () => <TabSkeleton /> });
const MaintenanceTab = dynamic(() => import("@/components/tabs/MaintenanceTab"), { loading: () => <TabSkeleton /> });
const NotesTab = dynamic(() => import("@/components/tabs/NotesTab"), { loading: () => <TabSkeleton /> });
const FleetSummary = dynamic(() => import("@/components/tabs/FleetSummary"), { loading: () => <FleetSkeleton /> });
const HowardTab = dynamic(() => import("@/components/tabs/HowardTab"), { loading: () => <TabSkeleton /> });
const HowardUsageTab = dynamic(() => import("@/components/tabs/HowardUsageTab"), { loading: () => <TabSkeleton /> });
const HowardLauncher = dynamic(() => import("@/components/howard/HowardLauncher"), { ssr: false });
const DocumentsTab = dynamic(() => import("@/components/tabs/DocumentsTab"), { loading: () => <TabSkeleton /> });
const EquipmentTab = dynamic(() => import("@/components/tabs/EquipmentTab"), { loading: () => <TabSkeleton /> });
const ADsTab = dynamic(() => import("@/components/tabs/ADsTab"), { loading: () => <TabSkeleton /> });
import NavTray, { type TrayItem } from "@/components/shell/NavTray";

/** Log secondary toolbar items. VOR / Oil / Tire live behind a single
 * "Checks" entry now — the ChecksTab surfaces all three with dashboard
 * dials at the top, so three nav entries collapsed into one. */
const logTrayItems = [
  { key: 'flights', label: 'Flights', icon: Plane, color: '#3AB0FF', soon: false },
  { key: 'checks', label: 'Ops Checks', icon: CheckSquare, color: '#3AB0FF', soon: false },
] as const;

/** MX secondary toolbar items. "ADs" renders with a smaller lowercase
 * 's' (airworthiness-directives convention — A and D are the acronym,
 * 's' is the plural). The tray's uppercase CSS would flatten it to
 * "ADS", so the 's' gets its own span with normal-case + reduced
 * em-sized text. */
const ADS_LABEL = (
  <>AD<span className="normal-case text-[0.78em]">s</span></>
);
const mxTrayItems = [
  { key: 'due-items', label: 'Due Items', icon: ListChecks, color: '#F08B46', soon: false },
  { key: 'squawks', label: 'Squawks', icon: AlertTriangle, color: '#CE3732', soon: false },
  { key: 'service', label: 'Service', icon: Wrench, color: '#56B94A', soon: false },
  { key: 'ads', label: ADS_LABEL, icon: ShieldAlert, color: '#7C3AED', soon: false },
] as const;

/** More secondary toolbar items. Howard Usage is reachable from inside
 * the Howard tab itself, so we don't duplicate it here. */
const moreTrayItems = [
  { key: 'notes', label: 'Notes', icon: FileText, color: '#525659', soon: false },
  { key: 'documents', label: 'Documents', icon: FolderOpen, color: '#56B94A', soon: false },
  { key: 'equipment', label: 'Equipment', icon: Gauge, color: '#3AB0FF', soon: false },
  { key: 'howard', label: 'Howard', icon: HowardIcon, color: '#0EA5E9', soon: false },
] as const;

interface AppShellProps {
  session: any;
}

export default function AppShell({ session }: AppShellProps) {
  const { showSuccess, showError, showInfo } = useToast();

  // ─── Fleet Data (extracted hook) ───
  const {
    role, userInitials, completedOnboarding, tourCompleted, setCompletedOnboarding, setTourCompleted,
    allAircraftList, aircraftList, allAccessRecords,
    isDataLoaded, sysSettings, setSysSettings, dataFetchTriggeredRef,
    fetchAircraftData, enrichSingleAircraft, refreshForAircraft, globalMutate,
    globalFleetIndex, fetchGlobalFleetIndex, fetchSingleAircraft,
  } = useFleetData();

  // ─── Navigation State ───
  const companionUrl = process.env.NEXT_PUBLIC_COMPANION_URL || "https://skyward-logit.vercel.app/";
  const [activeTail, setActiveTail] = useState<string>("");
  // First-time onboarding path selection. null = show welcome modal;
  // 'guided' = Howard chat flow; 'form' = classic PilotOnboarding.
  // Persisted locally — if a pilot picks "guided" and reloads mid-chat
  // (flaky connection, accidental nav), they land back on the path they
  // chose instead of the welcome modal. The durable "I'm done" signal is
  // `completed_onboarding` on aft_user_roles — this key only sticks
  // around between the pick and the finish; both paths clear it on
  // completion.
  const [onboardingPath, setOnboardingPathRaw] = useState<'guided' | 'form' | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = window.localStorage.getItem('aft_onboarding_path');
      return stored === 'guided' || stored === 'form' ? stored : null;
    } catch { return null; }
  });
  const setOnboardingPath = (v: 'guided' | 'form' | null) => {
    setOnboardingPathRaw(v);
    if (typeof window === 'undefined') return;
    try {
      if (v) window.localStorage.setItem('aft_onboarding_path', v);
      else window.localStorage.removeItem('aft_onboarding_path');
    } catch { /* storage unavailable — not fatal */ }
  };
  // Features Guide modal — reachable from Settings, from the tour's
  // final step, and from a custom event any Howard surface can fire
  // (his onboarding closer links to it).
  const [showFeaturesGuide, setShowFeaturesGuide] = useState(false);
  // Optional target for the Calendar tab — set by Fleet Schedule when a user
  // taps a reservation there so CalendarTab opens on the right date/view.
  const [calendarInitialDate, setCalendarInitialDate] = useState<Date | null>(null);
  const [calendarInitialView, setCalendarInitialView] = useState<'month' | 'week' | 'day' | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('aft_active_tab');
      if (saved && ['fleet','summary','times','calendar','mx','notes','howard','howard-usage','documents','equipment','ads','more'].includes(saved)) return saved as AppTab;
    }
    return 'fleet';
  });
  const [unreadNotes, setUnreadNotes] = useState(0);
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showLogItModal, setShowLogItModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [expandedNav, setExpandedNav] = useState<'log' | 'mx' | 'more' | null>(null);
  useModalScrollLock(showLogItModal);
  const [mxSubTab, setMxSubTab] = useState<MxSubTab>('maintenance');
  const [logSubTab, setLogSubTab] = useState<LogSubTab>('flights');
  const [showAircraftModal, setShowAircraftModal] = useState(false);
  const [editingAircraftId, setEditingAircraftId] = useState<string | null>(null);
  const [showTailDropdown, setShowTailDropdown] = useState(false);

  // ─── Tab History (supports browser back button + UI back arrow) ───
  const tabHistoryRef = useRef<AppTab[]>([]);
  const isPopStateRef = useRef(false);

  /** Navigate to a tab while maintaining history for back navigation */
  const navigateTab = useCallback((tab: AppTab) => {
    setActiveTab(prev => {
      if (prev !== tab) {
        tabHistoryRef.current.push(prev);
        // Keep history bounded
        if (tabHistoryRef.current.length > 20) tabHistoryRef.current.shift();
        // Push browser history entry so the native back button works
        try { window.history.pushState({ tab }, '', ''); } catch (e) {}
      }
      return tab;
    });
  }, []);

  // Listen for browser back button (popstate)
  useEffect(() => {
    const handlePopState = () => {
      const prev = tabHistoryRef.current.pop();
      if (prev) {
        isPopStateRef.current = true;
        setActiveTab(prev);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Listen for cross-app "Ask Howard" button clicks
  useEffect(() => {
    const handleNavigateHoward = () => {
      setExpandedNav(null);
      navigateTab('howard');
    };
    const handleNavigateHowardUsage = () => {
      setExpandedNav(null);
      navigateTab('howard-usage');
    };
    // Selector on MX / ADs pages dispatches this — route to the right
    // app tab + sub-tab based on the picked key. Keeps every call
    // site of MX_ADS_SELECTOR_ITEMS wired through a single handler.
    const handleMxAdsNav = (e: Event) => {
      const key = (e as CustomEvent).detail as string;
      setExpandedNav(null);
      if (key === 'maintenance' || key === 'squawks' || key === 'service') {
        setMxSubTab(key);
        navigateTab('mx');
      } else if (key === 'ads') {
        navigateTab('ads');
      }
    };
    // Any surface (Howard's closer, tour footer CTA, future in-app
    // links) can fire this to pop the Features Guide.
    const handleOpenFeaturesGuide = () => setShowFeaturesGuide(true);
    const handleMoreNav = (e: Event) => {
      const key = (e as CustomEvent).detail as string;
      setExpandedNav(null);
      if (key === 'notes') navigateTab('notes');
      else if (key === 'documents') navigateTab('documents');
      else if (key === 'equipment') navigateTab('equipment');
      else if (key === 'howard') navigateTab('howard');
    };
    window.addEventListener('aft:navigate-howard', handleNavigateHoward);
    window.addEventListener('aft:navigate-howard-usage', handleNavigateHowardUsage);
    window.addEventListener('aft:mx-ads-nav', handleMxAdsNav);
    window.addEventListener('aft:more-nav', handleMoreNav);
    window.addEventListener('aft:open-features-guide', handleOpenFeaturesGuide);
    return () => {
      window.removeEventListener('aft:navigate-howard', handleNavigateHoward);
      window.removeEventListener('aft:navigate-howard-usage', handleNavigateHowardUsage);
      window.removeEventListener('aft:mx-ads-nav', handleMxAdsNav);
      window.removeEventListener('aft:more-nav', handleMoreNav);
      window.removeEventListener('aft:open-features-guide', handleOpenFeaturesGuide);
    };
  }, [navigateTab]);

  // ─── Derived State (extracted hooks) ───
  const { aircraftStatus, groundedReason, checkGroundedStatus } = useGroundedStatus(allAircraftList);
  const currentAircraftRole = useAircraftRole(activeTail, allAircraftList, allAccessRecords, session);

  // Grounded-banner refresh — ProposedActionCard fires aft:refresh-grounded
  // after any confirmed write that may affect airworthiness. The grounded
  // status comes from direct Supabase queries (not SWR), so the per-
  // aircraft SWR invalidation doesn't trigger it.
  useEffect(() => {
    const handle = () => { if (activeTail) checkGroundedStatus(activeTail); };
    window.addEventListener('aft:refresh-grounded', handle);
    return () => window.removeEventListener('aft:refresh-grounded', handle);
  }, [activeTail, checkGroundedStatus]);

  // ─── Realtime (extracted hook) ───
  const boundRefresh = useCallback(
    (aircraftId: string) => {
      if (session?.user?.id) refreshForAircraft(aircraftId, session.user.id);
    },
    [session, refreshForAircraft]
  );
  useRealtimeSync(session, boundRefresh, globalMutate);

  // ─── Howard resets on fresh sign-in ───
  // Every new auth SIGNED_IN event (distinct from INITIAL_SESSION,
  // which fires on page reload with an existing token) clears the
  // user's Howard thread so a fresh login starts with a blank
  // conversation. Delete happens server-side; the SWR cache is
  // optimistically reset so the UI flips to empty immediately, then
  // revalidate so client state converges with server truth if the
  // DELETE happened to fail (offline, auth hiccup).
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, sess) => {
      if (event !== 'SIGNED_IN' || !sess?.user?.id) return;
      try {
        await authFetch('/api/howard', { method: 'DELETE' });
      } catch {
        // Non-blocking — the client-side cache flush below still happens.
      }
      globalMutate(swrKeys.howardUser(sess.user.id), { thread: null, messages: [] }, { revalidate: true });
    });
    return () => subscription.unsubscribe();
  }, [globalMutate]);

  // ─── Howard stale-session reset (30 min idle) ───
  // Subscribe to Howard's thread cache (SWR dedupes with the launcher
  // and tab subscriptions — one request across all surfaces). When the
  // last interaction is older than HOWARD_STALE_MS, wipe the thread so
  // the pilot doesn't pick up a cold conversation they've forgotten.
  // On return-from-idle, force a revalidation so the check runs against
  // fresh server state rather than whatever was cached.
  const howardUserId = session?.user?.id;
  const { data: howardData, mutate: mutateHoward } = useSWR(
    howardUserId ? swrKeys.howardUser(howardUserId) : null,
    async () => {
      const res = await authFetch('/api/howard');
      if (!res.ok) return { thread: null, messages: [] };
      return await res.json() as { thread: any; messages: any[] };
    },
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );

  useEffect(() => {
    if (!howardUserId || !howardData?.messages?.length) return;
    const msgs = howardData.messages;
    const lastMs = new Date(msgs[msgs.length - 1].created_at).getTime();
    const updatedMs = howardData.thread?.updated_at
      ? new Date(howardData.thread.updated_at).getTime()
      : 0;
    const lastActive = Math.max(lastMs, updatedMs);
    if (!Number.isFinite(lastActive) || lastActive === 0) return;
    if (Date.now() - lastActive <= HOWARD_STALE_MS) return;

    (async () => {
      try { await authFetch('/api/howard', { method: 'DELETE' }); } catch {}
      globalMutate(swrKeys.howardUser(howardUserId), { thread: null, messages: [] }, false);
    })();
  }, [howardData, howardUserId, globalMutate]);

  useEffect(() => {
    if (!howardUserId) return;
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      // Only bother re-syncing if the tab was hidden long enough that
      // staleness could plausibly have crossed the threshold. The
      // threshold is 30 min; poll after 5 min of hidden to give the
      // boundary cases a chance.
      if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) {
        mutateHoward();
      }
      hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [howardUserId, mutateHoward]);

  // ─── Pull to Refresh ───
  const handlePullRefresh = useCallback(async () => {
    if (session?.user?.id) {
      await fetchAircraftData(session.user.id);
      globalMutate(() => true, undefined, { revalidate: true });
      if (activeTail) {
        // Re-enrich the active aircraft after full refresh
        const ac = allAircraftList.find(a => a.tail_number === activeTail);
        if (ac) await enrichSingleAircraft(ac.id);
        checkGroundedStatus(activeTail);
        fetchUnreadNotes(activeTail, session.user.id);
      }
    }
  }, [session, fetchAircraftData, globalMutate, activeTail, allAircraftList, enrichSingleAircraft, checkGroundedStatus]);

  const { pullHandlers, pullProgress, phase: pullPhase, setEnabled: setPullEnabled } = usePullToRefresh({
    onRefresh: handlePullRefresh,
  });

  // ─── Disable pull-to-refresh when any modal is open ───
  useEffect(() => {
    const anyPageModalOpen = showAdminMenu || showLogItModal || showSettingsModal || expandedNav !== null || showAircraftModal || showTailDropdown;
    if (anyPageModalOpen) {
      setPullEnabled(false);
      return;
    }

    const checkForChildModals = () => {
      const fixedElements = document.querySelectorAll('[class*="fixed"][class*="inset-0"]');
      const hasChildModal = fixedElements.length > 0;
      setPullEnabled(!hasChildModal);
    };

    checkForChildModals();

    const observer = new MutationObserver(checkForChildModals);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [showAdminMenu, showLogItModal, showSettingsModal, expandedNav, showAircraftModal, showTailDropdown, setPullEnabled]);

  // ─── Initial Data Fetch ───
  useEffect(() => {
    if (session && !dataFetchTriggeredRef.current) {
      dataFetchTriggeredRef.current = true;
      handleInitialFetch(session.user.id);
    }
  }, [session]);

  // ─── Network Timeout for data loading ───
  const [isNetworkTimeout, setIsNetworkTimeout] = useState(false);
  useEffect(() => {
    let t: NodeJS.Timeout;
    if (session && !isDataLoaded) {
      t = setTimeout(() => setIsNetworkTimeout(true), NETWORK_TIMEOUT_MS);
    }
    return () => { clearTimeout(t); setIsNetworkTimeout(false); };
  }, [session, isDataLoaded]);

  // ─── Persist active tail ───
  useEffect(() => {
    if (activeTail) localStorage.setItem('aft_active_tail', activeTail);
  }, [activeTail]);

  // ─── Persist active tab ───
  useEffect(() => {
    sessionStorage.setItem('aft_active_tab', activeTab);
  }, [activeTab]);

  // ─── Enrich active aircraft metrics + refresh status when tail changes ───
  useEffect(() => {
    if (activeTail && allAircraftList.length > 0 && session) {
      const ac = allAircraftList.find(a => a.tail_number === activeTail);
      if (ac) {
        // Lazy-load metrics for the active aircraft if not yet computed
        if (ac.burnRate === 0 && ac.confidenceScore === 0) {
          enrichSingleAircraft(ac.id);
        }
      }
      checkGroundedStatus(activeTail);
      fetchUnreadNotes(activeTail, session.user.id);
    }
  }, [activeTail, allAircraftList.length, session]);

  // ─── Helpers ───
  const handleInitialFetch = async (userId: string) => {
    const { allPlanes, assigned } = await fetchAircraftData(userId);
    const saved = localStorage.getItem('aft_active_tail');
    if (saved && allPlanes.some(a => a.tail_number === saved)) {
      setActiveTail(saved);
    } else if (assigned.length > 0) {
      setActiveTail(assigned[0].tail_number);
    } else {
      setActiveTail("");
    }

    // Single-aircraft users skip the fleet grid and go straight to Home,
    // unless they had a specific tab saved from a previous session.
    const savedTab = sessionStorage.getItem('aft_active_tab');
    if (assigned.length <= 1 && (!savedTab || savedTab === 'fleet')) {
      setActiveTab('summary');
    }
  };

  const fetchUnreadNotes = async (tail: string, userId: string) => {
    const ac = allAircraftList.find(a => a.tail_number === tail);
    if (!ac) return;
    const { data: notes } = await supabase.from('aft_notes').select('id').eq('aircraft_id', ac.id).is('deleted_at', null);
    if (!notes || notes.length === 0) return setUnreadNotes(0);
    const ids = notes.map(n => n.id);
    const { data: reads } = await supabase.from('aft_note_reads').select('note_id').eq('user_id', userId).in('note_id', ids);
    setUnreadNotes(ids.length - (reads ? reads.length : 0));
  };

  const handleDeleteAircraft = async (id: string) => {
    try {
      const res = await authFetch('/api/aircraft/delete', {
        method: 'DELETE',
        body: JSON.stringify({ aircraftId: id })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to delete aircraft');
      }
    } catch (err: any) {
      showError(err.message);
      return;
    }
    await fetchAircraftData(session.user.id);
    navigateTab('fleet');
  };

  const handleTailChange = (v: string) => {
    setShowTailDropdown(false);
    if (v === '__add_new__') {
      setEditingAircraftId(null);
      setShowAircraftModal(true);
    } else if (v === activeTail) {
      navigateTab('summary');
    } else {
      setActiveTail(v);
      navigateTab('summary');
    }
  };

  /**
   * Called when an admin selects an aircraft from the Global Fleet modal.
   * If the aircraft isn't already loaded (not in the admin's assigned set),
   * fetches it on demand before navigating.
   */
  const handleGlobalFleetSelect = async (tailNumber: string, aircraftId: string) => {
    // Check if already loaded
    const existing = allAircraftList.find(a => a.id === aircraftId);
    if (!existing) {
      // Lazy-load this aircraft's full record
      await fetchSingleAircraft(aircraftId);
    }
    setActiveTail(tailNumber);
    navigateTab('summary');
  };

  const handleCopyQuickLink = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(companionUrl)
        .then(() => showSuccess("Link copied! Open your phone's browser, paste the link, and Add to Home Screen."))
        .catch(() => showInfo("Please manually copy this link: " + companionUrl));
    } else {
      showInfo("Please manually copy this link: " + companionUrl);
    }
  };

  const handleLogout = async () => {
    dataFetchTriggeredRef.current = false;
    setActiveTab('fleet');
    await supabase.auth.signOut();
  };

  const openAircraftForm = (ac: AircraftWithMetrics | null = null) => {
    setEditingAircraftId(ac?.id || null);
    setShowAircraftModal(true);
  };

  // Color for the rendered tab when the caller has already decided it's
  // active. Don't re-check activeTab here — tab.id and activeTab don't
  // always match (e.g., tab.id='log' while activeTab='times'), so a
  // check here would incorrectly return gray on valid active states.
  const getTabColor = (id: string) => {
    const m: Record<string, string> = { summary: 'text-navy', log: 'text-[#3AB0FF]', times: 'text-[#3AB0FF]', calendar: 'text-[#56B94A]', mx: 'text-[#F08B46]', notes: 'text-[#525659]', more: 'text-[#525659]' };
    return m[id] || 'text-brandOrange';
  };

  const getIndicatorColor = (id: string) => {
    const m: Record<string, string> = { summary: 'bg-navy', log: 'bg-[#3AB0FF]', times: 'bg-[#3AB0FF]', calendar: 'bg-[#56B94A]', mx: 'bg-[#F08B46]', notes: 'bg-[#525659]', more: 'bg-[#525659]' };
    return m[id] || 'bg-brandOrange';
  };

  const canEditAircraft = role === 'admin' || currentAircraftRole === 'admin';

  // ─── First-time onboarding state machine ───────────────────────
  // States derive from the aft_user_roles flags (completedOnboarding +
  // tourCompleted) plus a local "welcome path pick":
  //   completedOnboarding=false  → welcome modal (choose guided/form)
  //     onboardingPath='guided'  → Howard-guided chat takes over
  //     onboardingPath='form'    → classic PilotOnboarding form
  //   completedOnboarding=true && tourCompleted=false → spotlight tour
  //   both true → normal app
  // Global admins are pre-flagged in migration 024 so they never land
  // here. While flags are still loading (null), render nothing to
  // avoid a welcome flash.
  // Admins skip the Howard-guided chat (they often set up aircraft via
  // the admin modals or for other users), but they DO see the spotlight
  // tour — it's a 30-second app orientation, not a pilot onboarding,
  // and admins benefit from it just as much as pilots.
  const needsOnboarding = role !== 'admin' && completedOnboarding === false;
  const needsTour = completedOnboarding === true && tourCompleted === false;

  if (isDataLoaded && needsOnboarding) {
    if (onboardingPath === 'guided') {
      return (
        <HowardOnboardingChat
          session={session}
          onLogout={handleLogout}
          onSwitchToForm={() => setOnboardingPath('form')}
          onComplete={() => {
            // The executor flipped completed_onboarding=true server-side
            // and created the aircraft; refetch fleet so the rest of the
            // shell renders normally. The spotlight tour will kick in
            // once tourCompleted is still false.
            setOnboardingPath(null);
            setCompletedOnboarding(true);
            handleInitialFetch(session.user.id);
          }}
        />
      );
    }
    if (onboardingPath === 'form') {
      return (
        <PilotOnboarding
          session={session}
          handleLogout={handleLogout}
          onSuccess={async () => {
            // Mark onboarding done server-side so we don't bounce back
            // to the welcome modal after the fleet refetch completes.
            try {
              await authFetch('/api/user/onboarding-complete', { method: 'POST' });
            } catch {
              // Non-blocking — if the flag write fails, the user still
              // has an aircraft and the next reload's fetch will pick
              // that up via the row.
            }
            setOnboardingPath(null);
            setCompletedOnboarding(true);
            handleInitialFetch(session.user.id);
          }}
        />
      );
    }
    return (
      <HowardWelcome
        onStartGuided={() => setOnboardingPath('guided')}
        onStartForm={() => setOnboardingPath('form')}
        onLogout={handleLogout}
      />
    );
  }

  // ─── Derived UI values ───
  const dropdownOptions = [...aircraftList];
  if (activeTail && !dropdownOptions.some(a => a.tail_number === activeTail)) {
    const o = allAircraftList.find(a => a.tail_number === activeTail);
    if (o) dropdownOptions.push(o);
  }
  const selectedAircraftData = allAircraftList.find(a => a.tail_number === activeTail) || null;
  const showFleetButton = aircraftList.length > 1;

  return (
    <div className="flex flex-col bg-neutral-100 w-full min-h-screen relative">
      <AdminModals
        showAdminMenu={showAdminMenu} 
        setShowAdminMenu={setShowAdminMenu} 
        allAircraftList={allAircraftList} 
        setActiveTail={setActiveTail} 
        setActiveTab={setActiveTab} 
        sysSettings={sysSettings} 
        setSysSettings={setSysSettings} 
        refreshData={() => fetchAircraftData(session.user.id)}
        fetchGlobalFleetIndex={fetchGlobalFleetIndex}
        onGlobalFleetSelect={handleGlobalFleetSelect}
      />
      <SettingsModal show={showSettingsModal} onClose={() => setShowSettingsModal(false)} session={session} />
      {showAircraftModal && <AircraftModal session={session} existingAircraft={editingAircraftId ? allAircraftList.find(a => a.id === editingAircraftId) || null : null} onClose={() => setShowAircraftModal(false)} onSuccess={(t: string) => { setShowAircraftModal(false); fetchAircraftData(session.user.id); setActiveTail(t); }} />}

      {showLogItModal && (
        <div className="fixed inset-0 bg-black/80 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowLogItModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div role="dialog" aria-label="Install Log It companion app" className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 border-t-8 border-[#3AB0FF] animate-slide-up relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowLogItModal(false)} aria-label="Close" className="absolute top-4 right-4 text-gray-400 hover:text-red-500"><X size={24}/></button>
            <h3 className="font-oswald text-2xl font-bold uppercase tracking-widest text-navy mb-4">Install Log It</h3>
            <p className="text-sm text-gray-600 font-roboto mb-4 leading-relaxed">Log It is a companion app that is designed to make logging times and squawks easy on the go.</p>
            <ol className="text-left text-sm text-gray-600 font-roboto mb-8 space-y-2 max-w-xs mx-auto list-decimal pl-4"><li>Tap below to copy the app link.</li><li>Open your phone&apos;s browser and paste the link.</li><li>Use the Share menu <Share size={14} className="inline text-blue-500 mb-1"/> to Add to Home Screen.</li></ol>
            <button onClick={handleCopyQuickLink} className="w-full bg-[#3AB0FF] text-white font-oswald text-xl font-bold uppercase tracking-widest py-4 rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"><Copy size={20} /> Copy App Link</button>
          </div>
          </div>
        </div>
      )}

      <header role="banner" className="fixed top-0 left-0 right-0 bg-navy text-white shadow-md z-[9999]" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-3xl mx-auto px-4 py-2 flex justify-between items-center w-full min-h-[52px]">
          <div className="flex flex-col">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#F5B05B] mb-[2px]">Active Aircraft</span>
            <div className="flex items-center gap-3">
              <div className={`w-3.5 h-3.5 rounded-full shrink-0 shadow-inner ${aircraftStatus === 'grounded' ? 'bg-red-500' : aircraftStatus === 'issues' ? 'bg-[#F08B46]' : 'bg-success'}`} role="status" aria-label={`Aircraft status: ${aircraftStatus}`} />
              <div className="relative flex items-center">
                <button onClick={() => navigateTab('summary')} aria-label={`View ${activeTail || 'aircraft'} summary`} className="text-xl font-oswald font-bold uppercase tracking-wide text-white hover:text-[#3AB0FF] transition-colors active:scale-95">
                  {activeTail || '—'}
                </button>
                {dropdownOptions.length > 0 && (
                  <button onClick={() => setShowTailDropdown(!showTailDropdown)} aria-label="Switch aircraft" aria-expanded={showTailDropdown} className="text-white/70 hover:text-white transition-colors active:scale-95 ml-1 p-1">
                    <ChevronDown size={16} className={`transition-transform ${showTailDropdown ? 'rotate-180' : ''}`} />
                  </button>
                )}
                {showTailDropdown && (
                  <>
                    <div className="fixed inset-0 z-[9998]" onClick={() => setShowTailDropdown(false)} />
                    <div role="listbox" aria-label="Aircraft selection" className="absolute top-full left-0 mt-2 bg-white rounded-lg shadow-2xl border border-gray-200 min-w-full w-max z-[9999] overflow-hidden animate-slide-up">
                      {dropdownOptions.map(a => (
                        <button key={a.id} role="option" aria-selected={a.tail_number === activeTail} onClick={() => handleTailChange(a.tail_number)} className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-gray-50 active:bg-gray-100 transition-colors ${a.tail_number === activeTail ? 'bg-blue-50' : ''}`}>
                          <div>
                            <span className={`font-oswald font-bold uppercase text-sm ${a.tail_number === activeTail ? 'text-[#3AB0FF]' : 'text-navy'}`}>{a.tail_number}</span>
                            <span className="block text-[10px] text-gray-400 uppercase tracking-widest">{a.aircraft_type}</span>
                          </div>
                          {a.tail_number === activeTail && <div className="w-2 h-2 rounded-full bg-[#3AB0FF] shrink-0" />}
                        </button>
                      ))}
                      <button onClick={() => handleTailChange('__add_new__')} className="w-full text-left px-4 py-3 text-[#3AB0FF] font-oswald font-bold uppercase text-sm hover:bg-blue-50 active:bg-blue-100 transition-colors border-t border-gray-100">+ Add Aircraft</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-4">
            {showFleetButton && <button onClick={() => navigateTab('fleet')} aria-label="Fleet overview" className={`hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0 ${activeTab === 'fleet' ? 'text-[#3AB0FF]' : 'text-gray-300'}`}><LayoutGrid size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Fleet</span></button>}
            <button onClick={() => setShowLogItModal(true)} aria-label="Install Log It companion app" className="text-gray-300 hover:text-[#3AB0FF] transition-colors flex flex-col items-center active:scale-95 shrink-0"><Send size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Log It</span></button>
            {role === 'admin' && <button onClick={() => setShowAdminMenu(true)} aria-label="Admin tools" className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0"><ShieldCheck size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Admin</span></button>}
            <button onClick={() => setShowSettingsModal(true)} aria-label="Settings" className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0"><Settings size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Settings</span></button>
            <button onClick={handleLogout} aria-label="Log out" className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0"><LogOut size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Logout</span></button>
          </div>
        </div>
      </header>

      {aircraftStatus === 'grounded' && (
        <div role="alert" className="bg-[#CE3732] text-white text-center py-2 px-4 shadow-md z-10 flex flex-col justify-center items-center shrink-0 w-full">
          <div className="flex items-center gap-2"><AlertTriangle size={16} /><span className="font-oswald tracking-widest font-bold uppercase text-sm">Not Flight Ready</span><AlertTriangle size={16} /></div>
          {groundedReason && <span className="text-[10px] font-bold uppercase tracking-widest text-white/80 mt-0.5">{groundedReason}</span>}
        </div>
      )}

      <PullIndicator pullProgress={pullProgress} phase={pullPhase} />

      <main
        className="fixed left-0 right-0 overflow-y-auto bg-neutral-100 p-4 flex justify-center w-full"
        style={{
          touchAction: 'manipulation',
          overscrollBehaviorY: 'contain',
          WebkitOverflowScrolling: 'touch',
          top: 'calc(3.5rem + env(safe-area-inset-top, 0px))',
          bottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))',
        }}
        {...pullHandlers}
      >
        <div className="w-full max-w-3xl flex flex-col gap-6">
          {!isDataLoaded ? (
            activeTab === 'fleet' ? <FleetSkeleton /> : <SummarySkeleton />
          ) : aircraftList.length === 0 ? (
            /* ── Empty fleet recovery ───────────────────────────
               The user has completed onboarding but deleted their
               only aircraft (or is a new admin with no personal
               fleet). Show a clear recovery path instead of an
               empty ghost town. */
            <div className="flex flex-col items-center justify-center text-center py-16 px-4">
              <Plane size={48} className="text-gray-300 mb-4" />
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy mb-2">No aircraft in your fleet</h2>
              <p className="font-roboto text-sm text-gray-500 mb-6 max-w-sm">
                Add an aircraft to start tracking flights, maintenance, squawks, and more.
              </p>
              <button
                onClick={() => openAircraftForm(null)}
                className="bg-[#e6651b] text-white font-oswald font-bold uppercase tracking-widest text-sm py-3 px-8 rounded-lg active:scale-95 transition-transform shadow-md"
              >
                <Plus size={16} className="inline mr-2 -mt-0.5" />
                Add Aircraft
              </button>
            </div>
          ) : (<>
            {activeTab === 'fleet' && <FleetSummary
              aircraftList={aircraftList}
              onSelectAircraft={(t: string) => { setActiveTail(t); navigateTab('summary'); }}
              onSelectAircraftDate={(t: string, d: Date, v: 'month' | 'week' | 'day') => {
                setActiveTail(t);
                setCalendarInitialDate(d);
                setCalendarInitialView(v);
                navigateTab('calendar');
              }}
            />}
            {activeTab === 'summary' && <SummaryTab aircraft={selectedAircraftData} setActiveTab={(t: AppTab) => navigateTab(t)} onNavigateToSquawks={() => { setMxSubTab('squawks'); navigateTab('mx'); }} role={role} aircraftRole={currentAircraftRole} onDeleteAircraft={handleDeleteAircraft} sysSettings={sysSettings} onEditAircraft={() => openAircraftForm(selectedAircraftData)} refreshData={() => fetchAircraftData(session.user.id)} session={session} />}
            {activeTab === 'times' && <LogRouter logSubTab={logSubTab} setLogSubTab={setLogSubTab} aircraft={selectedAircraftData} session={session} role={role} userInitials={userInitials} onUpdate={() => fetchAircraftData(session.user.id)} />}
            {activeTab === 'calendar' && <CalendarTab
              aircraft={selectedAircraftData}
              session={session}
              aircraftRole={currentAircraftRole}
              role={role}
              initialDate={calendarInitialDate}
              initialView={calendarInitialView}
              onInitialConsumed={() => { setCalendarInitialDate(null); setCalendarInitialView(null); }}
            />}
            {activeTab === 'mx' && <MaintenanceTab aircraft={selectedAircraftData} role={role} aircraftRole={currentAircraftRole} onGroundedStatusChange={() => checkGroundedStatus(activeTail)} sysSettings={sysSettings} session={session} userInitials={userInitials} initialSubTab={mxSubTab} />}
            {activeTab === 'notes' && <NotesTab aircraft={selectedAircraftData} session={session} role={role} aircraftRole={currentAircraftRole} userInitials={userInitials} onNotesRead={() => setUnreadNotes(0)} />}
            {activeTab === 'howard' && <HowardTab currentAircraft={selectedAircraftData} userFleet={aircraftList} session={session} />}
            {activeTab === 'howard-usage' && <HowardUsageTab />}
            {activeTab === 'documents' && <DocumentsTab aircraft={selectedAircraftData} session={session} role={role} />}
            {activeTab === 'equipment' && <EquipmentTab aircraft={selectedAircraftData} role={role} aircraftRole={currentAircraftRole} />}
            {activeTab === 'ads' && <ADsTab aircraft={selectedAircraftData} role={role} aircraftRole={currentAircraftRole} />}
          </>)}
        </div>
      </main>

      {/* ─── LOG TRAY ─── */}
      <NavTray
        items={logTrayItems as unknown as TrayItem[]}
        visible={expandedNav === 'log'}
        userId={session?.user?.id ?? null}
        storageKey="log"
        selectedKey={activeTab === 'times' ? logSubTab : null}
        onSelect={(key) => {
          if (key === 'flights') setLogSubTab('flights');
          else if (key === 'checks') setLogSubTab('checks');
          navigateTab('times');
          setExpandedNav(null);
        }}
        onClose={() => setExpandedNav(null)}
      />

      {/* ─── MX TRAY ─── */}
      <NavTray
        items={mxTrayItems as unknown as TrayItem[]}
        visible={expandedNav === 'mx'}
        userId={session?.user?.id ?? null}
        storageKey="mx"
        selectedKey={
          activeTab === 'ads' ? 'ads'
          : activeTab === 'mx' && mxSubTab === 'maintenance' ? 'due-items'
          : activeTab === 'mx' && mxSubTab === 'squawks' ? 'squawks'
          : activeTab === 'mx' && mxSubTab === 'service' ? 'service'
          : null
        }
        onSelect={(key) => {
          if (key === 'due-items') { setMxSubTab('maintenance'); navigateTab('mx'); }
          else if (key === 'squawks') { setMxSubTab('squawks'); navigateTab('mx'); }
          else if (key === 'service') { setMxSubTab('service'); navigateTab('mx'); }
          else if (key === 'ads') { navigateTab('ads'); }
          setExpandedNav(null);
        }}
        onClose={() => setExpandedNav(null)}
      />

      {/* ─── MORE TRAY ─── */}
      <NavTray
        items={moreTrayItems as unknown as TrayItem[]}
        visible={expandedNav === 'more'}
        userId={session?.user?.id ?? null}
        storageKey="more"
        unreadBadgeKey="notes"
        unreadCount={unreadNotes}
        selectedKey={
          activeTab === 'notes' ? 'notes'
          : activeTab === 'documents' ? 'documents'
          : activeTab === 'equipment' ? 'equipment'
          : activeTab === 'howard' ? 'howard'
          : null
        }
        onSelect={(key) => {
          if (key === 'notes') navigateTab('notes');
          else if (key === 'howard') navigateTab('howard');
          else if (key === 'howard-usage') navigateTab('howard-usage');
          else if (key === 'documents') navigateTab('documents');
          else if (key === 'equipment') navigateTab('equipment');
          setExpandedNav(null);
        }}
        onClose={() => setExpandedNav(null)}
      />

      {/* ─── HOWARD FLOATING LAUNCHER ─── */}
      {activeTab !== 'howard' && activeTab !== 'howard-usage' && (
        <HowardLauncher currentAircraft={selectedAircraftData} userFleet={aircraftList} session={session} />
      )}

      {/* ─── POST-ONBOARDING SPOTLIGHT TOUR ─── */}
      {needsTour && (
        <HowardTour
          onComplete={() => {
            // Optimistically flip the client flag so the tour stops
            // rendering immediately; the server write already fired
            // from inside HowardTour.onComplete → /api/user/tour-complete.
            setTourCompleted(true);
          }}
          onOpenFeaturesGuide={() => setShowFeaturesGuide(true)}
        />
      )}

      {/* ─── FEATURES GUIDE (on-demand reference) ─── */}
      <FeaturesOverviewModal
        show={showFeaturesGuide}
        onClose={() => setShowFeaturesGuide(false)}
      />

      <nav role="navigation" aria-label="Main navigation" className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-200 z-[9999] pt-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <div className="flex justify-around items-center h-12 max-w-3xl mx-auto">
          {[
            {
              id: 'summary',
              icon: activeTab === 'fleet' ? LayoutGrid : Home,
              label: activeTab === 'fleet' ? 'Fleet' : 'Home',
              badge: 0,
            },
            { id: 'log', icon: PenLine, label: 'Log', badge: 0 },
            { id: 'calendar', icon: Calendar, label: 'Calendar', badge: 0 },
            { id: 'mx', icon: Wrench, label: 'MX', badge: 0 },
            { id: 'more', icon: MoreHorizontal, label: 'More', badge: unreadNotes }
          ].map(tab => {
            const isActive = tab.id === 'summary'
              ? (activeTab === 'summary' || activeTab === 'fleet')
              : tab.id === 'log' ? activeTab === 'times'
              : tab.id === 'mx' ? (activeTab === 'mx' || activeTab === 'ads')
              : tab.id === 'more' ? (activeTab === 'notes' || activeTab === 'howard' || activeTab === 'howard-usage' || activeTab === 'documents' || activeTab === 'equipment')
              : activeTab === tab.id;
            return (
            <button key={tab.id} onClick={() => {
              if (tab.id === 'log') {
                setExpandedNav(prev => prev === 'log' ? null : 'log');
              } else if (tab.id === 'mx') {
                setExpandedNav(prev => prev === 'mx' ? null : 'mx');
              } else if (tab.id === 'more') {
                setExpandedNav(prev => prev === 'more' ? null : 'more');
              } else if (tab.id === 'summary') {
                setExpandedNav(null);
                // Three-state toggle for multi-aircraft users:
                //   On Summary → Fleet (overview of every tail)
                //   On Fleet   → Summary (last-active tail)
                //   Anywhere   → Summary (ordinary home behavior)
                // Single-aircraft users never see Fleet, so the button
                // just goes home.
                if (activeTab === 'summary' && showFleetButton) {
                  navigateTab('fleet');
                } else if (activeTab === 'fleet') {
                  navigateTab('summary');
                } else {
                  navigateTab('summary');
                }
              } else {
                setExpandedNav(null);
                navigateTab(tab.id as AppTab);
              }
            }} aria-label={tab.label} aria-current={isActive ? 'page' : undefined}
              data-tour={
                tab.id === 'summary' ? 'summary'
                : tab.id === 'log' ? 'log'
                : tab.id === 'calendar' ? 'calendar'
                : tab.id === 'mx' ? 'maintenance'
                : tab.id === 'more' ? 'more'
                : undefined
              }
              className={`flex-1 pb-1 flex flex-col items-center justify-center transition-all relative active:scale-95 ${isActive || (tab.id === 'log' && expandedNav === 'log') || (tab.id === 'mx' && expandedNav === 'mx') || (tab.id === 'more' && expandedNav === 'more') ? (tab.id === 'summary' ? 'text-navy' : getTabColor(tab.id)) : 'text-gray-400 hover:bg-gray-50'}`}>
              <div className="relative mb-1"><tab.icon size={20} />{tab.badge > 0 && <span className="absolute -top-1 -right-2 flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#CE3732] opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-[#CE3732] text-[8px] text-white font-bold items-center justify-center border border-white"></span></span>}</div>
              <span className="text-[10px] font-bold uppercase tracking-widest">{tab.label}</span>
              {isActive && <div className={`absolute bottom-0 w-12 h-1 rounded-t-full ${getIndicatorColor(tab.id)}`}></div>}
            </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

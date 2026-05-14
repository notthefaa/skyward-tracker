"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, abortInFlightSupabaseReads } from "@/lib/supabase";
import { authFetch, onAuthFetchUnauthorized, abortAllInFlightAuthFetches } from "@/lib/authFetch";
import { recoveryReload } from "@/lib/iosRecovery";
import { useFleetData, useRealtimeSync, useGroundedStatus, useAircraftRole, usePullToRefresh, useResumeFromBackground } from "@/hooks";
import { useDocStatusWatcher } from "@/hooks/useDocStatusWatcher";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { NETWORK_TIMEOUT_MS } from "@/lib/constants";
import { swrKeys, matchesAircraft, allForAircraft } from "@/lib/swrKeys";
import { clearPersistedSwrCache } from "@/lib/swrCache";
import useSWR, { useSWRConfig } from "swr";
import { HOWARD_STALE_MS } from "@/lib/howard/quickPrompts";
import { useToast } from "@/components/ToastProvider";
import dynamic from "next/dynamic";
import type { AircraftWithMetrics, AppTab, LogSubTab, MxSubTab } from "@/lib/types";
import {
  Wrench, AlertTriangle, FileText, LogOut,
  ChevronDown, Home, LayoutGrid, Warehouse, Send, ShieldCheck, X, Share, Copy, WifiOff, Loader2, Calendar, Settings,
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

  // Direct cache handle — `globalMutate(matcher, undefined, ...)` only
  // sets data to undefined on the in-memory map; the entry's State
  // object lingers and the localStorage persistence layer keeps shipping
  // it forward across reloads. For a hard reset on tail switch we need
  // `cache.delete(key)` so the next subscriber starts truly cold.
  const { cache: swrCache } = useSWRConfig();

  // ─── Per-aircraft SWR revalidation ───
  // Two SWR-internal traps to navigate when invalidating one aircraft:
  //
  //   (a) The filter form `globalMutate(matcher, ...)` runs the matcher
  //       against `cache.get(key)._k`, which is undefined for entries
  //       hydrated from localStorage but not yet resubscribed in this
  //       session. Hydrated entries get skipped → tabs the user hasn't
  //       visited yet on the destination aircraft keep their stale `[]`.
  //
  //   (b) SWR keeps an internal `FETCH[key]` map of in-flight requests.
  //       When iOS suspends a fetch mid-flight (PWA backgrounded) the
  //       promise hangs forever and `FETCH[key]` stays set. On resume
  //       any `softRevalidate(WITH_DEDUPE)` sees the entry, decides a
  //       request is "already in flight," and waits on the dead
  //       promise instead of starting a fresh one. Pilots described
  //       this exactly: data disappears, refresh hangs, switching
  //       aircraft fixes it (because the new keys have no FETCH entry).
  //       `cache.delete(key)` does NOT clear FETCH[key] — only mutate
  //       does, and only on its non-filter path.
  //
  // Walk `cache.keys()` directly (bypasses (a)) and call single-arg
  // `globalMutate(key)` per matched key (bypasses (b) — that path
  // explicitly does `delete FETCH[key]; delete PRELOAD[key]` before
  // triggering the revalidator). Default mode does NOT pass `undefined`
  // as the data arg, so existing visible data stays put while the
  // refetch is in flight — a flaky refetch on a half-warm iOS socket
  // won't strand the user on a blank screen. Used by pull-refresh and
  // resume-from-background.
  //
  // `blankFirst: true` mode forces the visible data to undefined on
  // list-type keys before triggering revalidation. The tail-switch
  // path uses this so a localStorage-persisted entry from a prior
  // session can't render under the freshly-selected tail's header.
  // (Pilots reported: "I switched aircraft, the flight-log table
  // showed entries that didn't match the current tail or weren't the
  // latest" — that was week-old persisted data from an earlier visit
  // to the same tail. Blanking ensures a skeleton/empty render while
  // the fresh fetch lands instead of a stale list the pilot can't
  // distinguish from current data.)
  // Single-row summary keys keep last-good even in blank-first mode —
  // they refresh quickly and the small data is self-evidently "an
  // older snapshot of the right thing" if briefly stale.
  const LIST_KEY_PREFIXES = [
    'times-', 'vor-', 'vor-latest-', 'tire-', 'oil-', 'oil-chart-',
    'oil-last-added-', 'mx-', 'mx-events-', 'squawks-', 'ads-',
    'notes-', 'docs-', 'crew-', 'equipment-', 'calendar-',
  ];
  const isListKey = (k: string): boolean => {
    // summary-* keys can collide with the broad `mx-` prefix
    // ("summary-mx-..." starts with "summary-", so we're safe — but
    // be explicit for future maintainers).
    if (k.startsWith('summary-')) return false;
    return LIST_KEY_PREFIXES.some(p => k.startsWith(p));
  };
  const revalidateAircraftCache = useCallback((aircraftId: string, opts?: { blankFirst?: boolean }) => {
    const matcher = matchesAircraft(aircraftId);
    // Two-pass clear:
    //   Pass A — walk every key currently in the cache provider that
    //     matches the aircraft (catches paginated variants, calendar
    //     months opened earlier in the session, etc.).
    //   Pass B — walk the canonical list of aircraft-scoped keys with
    //     default args (catches keys whose hook mounted but whose
    //     first fetch suspended on iOS *before* SWR's cache.set
    //     landed — those wouldn't show up in cache.keys() yet, but
    //     their FETCH[key] zombie still pins future dedupe checks).
    // Both passes route through `globalMutate(key)`, which clears
    // FETCH[key] / PRELOAD[key] internally and triggers the
    // revalidator if a hook is currently subscribed. Set-based dedupe
    // so duplicate keys don't double-fire mutate.
    const keys = new Set<string>();
    for (const k of Array.from(swrCache.keys())) {
      if (typeof k === 'string' && matcher(k)) keys.add(k);
    }
    for (const k of allForAircraft(aircraftId)) keys.add(k);
    // tsconfig targets es5 without downlevelIteration — same Array.from
    // wrap the cache.keys() walk above uses.
    for (const k of Array.from(keys)) {
      if (opts?.blankFirst && isListKey(k)) {
        globalMutate(k, undefined, { revalidate: true });
      } else {
        globalMutate(k);
      }
    }
  }, [globalMutate, swrCache]);

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
    // Howard drives the active-aircraft dropdown via this event. Tail
    // resolution + access check happen server-side in the
    // `switch_active_aircraft` tool, so by the time we see this event
    // it's already authorized. We trust `tail` directly.
    const handleHowardSwitch = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tail?: string } | undefined;
      const tail = detail?.tail;
      if (typeof tail !== 'string' || !tail) return;
      setActiveTail(tail);
    };
    // Handoff pattern: Howard recognizes an intent the chat can't
    // fulfill (file upload, photo attach) and asks AppShell to open
    // the right form pre-filled. We persist the pre-fill on
    // sessionStorage so the destination tab consumes it on mount —
    // matches the existing aft_howard_prefill convention used by
    // HowardWelcome / AircraftModal.
    const handleHowardOpenInApp = (e: Event) => {
      const detail = (e as CustomEvent).detail as { kind?: string; [k: string]: any } | undefined;
      if (!detail?.kind) return;
      try {
        if (detail.kind === 'documents_upload') {
          sessionStorage.setItem(
            'aft_open_documents_upload',
            JSON.stringify({ docType: detail.docType || 'POH' }),
          );
          navigateTab('documents');
        } else if (detail.kind === 'squawk_new') {
          sessionStorage.setItem(
            'aft_open_squawk_new',
            JSON.stringify({
              description: detail.description || '',
              location: detail.location || '',
              affectsAirworthiness: !!detail.affectsAirworthiness,
            }),
          );
          setMxSubTab('squawks');
          navigateTab('mx');
        } else if (detail.kind === 'logbook_scan_new_item') {
          // Flag-only payload — MaintenanceTab opens the Track New Item
          // modal so the pilot can tap "Scan from logbook". Auto-
          // clicking the camera input from JS isn't reliable on iOS
          // (the picker often needs a direct user gesture), so we
          // stage the modal and let the pilot trigger the camera.
          sessionStorage.setItem('aft_open_logbook_scan', JSON.stringify({}));
          setMxSubTab('maintenance');
          navigateTab('mx');
        }
      } catch {
        // sessionStorage write failures (private mode, quota) shouldn't
        // block navigation — destination tab will just render with no
        // pre-fill, the pilot can type manually.
      }
    };
    window.addEventListener('aft:navigate-howard', handleNavigateHoward);
    window.addEventListener('aft:navigate-howard-usage', handleNavigateHowardUsage);
    window.addEventListener('aft:mx-ads-nav', handleMxAdsNav);
    window.addEventListener('aft:more-nav', handleMoreNav);
    window.addEventListener('aft:open-features-guide', handleOpenFeaturesGuide);
    window.addEventListener('howard:switch-aircraft', handleHowardSwitch);
    window.addEventListener('howard:open-in-app', handleHowardOpenInApp);
    return () => {
      window.removeEventListener('aft:navigate-howard', handleNavigateHoward);
      window.removeEventListener('aft:navigate-howard-usage', handleNavigateHowardUsage);
      window.removeEventListener('aft:mx-ads-nav', handleMxAdsNav);
      window.removeEventListener('aft:more-nav', handleMoreNav);
      window.removeEventListener('aft:open-features-guide', handleOpenFeaturesGuide);
      window.removeEventListener('howard:switch-aircraft', handleHowardSwitch);
      window.removeEventListener('howard:open-in-app', handleHowardOpenInApp);
    };
  }, [navigateTab]);

  // ─── Derived State (extracted hooks) ───
  const { aircraftStatus, groundedReason, checkGroundedStatus } = useGroundedStatus(allAircraftList, activeTail);
  const currentAircraftRole = useAircraftRole(activeTail, allAircraftList, allAccessRecords, session);

  // Watch the active aircraft's docs for status='processing' → 'ready'
  // transitions and surface a toast. Mounted here in AppShell so the
  // notification fires even when the user has navigated away from the
  // documents tab (which is the whole point of the fire-and-forget
  // upload shape).
  //
  // CRITICAL: this hook MUST run on every render, including the
  // onboarding-path early returns below. Previously it was placed
  // AFTER the `if (needsOnboarding) return <HowardWelcome />` branch,
  // which meant new users (the only group with `completedOnboarding=
  // false`) hit "Rendered fewer hooks than expected" — render N had
  // the hook (initial loading state, fall-through), render N+1 had
  // the early return and skipped it. React fatally bailed and
  // production surfaced it as the minified `#300` error boundary.
  // Existing users never tripped this because their
  // `completedOnboarding=true` made the early return unreachable.
  useDocStatusWatcher(allAircraftList.find(a => a.tail_number === activeTail)?.id || null);

  // Grounded-banner refresh — ProposedActionCard fires aft:refresh-grounded
  // after any confirmed write that may affect airworthiness. The grounded
  // status comes from direct Supabase queries (not SWR), so the per-
  // aircraft SWR invalidation doesn't trigger it.
  // The event carries { detail: aircraftId } so a write on Aircraft A
  // only re-runs Aircraft A's check — otherwise a pilot who switched
  // tails between the write firing and the event landing would re-
  // check the wrong plane.
  useEffect(() => {
    const handle = (e: Event) => {
      const ce = e as CustomEvent<string | undefined>;
      const targetAircraftId = ce.detail;
      // If the event carries an aircraftId, match it against the
      // current aircraft before refreshing. Missing detail falls back
      // to the old broadcast behavior for older call sites.
      if (targetAircraftId) {
        const currentAircraftId = allAircraftList?.find((a: any) => a.tail_number === activeTail)?.id;
        if (currentAircraftId !== targetAircraftId) return;
      }
      if (activeTail) checkGroundedStatus(activeTail);
    };
    window.addEventListener('aft:refresh-grounded', handle);
    return () => window.removeEventListener('aft:refresh-grounded', handle);
  }, [activeTail, checkGroundedStatus, allAircraftList]);

  // ─── Realtime (extracted hook) ───
  const boundRefresh = useCallback(
    (aircraftId: string) => {
      if (session?.user?.id) refreshForAircraft(aircraftId, session.user.id);
    },
    [session, refreshForAircraft]
  );
  const { cancelPendingTimers: cancelRealtimeTimers } = useRealtimeSync(session, boundRefresh);

  // ─── Slow-network watchdog ───
  // Providers fires `aft:slow-network` when SWR's loadingTimeout
  // crosses, capped at one event per cooldown window. We surface a
  // single info toast so a stuck spinner doesn't look like a hang.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => showInfo("Network's slow — give it a moment.");
    window.addEventListener('aft:slow-network', handler);
    return () => window.removeEventListener('aft:slow-network', handler);
  }, [showInfo]);

  // ─── Centralized 401 handler ───
  // authFetch dispatches `authfetch:unauthorized` after a refresh-and-
  // retry still returns 401. That means the session is genuinely dead;
  // sign out locally so the user lands on the auth screen instead of
  // staring at a tab whose mutations all silently fail.
  useEffect(() => {
    return onAuthFetchUnauthorized(() => {
      showError('Your session expired. Sign back in to continue.');
      supabase.auth.signOut({ scope: 'local' });
    });
  }, [showError]);

  // ─── Howard resets on fresh sign-in ───
  // A FRESH sign-in (different user than before, or no prior session)
  // clears the user's Howard thread so the new pilot starts with a
  // blank conversation. Critically, this MUST ignore session-refresh
  // SIGNED_IN events for the already-signed-in user: @supabase/ssr
  // fires a spurious SIGNED_IN on token refresh after iOS Safari
  // backgrounding (even a few seconds), and without the same-user
  // guard we'd nuke the chat every time the user flipped to another
  // app tab — the original "Howard resets when I leave the app"
  // field report.
  //
  // The userId-tracking ref distinguishes:
  //   prev === null + SIGNED_IN  → fresh sign-in or initial mount → wipe
  //   prev !== null + SIGNED_IN same user → session refresh → SKIP
  //   prev !== null + SIGNED_IN different user → user-switch on shared
  //                              device → wipe (SIGNED_OUT also fired
  //                              just before, so this is belt+suspenders)
  const lastSignedInUserIdRef = useRef<string | null>(null);
  // Seed the ref from the current session BEFORE the auth listener
  // mounts. If we don't, the first SIGNED_IN (which can be a spurious
  // post-resume token refresh, NOT a fresh login) sees prev=null and
  // mistakes itself for a new login → nukes the thread. Page-reload
  // sessions arrive via INITIAL_SESSION, which we also seed below.
  useEffect(() => {
    if (session?.user?.id && lastSignedInUserIdRef.current === null) {
      lastSignedInUserIdRef.current = session.user.id;
    }
  }, [session?.user?.id]);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, sess) => {
      if (event === 'SIGNED_OUT') {
        // Wipe every cached query so the next user on a shared device
        // doesn't hydrate the previous user's notes / squawks / aircraft
        // from localStorage. globalMutate(() => true, ..., false) clears
        // the in-memory SWR map; clearPersistedSwrCache() drops the
        // localStorage blob so the next page load starts cold.
        lastSignedInUserIdRef.current = null;
        globalMutate(() => true, undefined, { revalidate: false });
        clearPersistedSwrCache();
        return;
      }
      // INITIAL_SESSION fires on app boot with an existing token.
      // Use it to seed the ref so the next SIGNED_IN (which iOS may
      // fire on token-refresh-after-resume) compares against a real
      // user id, not null.
      if (event === 'INITIAL_SESSION') {
        if (sess?.user?.id) lastSignedInUserIdRef.current = sess.user.id;
        return;
      }
      if (event !== 'SIGNED_IN' || !sess?.user?.id) return;
      const newUserId = sess.user.id;
      const prevUserId = lastSignedInUserIdRef.current;
      // Spurious SIGNED_IN for the user who's already in the session.
      // iOS Safari fires this on token-refresh-after-resume, even when
      // the user has been signed in continuously. Treat as no-op.
      if (prevUserId === newUserId) return;
      lastSignedInUserIdRef.current = newUserId;
      try {
        await authFetch('/api/howard', { method: 'DELETE' });
      } catch {
        // Non-blocking — the client-side cache flush below still happens.
      }
      globalMutate(swrKeys.howardUser(newUserId), { thread: null, messages: [] }, { revalidate: true });
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
      // /api/howard returns 200 + { thread: null, messages: [] } for users
      // who have never chatted with Howard — so a !res.ok here is a real
      // failure, not "no history yet." Throw so SWR retries instead of
      // pinning an empty thread in cache.
      if (!res.ok) throw new Error("Couldn't load Howard");
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
  // The supabase JS client doesn't honor a global request timeout, so a
  // dropped socket / hung pool / stuck JWT-refresh leaves these awaits
  // pending forever. Without the race below, `phase` in usePullToRefresh
  // stays at 'refreshing' until the user kills the app — the original
  // bug report. The watchdog in the hook is still in place as a
  // defense-in-depth, but this is the primary guard: fail fast, tell the
  // pilot the refresh didn't complete, and let them try again.
  //
  // Footprint is intentionally narrow: only fleet metadata + the
  // ACTIVE aircraft's keys are revalidated. The previous
  // `globalMutate(() => true, undefined, { revalidate: true })` path
  // re-fetched every cached aircraft and made the 10s refresh window
  // a near-certain timeout on iOS (each cached aircraft = ~6 reads;
  // a fleet of 3-4 cached aircraft = 20+ parallel fetches over a
  // shallow socket pool, with the user staring at a spinner that
  // resolves to a recoveryReload on miss).
  const handlePullRefresh = useCallback(async () => {
    if (!session?.user?.id) return;
    const PULL_REFRESH_TIMEOUT_MS = 10_000;
    abortInFlightSupabaseReads();
    abortAllInFlightAuthFetches();
    const work = (async () => {
      await fetchAircraftData(session.user.id);
      if (activeTail) {
        const ac = allAircraftList.find(a => a.tail_number === activeTail);
        if (ac) {
          revalidateAircraftCache(ac.id);
          await enrichSingleAircraft(ac.id);
        }
        checkGroundedStatus(activeTail);
        fetchUnreadNotes(activeTail, session.user.id);
      }
    })();
    const REFRESH_TIMEOUT_SENTINEL = '__pull_refresh_timeout__';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((_, reject) => {
      timer = setTimeout(() => reject(new Error(REFRESH_TIMEOUT_SENTINEL)), PULL_REFRESH_TIMEOUT_MS);
    });
    try {
      await Promise.race([work, timeout]);
    } catch (err: any) {
      if (err?.message === REFRESH_TIMEOUT_SENTINEL) {
        // Pull-to-refresh hanging is the canonical signal that the
        // iOS WKWebView's network stack has wedged after a long
        // background. The user's manual workaround is to close +
        // reopen the app — `recoveryReload` does the JS-process
        // equivalent automatically (rate-limited so a genuinely
        // offline user doesn't bounce in a reload loop).
        showError("Refresh timed out — reloading…");
        setTimeout(() => { recoveryReload('pull-refresh-timeout'); }, 600);
      } else {
        showError("Refresh failed — try again.");
        console.error('[handlePullRefresh]', err);
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, [session, fetchAircraftData, activeTail, allAircraftList, enrichSingleAircraft, checkGroundedStatus, revalidateAircraftCache, showError]);

  const { pullHandlers, pullProgress, phase: pullPhase, setEnabled: setPullEnabled } = usePullToRefresh({
    onRefresh: handlePullRefresh,
  });

  // ─── Disable pull-to-refresh when any modal is open ───
  // The observer fires on every DOM mutation in the document (Howard
  // streaming tokens, scroll-driven list renders, etc.), so the
  // `querySelectorAll` + setState is coalesced into one rAF tick.
  // Without the coalesce this runs hundreds of times per second on a
  // busy page and freezes the main thread on slower devices.
  useEffect(() => {
    const anyPageModalOpen = showAdminMenu || showLogItModal || showSettingsModal || expandedNav !== null || showAircraftModal || showTailDropdown;
    if (anyPageModalOpen) {
      setPullEnabled(false);
      return;
    }

    let lastEnabled: boolean | null = null;
    const checkForChildModals = () => {
      const hasChildModal = document.querySelector('[class*="fixed"][class*="inset-0"]') !== null;
      const enabled = !hasChildModal;
      if (enabled !== lastEnabled) {
        lastEnabled = enabled;
        setPullEnabled(enabled);
      }
    };

    checkForChildModals();

    let rafId: number | null = null;
    const observer = new MutationObserver(() => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        checkForChildModals();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
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

  // ─── On tail switch, free outgoing connections + revalidate destination ───
  // Two failure modes we're guarding against:
  //   (1) Connection-pool starvation. iOS WKWebView's HTTP/1.1 pool is
  //       shallow; if A's tab fetchers are still in flight (or wedged
  //       on a half-warm socket) when the user switches to B, B's
  //       first fetches queue behind them and appear to hang. Aborting
  //       reads frees those sockets immediately. Mutations are never
  //       aborted from outside (see lib/supabase.ts) — only GET/HEAD.
  //   (2) "Empty B with stale A color" flash. The previous wipe path
  //       set every B-key's data to undefined and triggered revalidation,
  //       which made any cached B data (e.g., from a prior visit in
  //       this session) momentarily disappear. The current path uses
  //       `blankFirst: true` so list-type keys (flight logs, MX items,
  //       squawks, etc.) are blanked — without that, persisted-cache
  //       entries from a prior session render under the new tail's
  //       header until a fresh fetch lands, and pilots see "wrong-
  //       looking" rows they can't distinguish from current data.
  //       Single-row summary keys keep last-good — they refresh fast
  //       and the briefly-stale display is self-evidently "the same
  //       thing, slightly older."
  const lastRevalidatedTailRef = useRef<string>("");
  useEffect(() => {
    if (!activeTail || activeTail === lastRevalidatedTailRef.current) return;
    const ac = allAircraftList.find(a => a.tail_number === activeTail);
    if (!ac) return;
    lastRevalidatedTailRef.current = activeTail;
    abortInFlightSupabaseReads();
    abortAllInFlightAuthFetches();
    cancelRealtimeTimers();
    // Defer one microtask so the just-aborted fetches can reject and
    // SWR's per-key `globalMutate` (which clears FETCH[key]) sees a
    // clean slate. Without the defer, the revalidate races the abort
    // propagation: SWR might still see the dead fetcher's promise in
    // FETCH[key] and re-attach the new mount to it, leaving the new
    // tail's data subscribers waiting on a corpse. Cheap (one tick)
    // and pairs with the SWR `onErrorRetry` bail that prevents the
    // aborted fetcher from queueing a retry storm.
    queueMicrotask(() => revalidateAircraftCache(ac.id, { blankFirst: true }));
  }, [activeTail, allAircraftList, revalidateAircraftCache, cancelRealtimeTimers]);

  useResumeFromBackground({
    activeTail,
    allAircraftList,
    revalidateAircraftCache,
    checkGroundedStatus,
  });

  // ─── Persist active tab ───
  useEffect(() => {
    sessionStorage.setItem('aft_active_tab', activeTab);
  }, [activeTab]);

  // ─── Enrich active aircraft metrics + refresh status when tail changes ───
  // activeTab is in the dep list so in-app navigation re-runs
  // checkGroundedStatus — otherwise the header status dot goes stale
  // whenever MX/squawk mutations happen in another browser tab (realtime
  // skips events from the same user_id, so a write from a duplicate tab
  // wouldn't otherwise propagate). Throttled per-tail so a flurry of tab
  // switches in quick succession doesn't fire 6 queries (4 airworthiness +
  // 2 unread-notes) every single time. 30 s feels fresh enough for
  // cross-tab cases without making in-app navigation feel chunky.
  const lastStatusCheckRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!activeTail || allAircraftList.length === 0 || !session) return;
    const ac = allAircraftList.find(a => a.tail_number === activeTail);
    if (ac && ac.burnRate === 0 && ac.confidenceScore === 0) {
      enrichSingleAircraft(ac.id);
    }
    const last = lastStatusCheckRef.current[activeTail] || 0;
    if (Date.now() - last > 30_000) {
      lastStatusCheckRef.current[activeTail] = Date.now();
      checkGroundedStatus(activeTail);
      fetchUnreadNotes(activeTail, session.user.id);
    }
  }, [activeTail, allAircraftList.length, session, activeTab]);

  // Reset unreadNotes immediately on tail change so the More-tab
  // badge can't display the PREVIOUS tail's count under the NEW
  // tail's selection. The throttled effect above re-fetches the
  // accurate count when it fires (or on the next 30s expiry); if
  // throttled, '0' stays — a safer default than carrying a wrong
  // number. Same pattern that fixed the status-dot bleed (see
  // `useGroundedStatus`'s tail-keyed maps). Only depends on
  // activeTail so in-tab navigation doesn't clobber the badge.
  useEffect(() => {
    setUnreadNotes(0);
  }, [activeTail]);

  // ─── Helpers ───
  const handleInitialFetch = async (userId: string) => {
    try {
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
    } catch (err) {
      // fetchAircraftData now throws on supabase errors so a transient
      // failure can't render an empty-fleet "no aircraft" recovery
      // screen to a pilot who actually has aircraft. Reset the trigger
      // ref so a remount or pull-to-refresh retries, leave isDataLoaded
      // false so the skeleton + network-timeout UI takes over, and let
      // the user know.
      console.error('[AppShell] initial fleet fetch failed', err);
      dataFetchTriggeredRef.current = false;
      showError("Couldn't load your hangar — check your connection and pull to refresh.");
    }
  };

  const fetchUnreadNotes = async (tail: string, _userId: string) => {
    const ac = allAircraftList.find(a => a.tail_number === tail);
    if (!ac) return;
    try {
      const res = await authFetch(`/api/aircraft/${ac.id}/notes/unread-count`);
      if (!res.ok) return; // leave the badge at its previous value
      const body = await res.json() as { unread: number };
      setUnreadNotes(body.unread ?? 0);
    } catch {
      // network blip — keep prior count, badge will refresh on next tail switch
    }
  };

  const handleDeleteAircraft = async (id: string) => {
    try {
      const res = await authFetch('/api/aircraft/delete', {
        method: 'DELETE',
        body: JSON.stringify({ aircraftId: id })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Couldn't delete the aircraft");
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
        .catch(() => showInfo("Couldn't copy automatically — copy this link: " + companionUrl));
    } else {
      showInfo("Couldn't copy automatically — copy this link: " + companionUrl);
    }
  };

  const handleLogout = async () => {
    dataFetchTriggeredRef.current = false;
    setActiveTab('fleet');
    try {
      // Clear cross-user keys before signOut so the next account on this
      // device doesn't inherit the previous user's active aircraft or
      // welcome-modal selection.
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('aft_active_tail');
          window.localStorage.removeItem('aft_onboarding_path');
        }
      } catch { /* private mode / quota — ignore */ }
      // scope: 'local' clears the local session synchronously without
      // waiting on a server round-trip. The default 'global' scope
      // revokes every session server-side, which can hang on flaky
      // mobile data and leaves the user staring at a dead button.
      // The SWR cache wipe below prevents stale aircraft/squawk data
      // from bleeding into the next login on the same device.
      await supabase.auth.signOut({ scope: 'local' });
      globalMutate(() => true, undefined, { revalidate: false });
    } catch (err: any) {
      console.error('Logout failed:', err);
      showError("Couldn't log out cleanly — reload the page to finish signing out.");
    }
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
    const m: Record<string, string> = { summary: 'text-navy', log: 'text-info', times: 'text-info', calendar: 'text-[#56B94A]', mx: 'text-mxOrange', notes: 'text-[#525659]', more: 'text-[#525659]' };
    return m[id] || 'text-brandOrange';
  };

  const getIndicatorColor = (id: string) => {
    const m: Record<string, string> = { summary: 'bg-navy', log: 'bg-info', times: 'bg-info', calendar: 'bg-[#56B94A]', mx: 'bg-mxOrange', notes: 'bg-[#525659]', more: 'bg-[#525659]' };
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
  // Migration 024 backfilled existing global admins to TRUE, so the
  // gate is the flag itself — a freshly-invited admin without a
  // pre-assigned aircraft (aircraftIds empty in /api/invite) lands
  // here and can pick guided chat or form to set up their first
  // aircraft. While flags are still loading (null), render nothing
  // to avoid a welcome flash.
  const needsOnboarding = completedOnboarding === false;
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
            // Await the fleet refetch BEFORE flipping local onboarding
            // state, so the welcome → form → "no aircraft in your
            // fleet" empty-state flicker doesn't happen mid-render. If
            // the fetch fails, still flip onboarding so the user lands
            // on the main shell instead of being stuck on the form.
            try {
              await handleInitialFetch(session.user.id);
            } catch {
              // handleInitialFetch already shows its own toast.
            }
            setOnboardingPath(null);
            setCompletedOnboarding(true);
            showSuccess('Aircraft added to your hangar.');
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
      {showAircraftModal && <AircraftModal session={session} existingAircraft={editingAircraftId ? allAircraftList.find(a => a.id === editingAircraftId) || null : null} onClose={() => setShowAircraftModal(false)} onSuccess={async (t: string) => {
        // Close the modal first so the user gets immediate feedback
        // that the form went through, then await the fleet refetch
        // before flipping activeTail. Without the await, setActiveTail
        // resolves to a tail that isn't in allAircraftList yet —
        // selectedAircraftData briefly becomes null, the summary tab
        // renders blank, and the user assumes nothing happened. The
        // toast confirms success in case fleetRefetch is slow.
        const wasEditing = !!editingAircraftId;
        setShowAircraftModal(false);
        try {
          await fetchAircraftData(session.user.id);
        } catch {
          // fetchAircraftData already surfaces its own errors via the
          // initial-fetch path. Swallow here so we still flip activeTail
          // to the new aircraft — the user can pull-to-refresh later.
        }
        setActiveTail(t);
        showSuccess(wasEditing ? `${t} updated.` : `${t} added to your hangar.`);
      }} />}

      {showLogItModal && (
        <div className="fixed inset-0 bg-black/80 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowLogItModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div role="dialog" aria-label="Install Log It companion app" className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 border-t-8 border-info animate-slide-up relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowLogItModal(false)} aria-label="Close" className="absolute top-4 right-4 text-gray-400 hover:text-danger"><X size={24}/></button>
            <h3 className="font-oswald text-2xl font-bold uppercase tracking-widest text-navy mb-4">Install Log It</h3>
            <p className="text-sm text-gray-600 font-roboto mb-4 leading-relaxed">Companion app for logging from the ramp — flights, VOR, oil, tire, squawks. Works without signal and flushes when you&apos;re back in range.</p>
            <ol className="text-left text-sm text-gray-600 font-roboto mb-8 space-y-2 max-w-xs mx-auto list-decimal pl-4"><li>Tap below to copy the link.</li><li>Open it in your phone&apos;s browser.</li><li>Use the Share menu <Share size={14} className="inline text-blue-500 mb-1"/> to add it to your home screen.</li></ol>
            <button onClick={handleCopyQuickLink} className="w-full bg-info text-white font-oswald text-xl font-bold uppercase tracking-widest py-4 rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"><Copy size={20} /> Copy App Link</button>
          </div>
          </div>
        </div>
      )}

      <header role="banner" className="fixed top-0 left-0 right-0 bg-navy text-white shadow-md z-[9999]" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-3xl mx-auto px-4 py-2 flex justify-between items-center w-full min-h-[52px]">
          <div className="flex flex-col">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#F5B05B] mb-[2px]">Active Aircraft</span>
            <div className="flex items-center gap-3">
              <div className={`w-3.5 h-3.5 rounded-full shrink-0 shadow-inner ${aircraftStatus === 'grounded' ? 'bg-red-500' : aircraftStatus === 'issues' ? 'bg-mxOrange' : aircraftStatus === 'airworthy' ? 'bg-success' : 'bg-gray-400'}`} role="status" aria-label={`Aircraft status: ${aircraftStatus}`} />
              <div className="relative flex items-center">
                <button onClick={() => navigateTab('summary')} aria-label={`View ${activeTail || 'aircraft'} summary`} className="text-xl font-oswald font-bold uppercase tracking-wide text-white hover:text-info transition-colors active:scale-95">
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
                            <span className={`font-oswald font-bold uppercase text-sm ${a.tail_number === activeTail ? 'text-info' : 'text-navy'}`}>{a.tail_number}</span>
                            <span className="block text-[10px] text-gray-400 uppercase tracking-widest">{a.aircraft_type}</span>
                          </div>
                          {a.tail_number === activeTail && <div className="w-2 h-2 rounded-full bg-info shrink-0" />}
                        </button>
                      ))}
                      <button onClick={() => handleTailChange('__add_new__')} className="w-full text-left px-4 py-3 text-info font-oswald font-bold uppercase text-sm hover:bg-blue-50 active:bg-blue-100 transition-colors border-t border-gray-100">+ Add Aircraft</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-4">
            {showFleetButton && <button onClick={() => navigateTab('fleet')} aria-label="Hangar overview" className={`hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0 ${activeTab === 'fleet' ? 'text-info' : 'text-gray-300'}`}><Warehouse size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Hangar</span></button>}
            <button onClick={() => setShowLogItModal(true)} aria-label="Install Log It companion app" className="text-[#F5B05B] hover:text-[#F5B05B]/80 transition-colors flex flex-col items-center active:scale-95 shrink-0"><Send size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Log It</span></button>
            {role === 'admin' && <button onClick={() => setShowAdminMenu(true)} aria-label="Admin tools" className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0"><ShieldCheck size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Admin</span></button>}
            <button onClick={() => setShowSettingsModal(true)} aria-label="Settings" className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0"><Settings size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Settings</span></button>
            <button onClick={handleLogout} aria-label="Log out" className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0"><LogOut size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Logout</span></button>
          </div>
        </div>
      </header>

      {aircraftStatus === 'grounded' && (
        <div role="alert" className="bg-danger text-white text-center py-2 px-4 shadow-md z-10 flex flex-col justify-center items-center shrink-0 w-full">
          <div className="flex items-center gap-2"><AlertTriangle size={16} /><span className="font-oswald tracking-widest font-bold uppercase text-sm">Not Flight Ready</span><AlertTriangle size={16} /></div>
          {groundedReason && <span className="text-[10px] font-bold uppercase tracking-widest text-white/80 mt-0.5">{groundedReason}</span>}
        </div>
      )}

      <PullIndicator pullProgress={pullProgress} phase={pullPhase} />

      <main
        className="fixed left-0 right-0 overflow-y-auto bg-neutral-100 flex justify-center w-full"
        style={{
          touchAction: 'manipulation',
          overscrollBehaviorY: 'contain',
          WebkitOverflowScrolling: 'touch',
          top: 'calc(3.5rem + env(safe-area-inset-top, 0px))',
          bottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))',
        }}
        {...pullHandlers}
      >
        <div className="w-full max-w-3xl flex flex-col gap-6 p-4">
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
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy mb-2">No aircraft in your hangar</h2>
              <p className="font-roboto text-sm text-gray-500 mb-6 max-w-sm">
                Add an aircraft to start tracking flights, maintenance, squawks, and more.
              </p>
              <button
                onClick={() => openAircraftForm(null)}
                className="bg-brandOrange text-white font-oswald font-bold uppercase tracking-widest text-sm py-3 px-8 rounded-lg active:scale-95 transition-transform shadow-md"
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
            {activeTab === 'summary' && <SummaryTab aircraft={selectedAircraftData} setActiveTab={(t: AppTab) => navigateTab(t)} onNavigateToSquawks={() => { setMxSubTab('squawks'); navigateTab('mx'); }} role={role} aircraftRole={currentAircraftRole} onDeleteAircraft={handleDeleteAircraft} sysSettings={sysSettings} onEditAircraft={() => openAircraftForm(selectedAircraftData)} refreshData={() => fetchAircraftData(session.user.id)} session={session} aircraftStatus={aircraftStatus} userInitials={userInitials} />}
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
      {/* Hidden while a bottom NavTray is open — the tray's rightmost
       * item (ADs in the MX tray, Howard in More) lives in the same
       * bottom-right corner as the FAB on narrow phones, and the FAB
       * was sitting on top of those tap targets. Trays are transient
       * (tap → pick → dismiss), so hiding the FAB for that moment
       * doesn't cost the user access to Howard. */}
      {activeTab !== 'howard' && activeTab !== 'howard-usage' && expandedNav === null && (
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
              icon: activeTab === 'fleet' ? Warehouse : Home,
              label: activeTab === 'fleet' ? 'Hangar' : 'Home',
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
              <div className="relative mb-1"><tab.icon size={20} />{tab.badge > 0 && <span className="absolute -top-1 -right-2 flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-danger text-[8px] text-white font-bold items-center justify-center border border-white"></span></span>}</div>
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

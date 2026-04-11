"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { useFleetData, useRealtimeSync, useGroundedStatus, useAircraftRole, usePullToRefresh } from "@/hooks";
import { NETWORK_TIMEOUT_MS } from "@/lib/constants";
import { useToast } from "@/components/ToastProvider";
import dynamic from "next/dynamic";
import type { AircraftWithMetrics, AppTab } from "@/lib/types";
import { 
  Wrench, AlertTriangle, FileText, Clock, LogOut, 
  ChevronDown, Home, LayoutGrid, Send, ShieldCheck, X, Share, Copy, WifiOff, Loader2, Calendar, Settings
} from "lucide-react";

const PilotOnboarding = dynamic(() => import("@/components/PilotOnboarding"));
const AircraftModal = dynamic(() => import("@/components/modals/AircraftModal"));
const AdminModals = dynamic(() => import("@/components/modals/AdminModals"));
const TutorialModal = dynamic(() => import("@/components/modals/TutorialModal"));
const SettingsModal = dynamic(() => import("@/components/modals/SettingsModal"));
const PullIndicator = dynamic(() => import("@/components/PullIndicator"));
import { SummarySkeleton, FleetSkeleton, TabSkeleton } from "@/components/Skeletons";
const SummaryTab = dynamic(() => import("@/components/tabs/SummaryTab"), { loading: () => <SummarySkeleton /> });
const TimesTab = dynamic(() => import("@/components/tabs/TimesTab"), { loading: () => <TabSkeleton /> });
const CalendarTab = dynamic(() => import("@/components/tabs/CalendarTab"), { loading: () => <TabSkeleton /> });
const MaintenanceTab = dynamic(() => import("@/components/tabs/MaintenanceTab"), { loading: () => <TabSkeleton /> });
const NotesTab = dynamic(() => import("@/components/tabs/NotesTab"), { loading: () => <TabSkeleton /> });
const FleetSummary = dynamic(() => import("@/components/tabs/FleetSummary"), { loading: () => <FleetSkeleton /> });

/** Inline MX sub-tab picker with "remember selection" checkbox */
function MxPicker({ onSelect, onClose }: { onSelect: (sub: 'maintenance' | 'squawks') => void, onClose: () => void }) {
  const [remember, setRemember] = useState(false);
  const handleSelect = (sub: 'maintenance' | 'squawks') => {
    if (remember) localStorage.setItem('aft_mx_default_subtab', sub);
    onSelect(sub);
  };
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50 animate-fade-in" onClick={onClose}>
      <div role="dialog" aria-label="Select maintenance or squawks view" className="bg-white w-full max-w-sm rounded-lg shadow-2xl p-5 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex gap-3">
          <button onClick={() => handleSelect('maintenance')} className="flex-1 bg-cream border-2 border-[#F08B46] rounded-lg p-5 flex flex-col items-center gap-3 hover:bg-orange-50 active:scale-95 transition-all">
            <div className="bg-[#F08B46] text-white p-3 rounded-full"><Wrench size={24} /></div>
            <span className="font-oswald text-sm font-bold uppercase tracking-widest text-navy">Maintenance</span>
            <span className="text-[10px] text-gray-500 text-center leading-tight">Track items, schedule service, manage work packages</span>
          </button>
          <button onClick={() => handleSelect('squawks')} className="flex-1 bg-cream border-2 border-[#CE3732] rounded-lg p-5 flex flex-col items-center gap-3 hover:bg-red-50 active:scale-95 transition-all">
            <div className="bg-[#CE3732] text-white p-3 rounded-full"><AlertTriangle size={24} /></div>
            <span className="font-oswald text-sm font-bold uppercase tracking-widest text-navy">Squawks</span>
            <span className="text-[10px] text-gray-500 text-center leading-tight">Report discrepancies, track open issues, manage deferrals</span>
          </button>
        </div>
        <label className="flex items-center justify-center gap-2 mt-4 pt-3 border-t border-gray-100 cursor-pointer">
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="w-4 h-4 text-navy border-gray-300 rounded" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Remember my selection</span>
        </label>
        {localStorage.getItem('aft_mx_default_subtab') && (
          <button onClick={() => { localStorage.removeItem('aft_mx_default_subtab'); onClose(); }} className="w-full mt-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-[#CE3732] transition-colors py-1">Clear Saved Preference</button>
        )}
      </div>
    </div>
  );
}

interface AppShellProps {
  session: any;
}

export default function AppShell({ session }: AppShellProps) {
  const { showSuccess, showError, showInfo } = useToast();

  // ─── Fleet Data (extracted hook) ───
  const {
    role, userInitials, allAircraftList, aircraftList, allAccessRecords,
    isDataLoaded, sysSettings, setSysSettings, dataFetchTriggeredRef,
    fetchAircraftData, enrichSingleAircraft, refreshForAircraft, globalMutate,
    globalFleetIndex, fetchGlobalFleetIndex, fetchSingleAircraft,
  } = useFleetData();

  // ─── Navigation State ───
  const companionUrl = process.env.NEXT_PUBLIC_COMPANION_URL || "https://skyward-logit.vercel.app/";
  const [activeTail, setActiveTail] = useState<string>("");
  // Optional target for the Calendar tab — set by Fleet Schedule when a user
  // taps a reservation there so CalendarTab opens on the right date/view.
  const [calendarInitialDate, setCalendarInitialDate] = useState<Date | null>(null);
  const [calendarInitialView, setCalendarInitialView] = useState<'month' | 'week' | 'day' | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('aft_active_tab');
      if (saved && ['fleet','summary','times','calendar','mx','notes'].includes(saved)) return saved as AppTab;
    }
    return 'fleet';
  });
  const [unreadNotes, setUnreadNotes] = useState(0);
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showLogItModal, setShowLogItModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showMxPicker, setShowMxPicker] = useState(false);
  const [mxSubTab, setMxSubTab] = useState<'maintenance' | 'squawks'>('maintenance');
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

  // ─── Derived State (extracted hooks) ───
  const { aircraftStatus, groundedReason, checkGroundedStatus } = useGroundedStatus(allAircraftList);
  const currentAircraftRole = useAircraftRole(activeTail, allAircraftList, allAccessRecords, session);

  // ─── Realtime (extracted hook) ───
  const boundRefresh = useCallback(
    (aircraftId: string) => {
      if (session?.user?.id) refreshForAircraft(aircraftId, session.user.id);
    },
    [session, refreshForAircraft]
  );
  useRealtimeSync(session, boundRefresh, globalMutate);

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
    const anyPageModalOpen = showAdminMenu || showLogItModal || showSettingsModal || showMxPicker || showAircraftModal || showTailDropdown;
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
  }, [showAdminMenu, showLogItModal, showSettingsModal, showMxPicker, showAircraftModal, showTailDropdown, setPullEnabled]);

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
    const { data: notes } = await supabase.from('aft_notes').select('id').eq('aircraft_id', ac.id);
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

  const getTabColor = (id: string) => {
    if (activeTab !== id) return 'text-gray-400 hover:bg-gray-50';
    const m: Record<string, string> = { summary: 'text-navy', times: 'text-[#3AB0FF]', calendar: 'text-[#56B94A]', mx: 'text-[#F08B46]', notes: 'text-[#525659]' };
    return m[id] || 'text-brandOrange';
  };

  const getIndicatorColor = (id: string) => {
    const m: Record<string, string> = { summary: 'bg-navy', times: 'bg-[#3AB0FF]', calendar: 'bg-[#56B94A]', mx: 'bg-[#F08B46]', notes: 'bg-[#525659]' };
    return m[id] || 'bg-brandOrange';
  };

  const canEditAircraft = role === 'admin' || currentAircraftRole === 'admin';

  // ─── Pilot onboarding ───
  if (role === 'pilot' && aircraftList.length === 0 && isDataLoaded) {
    return <PilotOnboarding session={session} handleLogout={handleLogout} onSuccess={() => handleInitialFetch(session.user.id)} />;
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
      <TutorialModal session={session} role={role} />
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
        <div className="fixed inset-0 bg-black/80 z-[10000] flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowLogItModal(false)}>
          <div role="dialog" aria-label="Install Log It companion app" className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 border-t-8 border-[#3AB0FF] animate-slide-up relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowLogItModal(false)} aria-label="Close" className="absolute top-4 right-4 text-gray-400 hover:text-red-500"><X size={24}/></button>
            <h3 className="font-oswald text-2xl font-bold uppercase tracking-widest text-navy mb-4">Install Log It</h3>
            <p className="text-sm text-gray-600 font-roboto mb-4 leading-relaxed">Log It is a companion app that is designed to make logging times and squawks easy on the go.</p>
            <ol className="text-left text-sm text-gray-600 font-roboto mb-8 space-y-2 max-w-xs mx-auto list-decimal pl-4"><li>Tap below to copy the app link.</li><li>Open your phone&apos;s browser and paste the link.</li><li>Use the Share menu <Share size={14} className="inline text-blue-500 mb-1"/> to Add to Home Screen.</li></ol>
            <button onClick={handleCopyQuickLink} className="w-full bg-[#3AB0FF] text-white font-oswald text-xl font-bold uppercase tracking-widest py-4 rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"><Copy size={20} /> Copy App Link</button>
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
            {activeTab === 'times' && <TimesTab aircraft={selectedAircraftData} session={session} role={role} userInitials={userInitials} onUpdate={() => fetchAircraftData(session.user.id)} />}
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
          </>)}
        </div>
      </main>

      <nav role="navigation" aria-label="Main navigation" className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-200 z-[9999] pt-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <div className="flex justify-around items-center h-12 max-w-3xl mx-auto">
          {[
            {
              id: 'summary',
              icon: activeTab === 'fleet' ? LayoutGrid : Home,
              label: activeTab === 'fleet' ? 'Fleet' : 'Home',
              badge: 0,
            },
            { id: 'times', icon: Clock, label: 'Times', badge: 0 },
            { id: 'calendar', icon: Calendar, label: 'Calendar', badge: 0 },
            { id: 'mx', icon: Wrench, label: 'MX', badge: 0 },
            { id: 'notes', icon: FileText, label: 'Notes', badge: unreadNotes }
          ].map(tab => {
            const isActive = tab.id === 'summary'
              ? (activeTab === 'summary' || activeTab === 'fleet')
              : activeTab === tab.id;
            return (
            <button key={tab.id} onClick={() => {
              if (tab.id === 'mx') {
                if (activeTab === 'mx') {
                  // Already on MX — tap the tab again to toggle between
                  // Maintenance and Squawks. Faster on the ramp than
                  // re-opening the picker modal.
                  setMxSubTab(prev => prev === 'maintenance' ? 'squawks' : 'maintenance');
                } else {
                  const remembered = localStorage.getItem('aft_mx_default_subtab');
                  if (remembered === 'maintenance' || remembered === 'squawks') {
                    setMxSubTab(remembered);
                    navigateTab('mx');
                  } else {
                    setShowMxPicker(true);
                  }
                }
              } else if (tab.id === 'summary') {
                // Home/Fleet toggle: from any non-home tab, first tap lands on
                // the active tail's home. A second tap (already on summary)
                // jumps out to the fleet grid. Tapping again while on fleet
                // is a no-op — pick an aircraft from the grid to return.
                if (activeTab === 'summary' && showFleetButton) {
                  navigateTab('fleet');
                } else if (activeTab !== 'fleet') {
                  navigateTab('summary');
                }
              } else {
                navigateTab(tab.id as AppTab);
              }
            }} aria-label={tab.label} aria-current={isActive ? 'page' : undefined} className={`flex-1 pb-1 flex flex-col items-center justify-center transition-all relative active:scale-95 ${isActive ? (tab.id === 'summary' ? 'text-navy' : getTabColor(tab.id)) : 'text-gray-400 hover:bg-gray-50'}`}>
              <div className="relative mb-1"><tab.icon size={20} />{tab.badge > 0 && <span className="absolute -top-1 -right-2 flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#CE3732] opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-[#CE3732] text-[8px] text-white font-bold items-center justify-center border border-white"></span></span>}</div>
              <span className="text-[10px] font-bold uppercase tracking-widest">{tab.label}</span>
              {isActive && <div className={`absolute bottom-0 w-12 h-1 rounded-t-full ${getIndicatorColor(tab.id)}`}></div>}
            </button>
            );
          })}
        </div>
      </nav>

      {/* ─── MX ENTRY PICKER ─── */}
      {showMxPicker && (
        <MxPicker 
          onSelect={(sub) => { setMxSubTab(sub); navigateTab('mx'); setShowMxPicker(false); }} 
          onClose={() => setShowMxPicker(false)} 
        />
      )}
    </div>
  );
}

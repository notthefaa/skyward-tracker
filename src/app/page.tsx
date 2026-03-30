"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { enrichAircraftWithMetrics } from "@/lib/math";
import { useSWRConfig } from "swr";
import dynamic from "next/dynamic";
import type { AircraftWithMetrics, SystemSettings, AppRole, AircraftRole, AircraftStatus, AppTab } from "@/lib/types";
import { 
  Wrench, AlertTriangle, FileText, Clock, LogOut, 
  ChevronDown, Home, LayoutGrid, Send, ShieldCheck, X, Share, Copy, WifiOff, Loader2, Calendar, Settings
} from "lucide-react";

const AuthScreen = dynamic(() => import("@/components/AuthScreen"));
const PilotOnboarding = dynamic(() => import("@/components/PilotOnboarding"));
const AircraftModal = dynamic(() => import("@/components/modals/AircraftModal"));
const AdminModals = dynamic(() => import("@/components/modals/AdminModals"));
const TutorialModal = dynamic(() => import("@/components/modals/TutorialModal"));
const SettingsModal = dynamic(() => import("@/components/modals/SettingsModal"));
const SummaryTab = dynamic(() => import("@/components/tabs/SummaryTab"));
const TimesTab = dynamic(() => import("@/components/tabs/TimesTab"));
const CalendarTab = dynamic(() => import("@/components/tabs/CalendarTab"));
const MaintenanceTab = dynamic(() => import("@/components/tabs/MaintenanceTab"));
const NotesTab = dynamic(() => import("@/components/tabs/NotesTab"));
const FleetSummary = dynamic(() => import("@/components/tabs/FleetSummary"));

export default function FleetTrackerApp() {
  const [session, setSession] = useState<any>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isNetworkTimeout, setIsNetworkTimeout] = useState(false);
  const dataFetchTriggeredRef = useRef(false);
  const [role, setRole] = useState<AppRole>('pilot');
  const [userInitials, setUserInitials] = useState("");
  const companionUrl = process.env.NEXT_PUBLIC_COMPANION_URL || "https://your-logit-app.vercel.app";
  const [allAircraftList, setAllAircraftList] = useState<AircraftWithMetrics[]>([]);
  const [aircraftList, setAircraftList] = useState<AircraftWithMetrics[]>([]);
  const [activeTail, setActiveTail] = useState<string>("");
  const [activeTab, setActiveTab] = useState<AppTab>('fleet');
  const [aircraftStatus, setAircraftStatus] = useState<AircraftStatus>('airworthy');
  const [groundedReason, setGroundedReason] = useState<string>("");
  const [unreadNotes, setUnreadNotes] = useState(0);
  const [currentAircraftRole, setCurrentAircraftRole] = useState<AircraftRole | null>(null);
  const [allAccessRecords, setAllAccessRecords] = useState<any[]>([]);
  const [sysSettings, setSysSettings] = useState<SystemSettings>({ id: 1, reminder_1: 30, reminder_2: 15, reminder_3: 5, reminder_hours_1: 30, reminder_hours_2: 15, reminder_hours_3: 5, sched_time: 10, sched_days: 30, predictive_sched_days: 45 });
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showLogItModal, setShowLogItModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showMxPicker, setShowMxPicker] = useState(false);
  const [mxSubTab, setMxSubTab] = useState<'maintenance' | 'squawks'>('maintenance');
  const [showAircraftModal, setShowAircraftModal] = useState(false);
  const [editingAircraftId, setEditingAircraftId] = useState<string | null>(null);
  const { mutate: globalMutate } = useSWRConfig();

  useEffect(() => {
    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;
    if (appVersion) { const lv = localStorage.getItem('aft_app_version'); if (lv && lv !== appVersion) { localStorage.setItem('aft_app_version', appVersion); window.location.reload(); } else if (!lv) { localStorage.setItem('aft_app_version', appVersion); } }
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setIsAuthChecking(false); if (session && !dataFetchTriggeredRef.current) { dataFetchTriggeredRef.current = true; fetchAircraftData(session.user.id); } });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => { setSession(session); setIsAuthChecking(false); if (event === 'SIGNED_IN' && session) { setActiveTab('fleet'); if (!dataFetchTriggeredRef.current) { dataFetchTriggeredRef.current = true; fetchAircraftData(session.user.id); } } else if (event === 'SIGNED_OUT') { dataFetchTriggeredRef.current = false; setIsDataLoaded(false); setActiveTab('fleet'); } });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { let t: NodeJS.Timeout; if (isAuthChecking || (session && !isDataLoaded)) { t = setTimeout(() => setIsNetworkTimeout(true), 12000); } return () => { clearTimeout(t); setIsNetworkTimeout(false); }; }, [isAuthChecking, session, isDataLoaded]);

  useEffect(() => {
    if (!activeTail || !session || allAccessRecords.length === 0) { setCurrentAircraftRole(null); return; }
    const ac = allAircraftList.find(a => a.tail_number === activeTail);
    if (!ac) { setCurrentAircraftRole(null); return; }
    const access = allAccessRecords.find((a: any) => a.aircraft_id === ac.id && a.user_id === session.user.id);
    setCurrentAircraftRole(access?.aircraft_role || null);
  }, [activeTail, allAccessRecords, allAircraftList, session]);

  const refreshForAircraft = useCallback(async (aircraftId: string) => {
    if (!session?.user?.id) return;
    const ago = new Date(); ago.setDate(ago.getDate() - 180);
    const [pR, lR] = await Promise.all([supabase.from('aft_aircraft').select('*').eq('id', aircraftId).single(), supabase.from('aft_flight_logs').select('aircraft_id, ftt, tach, created_at').eq('aircraft_id', aircraftId).gte('created_at', ago.toISOString()).order('created_at', { ascending: true })]);
    if (pR.data) { const up = enrichAircraftWithMetrics([pR.data], lR.data || [])[0]; setAllAircraftList(prev => prev.map(a => a.id === aircraftId ? up : a)); setAircraftList(prev => prev.map(a => a.id === aircraftId ? up : a)); }
    globalMutate((key: any) => typeof key === 'string' && key.includes(aircraftId), undefined, { revalidate: true });
  }, [session, globalMutate]);

  useEffect(() => {
    if (!session) return;
    const timers: Record<string, NodeJS.Timeout> = {};
    const handle = (payload: any) => {
      const nr = payload.new; if (nr) { if (nr.user_id === session.user.id || nr.reported_by === session.user.id || nr.author_id === session.user.id) return; }
      const aid = nr?.aircraft_id || null;
      if (aid) { if (timers[aid]) clearTimeout(timers[aid]); timers[aid] = setTimeout(() => { refreshForAircraft(aid); delete timers[aid]; }, 1500); }
      else { if (timers['__g']) clearTimeout(timers['__g']); timers['__g'] = setTimeout(() => { globalMutate(() => true, undefined, { revalidate: true }); delete timers['__g']; }, 1500); }
    };
    const ch = supabase.channel('fleet-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'aft_flight_logs' }, handle)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'aft_squawks' }, handle)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'aft_squawks' }, handle)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aft_maintenance_items' }, handle)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'aft_notes' }, handle)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aft_maintenance_events' }, handle)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aft_event_messages' }, handle)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aft_reservations' }, handle)
      .subscribe();
    return () => { Object.values(timers).forEach(t => clearTimeout(t)); supabase.removeChannel(ch); };
  }, [session, refreshForAircraft, globalMutate]);

  useEffect(() => { if (activeTail) localStorage.setItem('aft_active_tail', activeTail); }, [activeTail]);
  useEffect(() => { if (activeTail && allAircraftList.length > 0 && session) { checkGroundedStatus(activeTail); fetchUnreadNotes(activeTail, session.user.id); } }, [activeTail, allAircraftList, session]);

  const fetchAircraftData = async (userId: string) => {
    const ago = new Date(); ago.setDate(ago.getDate() - 180);
    const [sR, rR, pR, lR, aR] = await Promise.all([
      supabase.from('aft_system_settings').select('*').eq('id', 1).single(),
      supabase.from('aft_user_roles').select('role, initials').eq('user_id', userId).single(),
      supabase.from('aft_aircraft').select('*').order('tail_number'),
      supabase.from('aft_flight_logs').select('aircraft_id, ftt, tach, created_at').gte('created_at', ago.toISOString()).order('created_at', { ascending: true }),
      supabase.from('aft_user_aircraft_access').select('aircraft_id, aircraft_role, user_id').eq('user_id', userId),
    ]);
    if (sR.data) setSysSettings(sR.data as SystemSettings);
    if (rR.data) { setRole(rR.data.role as AppRole); setUserInitials(rR.data.initials || ""); }
    const allPlanes = enrichAircraftWithMetrics(pR.data || [], lR.data || []);
    setAllAircraftList(allPlanes);
    const accessData = aR.data || [];
    setAllAccessRecords(accessData);
    const assignedIds = accessData.map((a: any) => a.aircraft_id);
    const assigned = allPlanes.filter(a => assignedIds.includes(a.id));
    setAircraftList(assigned);
    const saved = localStorage.getItem('aft_active_tail');
    if (saved && allPlanes.some(a => a.tail_number === saved)) setActiveTail(saved);
    else if (assigned.length > 0 && !activeTail) setActiveTail(assigned[0].tail_number);
    else if (!activeTail) setActiveTail("");
    setIsDataLoaded(true);
  };

  const fetchUnreadNotes = async (tail: string, userId: string) => {
    const ac = allAircraftList.find(a => a.tail_number === tail); if (!ac) return;
    const { data: notes } = await supabase.from('aft_notes').select('id').eq('aircraft_id', ac.id);
    if (!notes || notes.length === 0) return setUnreadNotes(0);
    const ids = notes.map(n => n.id);
    const { data: reads } = await supabase.from('aft_note_reads').select('note_id').eq('user_id', userId).in('note_id', ids);
    setUnreadNotes(ids.length - (reads ? reads.length : 0));
  };

  const checkGroundedStatus = async (tail: string) => {
    const ac = allAircraftList.find(a => a.tail_number === tail); if (!ac) return;
    let isGrounded = false, hasOpen = false, reason = "";
    const { data: mx } = await supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', ac.id);
    if (mx) { const et = ac.total_engine_time || 0; for (const item of mx) { if (!item.is_required) continue; if (item.tracking_type === 'time' && item.due_time <= et) { isGrounded = true; reason = `${item.item_name} expired by ${(et - item.due_time).toFixed(1)} hrs`; break; } if (item.tracking_type === 'date' && new Date(item.due_date + 'T00:00:00') < new Date(new Date().setHours(0,0,0,0))) { isGrounded = true; const d = Math.ceil((Date.now() - new Date(item.due_date + 'T00:00:00').getTime()) / 86400000); reason = `${item.item_name} expired ${d} day${d > 1 ? 's' : ''} ago`; break; } } }
    if (!isGrounded) { const { data: sq } = await supabase.from('aft_squawks').select('*').eq('aircraft_id', ac.id).eq('status', 'open'); if (sq && sq.length > 0) { const g = sq.find(s => s.affects_airworthiness); if (g) { isGrounded = true; reason = `AOG squawk${g.location ? ' at ' + g.location : ''}`; } else hasOpen = true; } }
    setGroundedReason(reason);
    if (isGrounded) setAircraftStatus('grounded'); else if (hasOpen) setAircraftStatus('issues'); else setAircraftStatus('airworthy');
  };

  const handleDeleteAircraft = async (id: string) => { await supabase.from('aft_aircraft').delete().eq('id', id); await fetchAircraftData(session.user.id); setActiveTab('fleet'); };
  const handleTailChange = (v: string) => { if (v === '__add_new__') { setEditingAircraftId(null); setShowAircraftModal(true); } else setActiveTail(v); };
  const handleCopyQuickLink = () => { if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(companionUrl).then(() => alert("Link copied! Now open your phone's browser, paste the link, and Add to Home Screen.")).catch(() => alert(`Please manually copy this link: ${companionUrl}`)); } else alert(`Please manually copy this link: ${companionUrl}`); };
  const handleLogout = async () => { await supabase.auth.signOut(); };
  const openAircraftForm = (ac: AircraftWithMetrics | null = null) => { setEditingAircraftId(ac?.id || null); setShowAircraftModal(true); };

  const getTabColor = (id: string) => { if (activeTab !== id) return 'text-gray-400 hover:bg-gray-50'; const m: Record<string, string> = { summary: 'text-navy', times: 'text-[#3AB0FF]', calendar: 'text-[#3AB0FF]', mx: 'text-[#F08B46]', notes: 'text-[#525659]' }; return m[id] || 'text-brandOrange'; };
  const getIndicatorColor = (id: string) => { const m: Record<string, string> = { summary: 'bg-navy', times: 'bg-[#3AB0FF]', calendar: 'bg-[#3AB0FF]', mx: 'bg-[#F08B46]', notes: 'bg-[#525659]' }; return m[id] || 'bg-brandOrange'; };

  const canEditAircraft = role === 'admin' || currentAircraftRole === 'admin';

  if (isAuthChecking) {
    if (isNetworkTimeout) return (<div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full text-white text-center"><WifiOff size={64} className="mb-6 text-brandOrange animate-pulse" /><h2 className="font-oswald text-3xl tracking-widest uppercase mb-4">Connection Timeout</h2><p className="text-sm font-roboto text-gray-300 mb-8 max-w-xs leading-relaxed">We are having trouble connecting to the database. You may be experiencing spotty cell or WiFi coverage.</p><button onClick={() => window.location.reload()} className="w-full max-w-xs bg-brandOrange text-white font-oswald text-xl tracking-widest uppercase py-4 rounded-xl shadow-lg active:scale-95 transition-transform">Refresh App</button></div>);
    return <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full text-white font-oswald text-2xl tracking-widest uppercase animate-pulse">Loading...</div>;
  }
  if (!session) return <AuthScreen />;
  if (role === 'pilot' && aircraftList.length === 0 && isDataLoaded) return <PilotOnboarding session={session} handleLogout={handleLogout} onSuccess={() => fetchAircraftData(session.user.id)} />;

  const dropdownOptions = [...aircraftList];
  if (activeTail && !dropdownOptions.some(a => a.tail_number === activeTail)) { const o = allAircraftList.find(a => a.tail_number === activeTail); if (o) dropdownOptions.push(o); }
  const selectedAircraftData = allAircraftList.find(a => a.tail_number === activeTail) || null;
  const showFleetButton = aircraftList.length > 1;

  return (
    <><div className="flex flex-col bg-neutral-100 w-full min-h-screen relative">
      <TutorialModal session={session} role={role} />
      <AdminModals showAdminMenu={showAdminMenu} setShowAdminMenu={setShowAdminMenu} allAircraftList={allAircraftList} setActiveTail={setActiveTail} setActiveTab={setActiveTab} sysSettings={sysSettings} setSysSettings={setSysSettings} refreshData={() => fetchAircraftData(session.user.id)} />
      <SettingsModal show={showSettingsModal} onClose={() => setShowSettingsModal(false)} session={session} />
      {showAircraftModal && <AircraftModal session={session} existingAircraft={editingAircraftId ? allAircraftList.find(a => a.id === editingAircraftId) || null : null} onClose={() => setShowAircraftModal(false)} onSuccess={(t: string) => { setShowAircraftModal(false); fetchAircraftData(session.user.id); setActiveTail(t); }} />}

      {showLogItModal && (
        <div className="fixed inset-0 bg-black/80 z-[10000] flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowLogItModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 border-t-8 border-[#3AB0FF] animate-slide-up relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowLogItModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500"><X size={24}/></button>
            <h3 className="font-oswald text-2xl font-bold uppercase tracking-widest text-navy mb-4">Install Log It</h3>
            <p className="text-sm text-gray-600 font-roboto mb-4 leading-relaxed">Log It is a companion app that is designed to make logging times and squawks easy on the go.</p>
            <ol className="text-left text-sm text-gray-600 font-roboto mb-8 space-y-2 max-w-xs mx-auto list-decimal pl-4"><li>Tap below to copy the app link.</li><li>Open your phone&apos;s browser and paste the link.</li><li>Use the Share menu <Share size={14} className="inline text-blue-500 mb-1"/> to Add to Home Screen.</li></ol>
            <button onClick={handleCopyQuickLink} className="w-full bg-[#3AB0FF] text-white font-oswald text-xl font-bold uppercase tracking-widest py-4 rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"><Copy size={20} /> Copy App Link</button>
          </div>
        </div>
      )}

      <header className="fixed top-0 left-0 right-0 bg-navy text-white shadow-md z-[9999]" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-3xl mx-auto px-4 py-2 flex justify-between items-center w-full min-h-[52px]">
          <div className="flex flex-col">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#F5B05B] mb-[2px]">Active Aircraft</span>
            <div className="flex items-center gap-3">
              <div className={`w-3.5 h-3.5 rounded-full shrink-0 shadow-inner ${aircraftStatus === 'grounded' ? 'bg-red-500' : aircraftStatus === 'issues' ? 'bg-[#F08B46]' : 'bg-success'}`} />
              <div className="relative flex items-center">
                <select className="appearance-none bg-transparent text-xl font-oswald font-bold uppercase tracking-wide focus:outline-none cursor-pointer w-[140px] shrink-0 text-white pr-6 truncate" value={activeTail} onChange={e => handleTailChange(e.target.value)}>
                  {dropdownOptions.length > 0 ? dropdownOptions.map(a => <option key={a.id} value={a.tail_number} className="text-white">{a.tail_number}</option>) : <option value="">—</option>}
                  <option value="__add_new__" className="text-white">+ Add Aircraft</option>
                </select>
                <ChevronDown size={18} className="absolute right-1 text-white pointer-events-none opacity-80" />
              </div>
            </div>
          </div>
          <div className="flex gap-4">
            {showFleetButton && <button onClick={() => setActiveTab('fleet')} className={`hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0 ${activeTab === 'fleet' ? 'text-[#3AB0FF]' : 'text-gray-300'}`}><LayoutGrid size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Fleet</span></button>}
            <button onClick={() => setShowLogItModal(true)} className="text-gray-300 hover:text-[#3AB0FF] transition-colors flex flex-col items-center active:scale-95 shrink-0"><Send size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Log It</span></button>
            {role === 'admin' && <button onClick={() => setShowAdminMenu(true)} className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0"><ShieldCheck size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Admin</span></button>}
            <button onClick={() => setShowSettingsModal(true)} className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0"><Settings size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Settings</span></button>
            <button onClick={handleLogout} className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0"><LogOut size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Logout</span></button>
          </div>
        </div>
      </header>

      {aircraftStatus === 'grounded' && (
        <div className="bg-[#CE3732] text-white text-center py-2 px-4 shadow-md z-10 flex flex-col justify-center items-center shrink-0 w-full">
          <div className="flex items-center gap-2"><AlertTriangle size={16} /><span className="font-oswald tracking-widest font-bold uppercase text-sm">Not Flight Ready</span><AlertTriangle size={16} /></div>
          {groundedReason && <span className="text-[10px] font-bold uppercase tracking-widest text-white/80 mt-0.5">{groundedReason}</span>}
        </div>
      )}

      <main className="fixed left-0 right-0 overflow-y-auto bg-neutral-100 p-4 flex justify-center w-full" style={{ touchAction: 'auto', top: 'calc(3.5rem + env(safe-area-inset-top, 0px))', bottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' }}>
        <div className="w-full max-w-3xl flex flex-col gap-6">
          {!isDataLoaded ? (
            <div className="flex flex-col items-center justify-center py-20 animate-pulse"><Loader2 size={32} className="text-[#F08B46] animate-spin mb-4" /><p className="font-oswald text-sm font-bold uppercase tracking-widest text-gray-400">Loading Fleet Data...</p></div>
          ) : (<>
            {activeTab === 'fleet' && <FleetSummary aircraftList={aircraftList} onSelectAircraft={(t: string) => { setActiveTail(t); setActiveTab('summary'); }} />}
            {activeTab === 'summary' && <SummaryTab aircraft={selectedAircraftData} setActiveTab={(t: AppTab) => setActiveTab(t)} role={role} aircraftRole={currentAircraftRole} onDeleteAircraft={handleDeleteAircraft} sysSettings={sysSettings} onEditAircraft={() => openAircraftForm(selectedAircraftData)} refreshData={() => fetchAircraftData(session.user.id)} session={session} />}
            {activeTab === 'times' && <TimesTab aircraft={selectedAircraftData} session={session} role={role} userInitials={userInitials} onUpdate={() => fetchAircraftData(session.user.id)} />}
            {activeTab === 'calendar' && <CalendarTab aircraft={selectedAircraftData} session={session} aircraftRole={currentAircraftRole} />}
            {activeTab === 'mx' && <MaintenanceTab aircraft={selectedAircraftData} role={role} aircraftRole={currentAircraftRole} onGroundedStatusChange={() => checkGroundedStatus(activeTail)} sysSettings={sysSettings} session={session} userInitials={userInitials} initialSubTab={mxSubTab} />}
            {activeTab === 'notes' && <NotesTab aircraft={selectedAircraftData} session={session} role={role} userInitials={userInitials} onNotesRead={() => setUnreadNotes(0)} />}
          </>)}
        </div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-200 z-[9999] pt-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <div className="flex justify-around items-center h-12 max-w-3xl mx-auto">
          {[
            { id: 'summary', icon: Home, label: 'Home', badge: 0 },
            { id: 'times', icon: Clock, label: 'Times', badge: 0 },
            { id: 'calendar', icon: Calendar, label: 'Calendar', badge: 0 },
            { id: 'mx', icon: Wrench, label: 'MX', badge: 0 },
            { id: 'notes', icon: FileText, label: 'Notes', badge: unreadNotes }
          ].map(tab => (
            <button key={tab.id} onClick={() => {
              if (tab.id === 'mx') {
                if (activeTab === 'mx') { setShowMxPicker(true); } // Already on MX — show picker to switch
                else { setShowMxPicker(true); } // Not on MX — show picker
              } else {
                setActiveTab(tab.id as AppTab);
              }
            }} className={`flex-1 pb-1 flex flex-col items-center justify-center transition-all relative active:scale-95 ${getTabColor(tab.id)}`}>
              <div className="relative mb-1"><tab.icon size={20} />{tab.badge > 0 && <span className="absolute -top-1 -right-2 flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#CE3732] opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-[#CE3732] text-[8px] text-white font-bold items-center justify-center border border-white"></span></span>}</div>
              <span className="text-[10px] font-bold uppercase tracking-widest">{tab.label}</span>
              {activeTab === tab.id && <div className={`absolute bottom-0 w-12 h-1 rounded-t-full ${getIndicatorColor(tab.id)}`}></div>}
            </button>
          ))}
        </div>
      </nav>

      {/* ─── MX ENTRY PICKER ─── */}
      {showMxPicker && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50 animate-fade-in" onClick={() => setShowMxPicker(false)}>
          <div className="bg-white w-full max-w-sm rounded-lg shadow-2xl p-5 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex gap-3">
              <button 
                onClick={() => { setMxSubTab('maintenance'); setActiveTab('mx'); setShowMxPicker(false); }} 
                className="flex-1 bg-cream border-2 border-[#F08B46] rounded-lg p-5 flex flex-col items-center gap-3 hover:bg-orange-50 active:scale-95 transition-all"
              >
                <div className="bg-[#F08B46] text-white p-3 rounded-full"><Wrench size={24} /></div>
                <span className="font-oswald text-sm font-bold uppercase tracking-widest text-navy">Maintenance</span>
                <span className="text-[10px] text-gray-500 text-center leading-tight">Track items, schedule service, manage work packages</span>
              </button>
              <button 
                onClick={() => { setMxSubTab('squawks'); setActiveTab('mx'); setShowMxPicker(false); }} 
                className="flex-1 bg-cream border-2 border-[#CE3732] rounded-lg p-5 flex flex-col items-center gap-3 hover:bg-red-50 active:scale-95 transition-all"
              >
                <div className="bg-[#CE3732] text-white p-3 rounded-full"><AlertTriangle size={24} /></div>
                <span className="font-oswald text-sm font-bold uppercase tracking-widest text-navy">Squawks</span>
                <span className="text-[10px] text-gray-500 text-center leading-tight">Report discrepancies, track open issues, manage deferrals</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div></>
  );
}

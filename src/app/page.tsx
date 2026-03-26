"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { enrichAircraftWithMetrics } from "@/lib/math";
import dynamic from "next/dynamic";
import type { AircraftWithMetrics, SystemSettings, AppRole, AircraftStatus, AppTab } from "@/lib/types";
import { 
  PlaneTakeoff, Wrench, AlertTriangle, FileText, Clock, LogOut, 
  Plus, Edit2, ChevronDown, Home, LayoutGrid, Send, ShieldCheck, X, Share, Copy, WifiOff, RefreshCw
} from "lucide-react";

// --- DYNAMIC IMPORTS FOR CODE SPLITTING ---
const AuthScreen = dynamic(() => import("@/components/AuthScreen"));
const PilotOnboarding = dynamic(() => import("@/components/PilotOnboarding"));
const AircraftModal = dynamic(() => import("@/components/modals/AircraftModal"));
const AdminModals = dynamic(() => import("@/components/modals/AdminModals"));
const TutorialModal = dynamic(() => import("@/components/modals/TutorialModal"));

const SummaryTab = dynamic(() => import("@/components/tabs/SummaryTab"));
const TimesTab = dynamic(() => import("@/components/tabs/TimesTab"));
const MaintenanceTab = dynamic(() => import("@/components/tabs/MaintenanceTab"));
const SquawksTab = dynamic(() => import("@/components/tabs/SquawksTab")); 
const NotesTab = dynamic(() => import("@/components/tabs/NotesTab"));
const FleetSummary = dynamic(() => import("@/components/tabs/FleetSummary"));

export default function FleetTrackerApp() {
  // --- STATE MANAGEMENT ---
  const [session, setSession] = useState<any>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isNetworkTimeout, setIsNetworkTimeout] = useState(false);
  const [newDataAvailable, setNewDataAvailable] = useState(false); 
  const dataFetchTriggeredRef = useRef(false); 
  
  const [role, setRole] = useState<AppRole>('pilot');
  const [userInitials, setUserInitials] = useState("");
  const companionUrl = process.env.NEXT_PUBLIC_COMPANION_URL || "https://your-logit-app.vercel.app";

  const [allAircraftList, setAllAircraftList] = useState<AircraftWithMetrics[]>([]);
  const [aircraftList, setAircraftList] = useState<AircraftWithMetrics[]>([]);
  const [activeTail, setActiveTail] = useState<string>("");
  const [activeTab, setActiveTab] = useState<AppTab>('fleet');
  const [aircraftStatus, setAircraftStatus] = useState<AircraftStatus>('airworthy');
  const [unreadNotes, setUnreadNotes] = useState(0);

  const [sysSettings, setSysSettings] = useState<SystemSettings>({
    id: 1,
    reminder_1: 30, reminder_2: 15, reminder_3: 5,
    reminder_hours_1: 30, reminder_hours_2: 15, reminder_hours_3: 5,
    sched_time: 10, sched_days: 30, predictive_sched_days: 45
  });

  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showLogItModal, setShowLogItModal] = useState(false);
  const [showAircraftModal, setShowAircraftModal] = useState(false);
  const [editingAircraftId, setEditingAircraftId] = useState<string | null>(null);

  useEffect(() => { 
    // --- AUTO VERSION TRACKER ---
    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;
    if (appVersion) {
      const localVersion = localStorage.getItem('aft_app_version');
      if (localVersion && localVersion !== appVersion) {
        localStorage.setItem('aft_app_version', appVersion);
        window.location.reload(); 
      } else if (!localVersion) {
        localStorage.setItem('aft_app_version', appVersion);
      }
    }

    // 1. Initial Session Check
    supabase.auth.getSession().then(({ data: { session } }) => { 
      setSession(session); 
      setIsAuthChecking(false);
      if (session && !dataFetchTriggeredRef.current) {
        dataFetchTriggeredRef.current = true;
        fetchAircraftData(session.user.id); 
      }
    }); 
    
    // 2. Auth Listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session); 
      setIsAuthChecking(false);
      
      if (event === 'SIGNED_IN' && session) {
        setActiveTab('fleet');
        if (!dataFetchTriggeredRef.current) {
          dataFetchTriggeredRef.current = true;
          fetchAircraftData(session.user.id);
        }
      } else if (event === 'SIGNED_OUT') {
        dataFetchTriggeredRef.current = false;
        setIsDataLoaded(false);
        setActiveTab('fleet');
      }
    });
    
    return () => subscription.unsubscribe();
  }, []);

  // --- NETWORK GUARD ---
  useEffect(() => {
    let timeoutTimer: NodeJS.Timeout;
    if (isAuthChecking || (session && !isDataLoaded)) {
      timeoutTimer = setTimeout(() => setIsNetworkTimeout(true), 12000);
    }
    return () => {
      clearTimeout(timeoutTimer);
      setIsNetworkTimeout(false);
    };
  }, [isAuthChecking, session, isDataLoaded]);

  // --- SUPABASE REALTIME LISTENER ---
  useEffect(() => {
    if (!session) return;

    const handleRealtimeEvent = (payload: any) => {
      const newRow = payload.new;
      if (newRow) {
        if (newRow.user_id === session.user.id) return;
        if (newRow.reported_by === session.user.id) return;
        if (newRow.author_id === session.user.id) return;
      }
      setNewDataAvailable(true);
    };

    const channel = supabase
      .channel('fleet-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'aft_flight_logs' }, handleRealtimeEvent)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'aft_squawks' }, handleRealtimeEvent)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'aft_squawks' }, handleRealtimeEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aft_maintenance_items' }, handleRealtimeEvent)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'aft_notes' }, handleRealtimeEvent)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  useEffect(() => { 
    if (activeTail) localStorage.setItem('aft_active_tail', activeTail);
  }, [activeTail]);

  useEffect(() => { 
    if (activeTail && allAircraftList.length > 0 && session) { 
      checkGroundedStatus(activeTail); 
      fetchUnreadNotes(activeTail, session.user.id); 
    } 
  }, [activeTail, allAircraftList, session]);

  const fetchAircraftData = async (userId: string) => {
    const { data: settingsData } = await supabase.from('aft_system_settings').select('*').eq('id', 1).single();
    if (settingsData) setSysSettings(settingsData as SystemSettings);

    const { data: roleData } = await supabase.from('aft_user_roles').select('role, initials').eq('user_id', userId).single();
    if (roleData) {
      setRole(roleData.role as AppRole);
      setUserInitials(roleData.initials || "");
    }
    
    const { data: allPlanesData } = await supabase.from('aft_aircraft').select('*').order('tail_number');
    const rawPlanes = allPlanesData || [];

    // --- CALCULATE BURN RATES & CONFIDENCE using shared utility ---
    const oneEightyDaysAgo = new Date();
    oneEightyDaysAgo.setDate(oneEightyDaysAgo.getDate() - 180);
    const { data: recentLogs } = await supabase
      .from('aft_flight_logs')
      .select('aircraft_id, ftt, tach, created_at')
      .gte('created_at', oneEightyDaysAgo.toISOString())
      .order('created_at', { ascending: true }); 

    const allPlanes = enrichAircraftWithMetrics(rawPlanes as any[], recentLogs || []);
    setAllAircraftList(allPlanes);

    const { data: accessData } = await supabase.from('aft_user_aircraft_access').select('aircraft_id').eq('user_id', userId);
    const assignedIds = accessData?.map(a => a.aircraft_id) || [];
    
    const assignedPlanes = allPlanes.filter(a => assignedIds.includes(a.id));
    setAircraftList(assignedPlanes);

    const savedTail = localStorage.getItem('aft_active_tail');
    const isValidSavedTail = savedTail && allPlanes.some(a => a.tail_number === savedTail);
    
    if (isValidSavedTail) setActiveTail(savedTail);
    else if (assignedPlanes.length > 0 && !activeTail) setActiveTail(assignedPlanes[0].tail_number);
    else if (!activeTail) setActiveTail("");
    
    setIsDataLoaded(true);
  };

  const fetchUnreadNotes = async (tail: string, userId: string) => {
    const aircraft = allAircraftList.find(a => a.tail_number === tail);
    if (!aircraft) return;
    const { data: notes } = await supabase.from('aft_notes').select('id').eq('aircraft_id', aircraft.id);
    if (!notes || notes.length === 0) return setUnreadNotes(0); 
    const noteIds = notes.map(n => n.id);
    const { data: reads } = await supabase.from('aft_note_reads').select('note_id').eq('user_id', userId).in('note_id', noteIds);
    setUnreadNotes(noteIds.length - (reads ? reads.length : 0));
  };

  const checkGroundedStatus = async (tail: string) => {
    const aircraft = allAircraftList.find(a => a.tail_number === tail);
    if (!aircraft) return;
    let isGrounded = false; 
    let hasOpenSquawks = false;

    const { data: mxData } = await supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraft.id);
    if (mxData) {
      const currentEngineTime = aircraft.total_engine_time || 0;
      isGrounded = mxData.some(item => {
        if (!item.is_required) return false;
        if (item.tracking_type === 'time') return item.due_time <= currentEngineTime;
        if (item.tracking_type === 'date') return new Date(item.due_date + 'T00:00:00') < new Date(new Date().setHours(0,0,0,0));
        return false;
      });
    }

    if (!isGrounded) {
      const { data: sqData } = await supabase.from('aft_squawks').select('*').eq('aircraft_id', aircraft.id).eq('status', 'open');
      if (sqData && sqData.length > 0) {
        if (sqData.some(sq => sq.affects_airworthiness)) isGrounded = true;
        else hasOpenSquawks = true;
      }
    }
    
    if (isGrounded) setAircraftStatus('grounded');
    else if (hasOpenSquawks) setAircraftStatus('issues');
    else setAircraftStatus('airworthy');
  };

  const handleDeleteAircraft = async (id: string) => {
    await supabase.from('aft_aircraft').delete().eq('id', id);
    await fetchAircraftData(session.user.id);
    setActiveTab('fleet');
  };

  const handleCopyQuickLink = () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(companionUrl).then(() => {
        alert("Link copied! Now open your phone's browser, paste the link, and Add to Home Screen.");
      }).catch(() => {
        alert(`Please manually copy this link: ${companionUrl}`);
      });
    } else {
      alert(`Please manually copy this link: ${companionUrl}`);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const openAircraftForm = (aircraft: AircraftWithMetrics | null = null) => {
    if (aircraft) {
      setEditingAircraftId(aircraft.id);
    } else {
      setEditingAircraftId(null);
    }
    setShowAircraftModal(true);
  };

  const getTabColor = (tabId: string) => {
    if (activeTab !== tabId) return 'text-gray-400 hover:bg-gray-50';
    switch(tabId) { 
      case 'summary': return 'text-navy'; 
      case 'times': return 'text-[#3AB0FF]'; 
      case 'mx': return 'text-[#F08B46]'; 
      case 'squawks': return 'text-[#CE3732]'; 
      case 'notes': return 'text-[#525659]'; 
      default: return 'text-brandOrange'; 
    }
  };

  const getIndicatorColor = (tabId: string) => {
    switch(tabId) { 
      case 'summary': return 'bg-navy'; 
      case 'times': return 'bg-[#3AB0FF]'; 
      case 'mx': return 'bg-[#F08B46]'; 
      case 'squawks': return 'bg-[#CE3732]'; 
      case 'notes': return 'bg-[#525659]'; 
      default: return 'bg-brandOrange'; 
    }
  };

  if (isAuthChecking || (session && !isDataLoaded)) {
    if (isNetworkTimeout) {
      return (
        <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full text-white text-center selection:bg-none">
          <WifiOff size={64} className="mb-6 text-brandOrange animate-pulse" />
          <h2 className="font-oswald text-3xl tracking-widest uppercase mb-4">Connection Timeout</h2>
          <p className="text-sm font-roboto text-gray-300 mb-8 max-w-xs leading-relaxed">
            We are having trouble connecting to the database. You may be experiencing spotty cell or WiFi coverage.
          </p>
          <button 
            onClick={() => window.location.reload()} 
            className="w-full max-w-xs bg-brandOrange text-white font-oswald text-xl tracking-widest uppercase py-4 rounded-xl shadow-lg active:scale-95 transition-transform"
          >
            Refresh App
          </button>
        </div>
      );
    }
    return <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full text-white font-oswald text-2xl tracking-widest uppercase animate-pulse">Loading...</div>;
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (role === 'pilot' && aircraftList.length === 0) {
    return <PilotOnboarding session={session} handleLogout={handleLogout} onSuccess={() => fetchAircraftData(session.user.id)} />;
  }

  const dropdownOptions = [...aircraftList];
  if (activeTail && !dropdownOptions.some(a => a.tail_number === activeTail)) {
    const outOfScopePlane = allAircraftList.find(a => a.tail_number === activeTail);
    if (outOfScopePlane) dropdownOptions.push(outOfScopePlane);
  }

  const selectedAircraftData = allAircraftList.find(a => a.tail_number === activeTail) || null;

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `html, body { background-color: #ffffff !important; }` }} />
      <div className="flex flex-col bg-neutral-100 w-full overflow-hidden relative" style={{ height: 'calc(100vh + env(safe-area-inset-top, 0px))' }}>

      <TutorialModal session={session} role={role} />

      {newDataAvailable && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
          <button 
            onClick={() => window.location.reload()} 
            className="bg-[#F08B46] text-white font-oswald text-sm font-bold tracking-widest uppercase px-6 py-3 rounded-full shadow-[0_10px_20px_rgba(0,0,0,0.4)] flex items-center gap-2 active:scale-95 transition-transform border-2 border-white"
          >
            <RefreshCw size={16} /> New Data Available
          </button>
        </div>
      )}
      
      <AdminModals 
        showAdminMenu={showAdminMenu} 
        setShowAdminMenu={setShowAdminMenu} 
        allAircraftList={allAircraftList} 
        setActiveTail={setActiveTail} 
        setActiveTab={setActiveTab} 
        sysSettings={sysSettings} 
        setSysSettings={setSysSettings} 
        refreshData={() => fetchAircraftData(session.user.id)}
      />

      {showAircraftModal && (
        <AircraftModal 
          session={session} 
          existingAircraft={editingAircraftId ? allAircraftList.find(a => a.id === editingAircraftId) || null : null} 
          onClose={() => setShowAircraftModal(false)} 
          onSuccess={(newTail: string) => {
            setShowAircraftModal(false);
            fetchAircraftData(session.user.id);
            setActiveTail(newTail);
          }} 
        />
      )}

      {showLogItModal && (
        <div className="fixed inset-0 bg-black/80 z-[80] flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowLogItModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 border-t-8 border-[#3AB0FF] animate-slide-up relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowLogItModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500">
              <X size={24}/>
            </button>
            <h3 className="font-oswald text-2xl font-bold uppercase tracking-widest text-navy mb-4">Install Log It</h3>
            <p className="text-sm text-gray-600 font-roboto mb-4 leading-relaxed">
              Log It is a companion app that is designed to make logging times and squawks easy on the go. To install it on your device, follow these steps:
            </p>
            <ol className="text-left text-sm text-gray-600 font-roboto mb-8 space-y-2 max-w-xs mx-auto list-decimal pl-4">
              <li>Tap below to copy the app link.</li>
              <li>Open your phone&apos;s browser and paste the link.</li>
              <li>Use the Share menu <Share size={14} className="inline text-blue-500 mb-1"/> to Add to Home Screen.</li>
            </ol>
            <button onClick={handleCopyQuickLink} className="w-full bg-[#3AB0FF] text-white font-oswald text-xl font-bold uppercase tracking-widest py-4 rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2">
              <Copy size={20} /> Copy App Link
            </button>
          </div>
        </div>
      )}

      <header className="bg-navy text-white shadow-md z-20 shrink-0 w-full" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-3xl mx-auto px-4 py-2 flex justify-between items-center w-full min-h-[52px]">
          
          <div className="flex flex-col">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#F5B05B] mb-[2px]">
              Active Aircraft
            </span>
            <div className="flex items-center gap-3">
              <div className={`w-3.5 h-3.5 rounded-full shrink-0 shadow-inner ${aircraftStatus === 'grounded' ? 'bg-red-500 animate-pulse' : aircraftStatus === 'issues' ? 'bg-[#F08B46]' : 'bg-success'}`} />
              
              <div className="relative flex items-center">
                <select className="appearance-none bg-transparent text-xl font-oswald font-bold uppercase tracking-wide focus:outline-none cursor-pointer w-[120px] shrink-0 text-white pr-6 truncate" value={activeTail} onChange={(e) => setActiveTail(e.target.value)}>
                  {dropdownOptions.map(a => <option key={a.id} value={a.tail_number} className="text-white">{a.tail_number}</option>)}
                </select>
                <ChevronDown size={18} className="absolute right-1 text-white pointer-events-none opacity-80" />
              </div>
              
              <div className="flex gap-1 ml-1 shrink-0">
                {role === 'admin' && (
                  <button onClick={() => openAircraftForm()} className="bg-[#F08B46] text-white rounded-full p-1.5 hover:bg-[#E45D3E] transition-colors active:scale-95"><Plus size={14} /></button>
                )}
                {activeTail && (role === 'admin' || selectedAircraftData?.created_by === session?.user?.id) && (
                  <button onClick={() => openAircraftForm(selectedAircraftData)} className="bg-slateGray text-white rounded-full p-1.5 hover:bg-gray-500 transition-colors active:scale-95"><Edit2 size={14} /></button>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex gap-4">
            <button onClick={() => setActiveTab('fleet')} className={`hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0 ${activeTab === 'fleet' ? 'text-[#3AB0FF]' : 'text-gray-300'}`}>
              <LayoutGrid size={18} />
              <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Fleet</span>
            </button>
            <button onClick={() => setShowLogItModal(true)} className="text-gray-300 hover:text-[#3AB0FF] transition-colors flex flex-col items-center active:scale-95 shrink-0">
              <Send size={18} />
              <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Log It</span>
            </button>
            {role === 'admin' && (
              <button onClick={() => setShowAdminMenu(true)} className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0">
                <ShieldCheck size={18} />
                <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Admin</span>
              </button>
            )}
            <button onClick={handleLogout} className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0">
              <LogOut size={18} />
              <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Logout</span>
            </button>
          </div>

        </div>
      </header>

      {aircraftStatus === 'grounded' && (
        <div className="bg-[#CE3732] text-white text-center py-2 px-4 shadow-md z-10 flex justify-center items-center gap-2 animate-pulse shrink-0 w-full">
          <AlertTriangle size={18} />
          <span className="font-oswald tracking-widest font-bold uppercase text-sm md:text-base">This aircraft is not flight ready</span>
          <AlertTriangle size={18} />
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-4 flex justify-center w-full" style={{ touchAction: 'auto' }}>
        <div className="w-full max-w-3xl flex flex-col gap-6">
          {activeTab === 'fleet' && <FleetSummary aircraftList={aircraftList} onSelectAircraft={(tail: string) => { setActiveTail(tail); setActiveTab('summary'); }} />}
          {activeTab === 'summary' && <SummaryTab aircraft={selectedAircraftData} setActiveTab={(tab: AppTab) => setActiveTab(tab)} role={role} onDeleteAircraft={handleDeleteAircraft} sysSettings={sysSettings} />}
          {activeTab === 'times' && <TimesTab aircraft={selectedAircraftData} session={session} role={role} userInitials={userInitials} onUpdate={() => fetchAircraftData(session.user.id)} />}
          {activeTab === 'mx' && <MaintenanceTab aircraft={selectedAircraftData} role={role} onGroundedStatusChange={() => checkGroundedStatus(activeTail)} sysSettings={sysSettings} />}
          {activeTab === 'squawks' && <SquawksTab aircraft={selectedAircraftData} session={session} role={role} userInitials={userInitials} onGroundedStatusChange={() => checkGroundedStatus(activeTail)} />}
          {activeTab === 'notes' && <NotesTab aircraft={selectedAircraftData} session={session} role={role} userInitials={userInitials} onNotesRead={() => setUnreadNotes(0)} />}
        </div>
      </main>

      <nav className="bg-white border-t border-gray-200 w-full z-20 shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <div className="max-w-3xl mx-auto flex justify-around">
          {[
            { id: 'summary', icon: Home, label: 'Home', badge: 0 },
            { id: 'times', icon: Clock, label: 'Times', badge: 0 },
            { id: 'mx', icon: Wrench, label: 'Mx Due', badge: 0 },
            { id: 'squawks', icon: AlertTriangle, label: 'Squawks', badge: 0 },
            { id: 'notes', icon: FileText, label: 'Notes', badge: unreadNotes }
          ].map((tab) => (
            <button 
              key={tab.id} 
              onClick={() => setActiveTab(tab.id as AppTab)} 
              className={`flex-1 py-2 flex flex-col items-center justify-center transition-all relative active:scale-95 ${getTabColor(tab.id)}`}
            >
              <div className="relative mb-1">
                <tab.icon size={20} />
                {tab.badge > 0 && (
                  <span className="absolute -top-1 -right-2 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#CE3732] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-[#CE3732] text-[8px] text-white font-bold items-center justify-center border border-white"></span>
                  </span>
                )}
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest">{tab.label}</span>
              {activeTab === tab.id && <div className={`absolute top-0 w-12 h-1 rounded-b-full ${getIndicatorColor(tab.id)}`}></div>}
            </button>
          ))}
        </div>
      </nav>

    </div>
    </>
  );
}

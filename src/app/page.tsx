"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Eye, Edit2, Plus, PlaneTakeoff, Wrench, AlertTriangle, FileText, Clock, LogOut } from "lucide-react";
import TicketField from "@/components/TicketField";
import { PrimaryButton, AddButton } from "@/components/AppButtons";

export default function FleetTrackerApp() {
  // --- AUTH & USER STATE ---
  const[session, setSession] = useState<any>(null);
  const [role, setRole] = useState<'admin' | 'pilot'>('pilot');
  const [authEmail, setAuthEmail] = useState("");
  const[authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");

  // --- APP STATE ---
  const [aircraftList, setAircraftList] = useState<any[]>([]);
  const [activeTail, setActiveTail] = useState<string>("");
  const [activeTab, setActiveTab] = useState<'times' | 'mx' | 'squawks' | 'notes'>('times');
  const[activeView, setActiveView] = useState<'form' | 'dashboard'>('dashboard');

  // 1. Check for logged in user on load
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchUserData(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchUserData(session.user.id);
    });
    return () => subscription.unsubscribe();
  },[]);

  // 2. Fetch Role & Aircraft once logged in
  const fetchUserData = async (userId: string) => {
    // Get Role
    const { data: roleData } = await supabase.from('aft_user_roles').select('role').eq('user_id', userId).single();
    if (roleData) setRole(roleData.role);

    // Get Aircraft
    const { data: aircraftData } = await supabase.from('aft_aircraft').select('*').order('tail_number');
    if (aircraftData && aircraftData.length > 0) {
      setAircraftList(aircraftData);
      setActiveTail(aircraftData[0].tail_number); // Auto-select first plane
    }
  };

  // 3. Login / Logout Handlers
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    if (error) setAuthError(error.message);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  // ==========================================
  // VIEW: LOGIN SCREEN
  // ==========================================
  if (!session) {
    return (
      <div className="min-h-screen bg-slateGray flex items-center justify-center p-4">
        <div className="bg-cream shadow-2xl rounded-sm p-8 w-full max-w-md border-t-4 border-brandOrange">
          <div className="text-center mb-8">
            <PlaneTakeoff size={48} className="text-navy mx-auto mb-4" />
            <h1 className="font-oswald text-3xl font-bold uppercase tracking-widest text-navy">Skyward Society</h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-brandOrange mt-2">Fleet Tracker Portal</p>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-4">
            {authError && <div className="bg-red-50 text-red-700 p-3 text-xs font-bold uppercase tracking-widest border border-red-200 rounded">{authError}</div>}
            
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email Address</label>
              <input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-400 focus:outline-none bg-white font-roboto" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Password</label>
              <input type="password" required value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-400 focus:outline-none bg-white font-roboto" />
            </div>
            <div className="pt-4">
              <PrimaryButton>Access Portal</PrimaryButton>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW: AUTHENTICATED DASHBOARD
  // ==========================================
  const selectedAircraftData = aircraftList.find(a => a.tail_number === activeTail);

  // --- EDITOR PANE (LEFT SIDE) ---
  const FormPane = (
    <div className="h-full bg-white overflow-y-auto border-r border-gray-200 flex flex-col">
      {/* Sidebar Header */}
      <div className="p-6 border-b border-gray-100 bg-gray-50">
        <div className="flex justify-between items-start mb-6">
          <h1 className="font-oswald text-xl font-bold uppercase tracking-wide text-navy flex items-center gap-2">
            <PlaneTakeoff className="text-brandOrange" size={20} /> Fleet Tracker
          </h1>
          <button onClick={handleLogout} className="text-gray-400 hover:text-navy transition-colors">
            <LogOut size={18} />
          </button>
        </div>

        <p className="text-[10px] font-bold uppercase tracking-widest text-brandOrange">Select Aircraft</p>
        <select 
          className="mt-1 w-full border border-gray-300 rounded p-2 text-sm focus:border-blue-400 focus:outline-none bg-white font-roboto text-navy font-bold"
          value={activeTail}
          onChange={(e) => setActiveTail(e.target.value)}
        >
          {aircraftList.map(a => (
            <option key={a.id} value={a.tail_number}>{a.tail_number} ({a.aircraft_type})</option>
          ))}
        </select>
      </div>

      {/* Navigation Menu */}
      <div className="flex border-b border-gray-200 bg-white">
        {[
          { id: 'times', icon: Clock, label: 'Times' },
          { id: 'mx', icon: Wrench, label: 'Mx Due' },
          { id: 'squawks', icon: AlertTriangle, label: 'Squawks' },
          { id: 'notes', icon: FileText, label: 'Notes' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex-1 py-3 flex flex-col items-center justify-center border-b-2 transition-all ${activeTab === tab.id ? 'border-brandOrange text-brandOrange bg-orange-50/30' : 'border-transparent text-gray-400 hover:bg-gray-50'}`}
          >
            <tab.icon size={16} className="mb-1" />
            <span className="text-[9px] font-bold uppercase tracking-widest">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Dynamic Input Forms based on Active Tab */}
      <div className="p-6 flex-1">
        {activeTab === 'times' && (
          <div className="space-y-4">
            <h3 className="font-oswald font-bold uppercase text-sm mb-3 text-navy">Log New Flight Times</h3>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">New Total Airframe</label>
              <input type="number" step="0.1" className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-blue-400" placeholder={selectedAircraftData?.total_airframe_time} />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">New Total Engine</label>
              <input type="number" step="0.1" className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-blue-400" placeholder={selectedAircraftData?.total_engine_time} />
            </div>
            <PrimaryButton>Save Updated Times</PrimaryButton>
          </div>
        )}

        {activeTab === 'mx' && (
          <div>
            <h3 className="font-oswald font-bold uppercase text-sm mb-3 text-navy">Manage Maintenance</h3>
            {role === 'admin' ? (
              <p className="text-xs text-gray-500 mb-4">Admins can add new maintenance items here.</p>
            ) : (
              <div className="bg-red-50 text-red-700 p-3 text-[10px] font-bold uppercase tracking-widest rounded border border-red-200">
                Restricted: Only Admins can edit MX items.
              </div>
            )}
          </div>
        )}

        {activeTab === 'squawks' && (
          <div>
            <h3 className="font-oswald font-bold uppercase text-sm mb-2 text-navy">Report Squawk</h3>
            <textarea className="w-full border border-gray-300 rounded p-2 text-sm mb-2 focus:border-blue-400 min-h-[100px]" placeholder="Describe the issue..." />
            <AddButton><Plus size={16}/> Submit Squawk</AddButton>
          </div>
        )}

        {activeTab === 'notes' && (
          <div>
            <h3 className="font-oswald font-bold uppercase text-sm mb-2 text-navy">Add Flight Note</h3>
            <textarea className="w-full border border-gray-300 rounded p-2 text-sm mb-2 focus:border-blue-400 min-h-[100px]" placeholder="Share info with the next pilot..." />
            <AddButton><Plus size={16}/> Post Note</AddButton>
          </div>
        )}
      </div>
    </div>
  );

  // --- DASHBOARD PANE (RIGHT SIDE) ---
  const DashboardPane = (
    <div className="h-full w-full flex justify-center items-start p-4 md:p-10 overflow-y-auto">
      <div className="bg-cream w-full max-w-2xl shadow-2xl p-6 md:p-10 rounded-sm relative">
        
        {/* Document Header */}
        <div className="border-b-2 border-navy pb-4 mb-8 flex justify-between items-end">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-brandOrange mb-[2px] block">
              {activeTab.toUpperCase()} LOG
            </span>
            <h2 className="font-oswald text-5xl font-bold uppercase text-navy m-0 leading-none">
              {activeTail || "LOADING..."}
            </h2>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">User Role</span>
            <span className="bg-navy text-white text-[10px] font-bold px-2 py-1 rounded uppercase tracking-widest">
              {role}
            </span>
          </div>
        </div>

        {/* Dynamic Document Body based on Active Tab */}
        {activeTab === 'times' && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            <TicketField label="Aircraft Type" value={selectedAircraftData?.aircraft_type || "---"} />
            <TicketField label="Total Airframe" value={`${selectedAircraftData?.total_airframe_time || 0} hrs`} emphasis />
            <TicketField label="Total Engine" value={`${selectedAircraftData?.total_engine_time || 0} hrs`} emphasis />
          </div>
        )}

        {activeTab === 'mx' && (
          <div className="border border-gray-200 bg-white rounded p-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-navy mb-4 flex items-center gap-2">
              <Wrench size={14} className="text-brandOrange"/> Maintenance Due
            </h4>
            <p className="text-sm text-gray-500 italic">Database fetch logic coming next...</p>
          </div>
        )}

        {activeTab === 'squawks' && (
          <div className="border border-red-200 bg-[#fef2f2] rounded p-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-red-700 mb-4 flex items-center gap-2">
              <AlertTriangle size={14} /> Active Squawks
            </h4>
            <p className="text-sm text-gray-500 italic">Database fetch logic coming next...</p>
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="border border-blue-200 bg-blue-50 rounded p-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-blue-700 mb-4 flex items-center gap-2">
              <FileText size={14} /> Flight Notes
            </h4>
            <p className="text-sm text-gray-500 italic">Database fetch logic coming next...</p>
          </div>
        )}

      </div>
    </div>
  );

  return (
    <div className="relative h-screen bg-neutral-100 flex flex-col md:flex-row overflow-hidden">
      {/* Desktop Split / Mobile View Switching */}
      <div className={`w-full md:w-[450px] h-full shadow-lg z-10 ${activeView === 'form' ? 'block' : 'hidden md:block'}`}>
        {FormPane}
      </div>
      
      <div className={`flex-1 bg-slateGray h-full ${activeView === 'dashboard' ? 'block' : 'hidden md:block'}`}>
        {DashboardPane}
      </div>

      {/* Floating Action Button (Mobile Only Context Switcher) */}
      <button 
        onClick={() => setActiveView(activeView === 'dashboard' ? 'form' : 'dashboard')}
        className="md:hidden fixed bottom-6 right-6 bg-brandOrange text-white px-6 py-4 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.4)] flex items-center gap-2 font-oswald tracking-widest z-50 text-xs uppercase transition-transform hover:scale-105"
      >
        {activeView === 'dashboard' ? <><Edit2 size={16}/> Input Data</> : <><Eye size={16}/> View Document</>}
      </button>
    </div>
  );
}
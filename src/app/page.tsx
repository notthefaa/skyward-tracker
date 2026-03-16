"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { PlaneTakeoff, Wrench, AlertTriangle, FileText, Clock, LogOut, Plus, X } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";

import TimesTab from "@/components/tabs/TimesTab";
import MaintenanceTab from "@/components/tabs/MaintenanceTab";
import SquawksTab from "@/components/tabs/SquawksTab"; // We will build this next!

export default function FleetTrackerApp() {
  const [session, setSession] = useState<any>(null);
  const[role, setRole] = useState<'admin' | 'pilot'>('pilot');
  const[authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");

  const[aircraftList, setAircraftList] = useState<any[]>([]);
  const [activeTail, setActiveTail] = useState<string>("");
  const [activeTab, setActiveTab] = useState<'times' | 'mx' | 'squawks' | 'notes'>('times');
  const [isGrounded, setIsGrounded] = useState(false);

  // --- ADMIN ADD AIRCRAFT STATE ---
  const[showAddAircraft, setShowAddAircraft] = useState(false);
  const [newTail, setNewTail] = useState("");
  const [newSerial, setNewSerial] = useState(""); // <-- NEW
  const [newModel, setNewModel] = useState("");
  const [newType, setNewType] = useState<'Piston' | 'Turbine'>('Piston');
  const [newAirframeTime, setNewAirframeTime] = useState("");
  const[newEngineTime, setNewEngineTime] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchAircraftData(session.user.id);
    });
  },[]);

  useEffect(() => {
    if (activeTail && aircraftList.length > 0) checkGroundedStatus(activeTail);
  }, [activeTail, aircraftList]);

  const fetchAircraftData = async (userId: string) => {
    const { data: roleData } = await supabase.from('aft_user_roles').select('role').eq('user_id', userId).single();
    if (roleData) setRole(roleData.role);

    const { data: aircraftData } = await supabase.from('aft_aircraft').select('*').order('tail_number');
    if (aircraftData && aircraftData.length > 0) {
      setAircraftList(aircraftData);
      if (!activeTail) setActiveTail(aircraftData[0].tail_number);
    }
  };

  const checkGroundedStatus = async (tail: string) => {
    const aircraft = aircraftList.find(a => a.tail_number === tail);
    if (!aircraft) return;
    
    // Check Maintenance
    let mxGrounded = false;
    const { data: mxData } = await supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraft.id);
    if (mxData) {
      const currentEngineTime = aircraft.total_engine_time || 0;
      mxGrounded = mxData.some(item => {
        if (!item.is_required) return false;
        if (item.tracking_type === 'time') return item.due_time <= currentEngineTime;
        if (item.tracking_type === 'date') return new Date(item.due_date + 'T00:00:00') < new Date(new Date().setHours(0,0,0,0));
        return false;
      });
    }

    // Check Airworthiness Squawks
    let sqGrounded = false;
    const { data: sqData } = await supabase.from('aft_squawks').select('*').eq('aircraft_id', aircraft.id).eq('status', 'open');
    if (sqData) {
      sqGrounded = sqData.some(sq => sq.affects_airworthiness);
    }

    setIsGrounded(mxGrounded || sqGrounded);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  const handleAddAircraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await supabase.from('aft_aircraft').insert({ 
      tail_number: newTail.toUpperCase(), 
      serial_number: newSerial, // <-- NEW
      aircraft_type: newModel, 
      engine_type: newType, 
      total_airframe_time: parseFloat(newAirframeTime) || 0, 
      total_engine_time: parseFloat(newEngineTime) || 0 
    });
    await fetchAircraftData(session.user.id);
    setActiveTail(newTail.toUpperCase());
    setShowAddAircraft(false); setIsSubmitting(false); 
    setNewTail(""); setNewSerial(""); setNewModel(""); setNewAirframeTime(""); setNewEngineTime("");
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-slateGray flex items-center justify-center p-4">
        <div className="bg-cream shadow-2xl rounded-sm p-8 w-full max-w-md border-t-4 border-brandOrange animate-slide-up">
          <div className="text-center mb-8"><PlaneTakeoff size={48} className="text-navy mx-auto mb-4" /><h1 className="font-oswald text-3xl font-bold uppercase tracking-widest text-navy">Skyward Society</h1></div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email</label><input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-400 bg-white" /></div>
            <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Password</label><input type="password" required value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-400 bg-white" /></div>
            <div className="pt-4"><PrimaryButton>Access Portal</PrimaryButton></div>
          </form>
        </div>
      </div>
    );
  }

  const selectedAircraftData = aircraftList.find(a => a.tail_number === activeTail);

  return (
    <div className="h-screen flex flex-col bg-neutral-100 relative">
      
      {/* ADD AIRCRAFT MODAL */}
      {showAddAircraft && role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-brandOrange max-h-[90vh] overflow-y-auto animate-slide-up">
            <div className="flex justify-between items-center mb-6"><h2 className="font-oswald text-2xl font-bold uppercase text-navy">Add Aircraft</h2><button onClick={() => setShowAddAircraft(false)} className="text-gray-400 hover:text-red-500"><X size={24}/></button></div>
            <form onSubmit={handleAddAircraft} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Tail Number</label><input type="text" required value={newTail} onChange={e=>setNewTail(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 uppercase" placeholder="N12345" /></div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Serial Num</label><input type="text" value={newSerial} onChange={e=>setNewSerial(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 uppercase" placeholder="172-1234" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Model Name</label><input type="text" required value={newModel} onChange={e=>setNewModel(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" placeholder="Cessna 172" /></div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Engine Type</label><select value={newType} onChange={e=>setNewType(e.target.value as 'Piston'|'Turbine')} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 bg-white"><option value="Piston">Piston</option><option value="Turbine">Turbine</option></select></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Current {newType === 'Turbine' ? 'AFTT' : 'Hobbs'}</label><input type="number" step="0.1" required value={newAirframeTime} onChange={e=>setNewAirframeTime(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" /></div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Current {newType === 'Turbine' ? 'FTT' : 'Tach'}</label><input type="number" step="0.1" required value={newEngineTime} onChange={e=>setNewEngineTime(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" /></div>
              </div>
              <div className="pt-4"><PrimaryButton>{isSubmitting ? "Saving..." : "Save Aircraft"}</PrimaryButton></div>
            </form>
          </div>
        </div>
      )}

      {/* TOP HEADER */}
      <header className="bg-navy text-white shadow-md z-10 sticky top-0">
        <div className="max-w-3xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex flex-col">
            <span className="text-[9px] font-bold uppercase tracking-widest text-brandOrange mb-[2px]">Active Aircraft</span>
            <div className="flex items-center gap-3">
              <div className={`w-3.5 h-3.5 rounded-full shadow-inner ${isGrounded ? 'bg-red-500 animate-pulse' : 'bg-success'}`} title={isGrounded ? 'Grounded' : 'Airworthy'} />
              <select className="bg-transparent text-xl font-oswald font-bold uppercase tracking-wide focus:outline-none cursor-pointer" value={activeTail} onChange={(e) => setActiveTail(e.target.value)}>
                {aircraftList.map(a => (<option key={a.id} value={a.tail_number} className="text-navy">{a.tail_number}</option>))}
              </select>
              {role === 'admin' && (<button onClick={() => setShowAddAircraft(true)} className="ml-2 bg-brandOrange text-white rounded-full p-1 hover:bg-brandOrange-alt transition-colors active:scale-95"><Plus size={14} /></button>)}
            </div>
          </div>
          <button onClick={handleLogout} className="text-gray-400 hover:text-white transition-colors flex flex-col items-center active:scale-95"><LogOut size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Logout</span></button>
        </div>
      </header>

      {/* GLOBAL GROUNDED BANNER */}
      {isGrounded && (
        <div className="bg-red-600 text-white text-center py-2 px-4 shadow-md z-10 flex justify-center items-center gap-2 animate-pulse">
          <AlertTriangle size={18} />
          <span className="font-oswald tracking-widest font-bold uppercase text-sm md:text-base">This aircraft is not flight ready</span>
          <AlertTriangle size={18} />
        </div>
      )}

      {/* MAIN CONTENT ROUTER */}
      <main className="flex-1 overflow-y-auto p-4 pb-24 flex justify-center">
        <div className="w-full max-w-3xl flex flex-col gap-6">
          {activeTab === 'times' && <TimesTab aircraft={selectedAircraftData} session={session} onUpdate={() => fetchAircraftData(session.user.id)} />}
          {activeTab === 'mx' && <MaintenanceTab aircraft={selectedAircraftData} role={role} onGroundedStatusChange={setIsGrounded} />}
          {activeTab === 'squawks' && <SquawksTab aircraft={selectedAircraftData} session={session} onGroundedStatusChange={() => checkGroundedStatus(activeTail)} />}
          {activeTab === 'notes' && (
            <div className="bg-cream shadow-lg rounded-sm p-6 border-t-4 border-gray-400 animate-slide-up">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy m-0 mb-4">Notes section</h2>
              <p className="text-sm text-gray-500 italic">We will build this next!</p>
            </div>
          )}
        </div>
      </main>

      {/* BOTTOM NAVIGATION BAR */}
      <nav className="bg-white border-t border-gray-200 fixed bottom-0 w-full z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] pb-safe">
        <div className="max-w-3xl mx-auto flex justify-around">
          {[
            { id: 'times', icon: Clock, label: 'Times' },
            { id: 'mx', icon: Wrench, label: 'Mx Due' },
            { id: 'squawks', icon: AlertTriangle, label: 'Squawks' },
            { id: 'notes', icon: FileText, label: 'Notes' }
          ].map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex-1 py-3 md:py-4 flex flex-col items-center justify-center transition-all relative active:scale-95 ${activeTab === tab.id ? 'text-brandOrange' : 'text-gray-400 hover:text-navy hover:bg-gray-50'}`}>
              <tab.icon size={20} className="mb-1" />
              <span className={`text-[10px] font-bold uppercase tracking-widest ${activeTab === tab.id ? 'text-brandOrange' : 'text-navy'}`}>{tab.label}</span>
              {activeTab === tab.id && <div className="absolute top-0 w-12 h-1 bg-brandOrange rounded-b-full"></div>}
            </button>
          ))}
        </div>
      </nav>

    </div>
  );
}
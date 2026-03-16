"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { PlaneTakeoff, Wrench, AlertTriangle, FileText, Clock, LogOut } from "lucide-react";
import TicketField from "@/components/TicketField";
import { PrimaryButton, AddButton } from "@/components/AppButtons";

export default function FleetTrackerApp() {
  // --- AUTH & USER STATE ---
  const [session, setSession] = useState<any>(null);
  const [role, setRole] = useState<'admin' | 'pilot'>('pilot');
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");

  // --- APP STATE ---
  const [aircraftList, setAircraftList] = useState<any[]>([]);
  const[activeTail, setActiveTail] = useState<string>("");
  const [activeTab, setActiveTab] = useState<'times' | 'mx' | 'squawks' | 'notes'>('times');

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

  const fetchUserData = async (userId: string) => {
    const { data: roleData } = await supabase.from('aft_user_roles').select('role').eq('user_id', userId).single();
    if (roleData) setRole(roleData.role);

    const { data: aircraftData } = await supabase.from('aft_aircraft').select('*').order('tail_number');
    if (aircraftData && aircraftData.length > 0) {
      setAircraftList(aircraftData);
      setActiveTail(aircraftData[0].tail_number);
    }
  };

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
  // VIEW: MOBILE-FIRST APP LAYOUT
  // ==========================================
  const selectedAircraftData = aircraftList.find(a => a.tail_number === activeTail);

  return (
    <div className="h-screen flex flex-col bg-neutral-100">
      
      {/* TOP HEADER */}
      <header className="bg-navy text-white shadow-md z-10 sticky top-0">
        <div className="max-w-2xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex flex-col">
            <span className="text-[9px] font-bold uppercase tracking-widest text-brandOrange mb-[2px]">Active Aircraft</span>
            <div className="flex items-center gap-2">
              <PlaneTakeoff size={18} className="text-brandOrange" />
              <select 
                className="bg-transparent text-xl font-oswald font-bold uppercase tracking-wide focus:outline-none cursor-pointer"
                value={activeTail}
                onChange={(e) => setActiveTail(e.target.value)}
              >
                {aircraftList.map(a => (
                  <option key={a.id} value={a.tail_number} className="text-navy">{a.tail_number}</option>
                ))}
              </select>
            </div>
          </div>
          <button onClick={handleLogout} className="text-gray-400 hover:text-white transition-colors flex flex-col items-center">
            <LogOut size={18} />
            <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Logout</span>
          </button>
        </div>
      </header>

      {/* MAIN SCROLLABLE CONTENT AREA */}
      <main className="flex-1 overflow-y-auto p-4 pb-24 flex justify-center">
        <div className="w-full max-w-2xl flex flex-col gap-6">
          
          {/* DYNAMIC TAB HEADER */}
          <div className="flex justify-between items-end border-b-2 border-gray-300 pb-2">
            <h2 className="font-oswald text-2xl font-bold uppercase text-navy m-0">
              {activeTab === 'times' && "Flight Times"}
              {activeTab === 'mx' && "Maintenance Status"}
              {activeTab === 'squawks' && "Active Squawks"}
              {activeTab === 'notes' && "Flight Notes"}
            </h2>
            <span className="bg-gray-200 text-navy text-[9px] font-bold px-2 py-1 rounded uppercase tracking-widest">
              Role: {role}
            </span>
          </div>

          {/* TAB 1: TIMES */}
          {activeTab === 'times' && (
            <>
              {/* Data View (Premium Paper Card) */}
              <div className="bg-cream shadow-lg rounded-sm p-6 border-t-4 border-brandOrange">
                <div className="grid grid-cols-2 gap-6">
                  <TicketField label="Aircraft Type" value={selectedAircraftData?.aircraft_type || "---"} />
                  <div className="col-span-2 grid grid-cols-2 gap-6">
                    <TicketField label="Total Airframe" value={`${selectedAircraftData?.total_airframe_time || 0} hrs`} emphasis />
                    <TicketField label="Total Engine" value={`${selectedAircraftData?.total_engine_time || 0} hrs`} emphasis />
                  </div>
                </div>
              </div>

              {/* Action Form */}
              <div className="bg-white border border-gray-200 shadow-sm rounded p-5">
                <h3 className="font-oswald font-bold uppercase text-sm mb-4 text-navy">Log New Times</h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">New Airframe</label>
                    <input type="number" step="0.1" className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-400" placeholder={selectedAircraftData?.total_airframe_time} />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">New Engine</label>
                    <input type="number" step="0.1" className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-400" placeholder={selectedAircraftData?.total_engine_time} />
                  </div>
                </div>
                <PrimaryButton>Save Updated Times</PrimaryButton>
              </div>
            </>
          )}

          {/* TAB 2: MAINTENANCE */}
          {activeTab === 'mx' && (
            <>
              {/* Data View */}
              <div className="bg-cream shadow-lg rounded-sm p-6 border-t-4 border-brandOrange">
                <p className="text-sm font-roboto text-gray-500 italic text-center py-4">Database fetch logic coming next...</p>
              </div>

              {/* Action Form */}
              {role === 'admin' ? (
                <div className="bg-white border border-gray-200 shadow-sm rounded p-5">
                  <h3 className="font-oswald font-bold uppercase text-sm mb-4 text-navy">Add Maintenance Item</h3>
                  <div className="space-y-4 mb-4">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Item Name</label>
                      <input type="text" className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-400" placeholder="e.g., Annual Inspection" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Due Date</label>
                        <input type="date" className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-400" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Due Time (Hrs)</label>
                        <input type="number" step="0.1" className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-400" placeholder="e.g., 4300.5" />
                      </div>
                    </div>
                  </div>
                  <PrimaryButton>Add MX Item</PrimaryButton>
                </div>
              ) : (
                <div className="bg-red-50 text-red-700 p-4 text-xs font-bold uppercase tracking-widest rounded border border-red-200 text-center">
                  Restricted: Only Admins can add or edit MX items.
                </div>
              )}
            </>
          )}

          {/* TAB 3: SQUAWKS */}
          {activeTab === 'squawks' && (
            <>
              <div className="bg-[#fef2f2] shadow-lg rounded-sm p-6 border-t-4 border-red-600">
                <p className="text-sm font-roboto text-gray-500 italic text-center py-4">Database fetch logic coming next...</p>
              </div>
              <div className="bg-white border border-gray-200 shadow-sm rounded p-5">
                <h3 className="font-oswald font-bold uppercase text-sm mb-4 text-navy">Report a Squawk</h3>
                <textarea className="w-full border border-gray-300 rounded p-3 text-sm mb-4 focus:border-blue-400 min-h-[100px]" placeholder="Describe the issue clearly..." />
                <PrimaryButton>Submit Squawk</PrimaryButton>
              </div>
            </>
          )}

          {/* TAB 4: NOTES */}
          {activeTab === 'notes' && (
            <>
              <div className="bg-blue-50 shadow-lg rounded-sm p-6 border-t-4 border-blue-500">
                <p className="text-sm font-roboto text-gray-500 italic text-center py-4">Database fetch logic coming next...</p>
              </div>
              <div className="bg-white border border-gray-200 shadow-sm rounded p-5">
                <h3 className="font-oswald font-bold uppercase text-sm mb-4 text-navy">Add Flight Note</h3>
                <textarea className="w-full border border-gray-300 rounded p-3 text-sm mb-4 focus:border-blue-400 min-h-[100px]" placeholder="Share info with the next pilot..." />
                <PrimaryButton>Post Note</PrimaryButton>
              </div>
            </>
          )}
        </div>
      </main>

      {/* BOTTOM NAVIGATION BAR */}
      <nav className="bg-white border-t border-gray-200 fixed bottom-0 w-full z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <div className="max-w-2xl mx-auto flex justify-around">
          {[
            { id: 'times', icon: Clock, label: 'Times' },
            { id: 'mx', icon: Wrench, label: 'Mx Due' },
            { id: 'squawks', icon: AlertTriangle, label: 'Squawks' },
            { id: 'notes', icon: FileText, label: 'Notes' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 py-4 flex flex-col items-center justify-center transition-all ${activeTab === tab.id ? 'text-brandOrange' : 'text-gray-400 hover:text-navy hover:bg-gray-50'}`}
            >
              <tab.icon size={20} className="mb-1" />
              <span className={`text-[10px] font-bold uppercase tracking-widest ${activeTab === tab.id ? 'text-brandOrange' : 'text-navy'}`}>
                {tab.label}
              </span>
              {/* Active Tab Indicator Line */}
              {activeTab === tab.id && <div className="absolute top-0 w-12 h-1 bg-brandOrange rounded-b-full"></div>}
            </button>
          ))}
        </div>
      </nav>

    </div>
  );
}
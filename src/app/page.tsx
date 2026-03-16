"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { PlaneTakeoff, Wrench, AlertTriangle, FileText, Clock, LogOut, Plus, ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import TicketField from "@/components/TicketField";
import { PrimaryButton } from "@/components/AppButtons";

export default function FleetTrackerApp() {
  const [session, setSession] = useState<any>(null);
  const [role, setRole] = useState<'admin' | 'pilot'>('pilot');
  const [authEmail, setAuthEmail] = useState("");
  const[authPassword, setAuthPassword] = useState("");

  const[aircraftList, setAircraftList] = useState<any[]>([]);
  const [activeTail, setActiveTail] = useState<string>("");
  const[activeTab, setActiveTab] = useState<'times' | 'mx' | 'squawks' | 'notes'>('times');
  
  const [flightLogs, setFlightLogs] = useState<any[]>([]);
  const[logPage, setLogPage] = useState(1);
  const[hasMoreLogs, setHasMoreLogs] = useState(false);
  const[isSubmitting, setIsSubmitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // --- NEW LOG FORM STATE ---
  const [logAftt, setLogAftt] = useState("");
  const[logFtt, setLogFtt] = useState("");
  const[logHobbs, setLogHobbs] = useState("");
  const [logTach, setLogTach] = useState("");
  const[logCycles, setLogCycles] = useState("");
  const[logLandings, setLogLandings] = useState("");
  const [logInitials, setLogInitials] = useState("");
  const[logPax, setLogPax] = useState("");
  const[logReason, setLogReason] = useState("");

  // --- ADMIN ADD AIRCRAFT STATE ---
  const[showAddAircraft, setShowAddAircraft] = useState(false);
  const [newTail, setNewTail] = useState("");
  const[newModel, setNewModel] = useState("");
  const [newType, setNewType] = useState<'Piston' | 'Turbine'>('Piston');
  const [newAirframeTime, setNewAirframeTime] = useState("");
  const[newEngineTime, setNewEngineTime] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchAircraftData(session.user.id);
    });
  },[]);

  useEffect(() => {
    if (activeTail) fetchFlightLogs(activeTail, logPage);
  },[activeTail, logPage]);

  const fetchAircraftData = async (userId: string) => {
    const { data: roleData } = await supabase.from('aft_user_roles').select('role').eq('user_id', userId).single();
    if (roleData) setRole(roleData.role);

    const { data: aircraftData } = await supabase.from('aft_aircraft').select('*').order('tail_number');
    if (aircraftData && aircraftData.length > 0) {
      setAircraftList(aircraftData);
      if (!activeTail) setActiveTail(aircraftData[0].tail_number);
    }
  };

  const fetchFlightLogs = async (tail: string, page: number) => {
    const aircraft = aircraftList.find(a => a.tail_number === tail);
    if (!aircraft) return;

    const pageSize = 10;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, count } = await supabase
      .from('aft_flight_logs')
      .select('*', { count: 'exact' })
      .eq('aircraft_id', aircraft.id)
      .order('created_at', { ascending: false })
      .range(from, to);
    
    if (data) {
      setFlightLogs(data);
      setHasMoreLogs(count !== null && count > to + 1);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  const handleTailChange = (newTail: string) => {
    setActiveTail(newTail);
    setLogPage(1);
    setLogAftt(""); setLogFtt(""); setLogHobbs(""); setLogTach(""); 
    setLogCycles(""); setLogLandings(""); setLogInitials(""); setLogPax(""); setLogReason("");
  };

  // --- ADMIN: ADD AIRCRAFT ---
  const handleAddAircraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    await supabase.from('aft_aircraft').insert({
      tail_number: newTail.toUpperCase(),
      aircraft_type: newModel,
      engine_type: newType,
      total_airframe_time: parseFloat(newAirframeTime) || 0,
      total_engine_time: parseFloat(newEngineTime) || 0
    });

    await fetchAircraftData(session.user.id);
    setActiveTail(newTail.toUpperCase());
    setShowAddAircraft(false);
    setIsSubmitting(false);
    setNewTail(""); setNewModel(""); setNewAirframeTime(""); setNewEngineTime("");
  };

  // --- CSV EXPORT ---
  const exportCSV = async () => {
    setIsExporting(true);
    const aircraft = aircraftList.find(a => a.tail_number === activeTail);
    if (!aircraft) return;

    const { data } = await supabase.from('aft_flight_logs').select('*').eq('aircraft_id', aircraft.id).order('created_at', { ascending: false });

    if (!data || data.length === 0) {
      alert("No logs to export for this aircraft.");
      setIsExporting(false); return;
    }

    const isTurbine = aircraft.engine_type === 'Turbine';
    const headers =['Date', 'Initials', isTurbine ? 'AFTT' : 'Hobbs', isTurbine ? 'FTT' : 'Tach', 'Landings', 'Engine Cycles', 'Reason', 'Passengers'];
    const csvRows = [headers.join(',')];

    data.forEach(log => {
      const row =[
        new Date(log.created_at).toLocaleDateString(),
        log.initials,
        isTurbine ? (log.aftt || '') : (log.hobbs || ''),
        isTurbine ? (log.ftt || '') : (log.tach || ''),
        log.landings,
        log.engine_cycles,
        log.trip_reason || 'N/A',
        `"${(log.pax_info || '').replace(/"/g, '""')}"`
      ];
      csvRows.push(row.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeTail}_Flight_Logs.csv`;
    a.click();
    setIsExporting(false);
  };

  // --- SUBMIT NEW FLIGHT LOG ---
  const submitFlightLog = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const aircraft = aircraftList.find(a => a.tail_number === activeTail);
    
    if (aircraft && session) {
      const isTurbine = aircraft.engine_type === 'Turbine';
      
      const insertData: any = {
        aircraft_id: aircraft.id,
        user_id: session.user.id,
        engine_cycles: parseInt(logCycles),
        landings: parseInt(logLandings),
        initials: logInitials.toUpperCase(),
        pax_info: logPax || null,
        trip_reason: logReason || null
      };

      const updateData: any = {};

      if (isTurbine) {
        insertData.aftt = parseFloat(logAftt);
        insertData.ftt = parseFloat(logFtt);
        updateData.total_airframe_time = parseFloat(logAftt);
        updateData.total_engine_time = parseFloat(logFtt);
      } else {
        insertData.tach = parseFloat(logTach);
        updateData.total_engine_time = parseFloat(logTach);
        if (logHobbs) {
          insertData.hobbs = parseFloat(logHobbs);
          updateData.total_airframe_time = parseFloat(logHobbs);
        }
      }

      await supabase.from('aft_flight_logs').insert(insertData);
      await supabase.from('aft_aircraft').update(updateData).eq('id', aircraft.id);

      setLogPage(1);
      await fetchFlightLogs(activeTail, 1);
      await fetchAircraftData(session.user.id);
      
      setLogAftt(""); setLogFtt(""); setLogHobbs(""); setLogTach(""); 
      setLogCycles(""); setLogLandings(""); setLogInitials(""); setLogPax(""); setLogReason("");
    }
    setIsSubmitting(false);
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-slateGray flex items-center justify-center p-4">
        <div className="bg-cream shadow-2xl rounded-sm p-8 w-full max-w-md border-t-4 border-brandOrange">
          <div className="text-center mb-8">
            <PlaneTakeoff size={48} className="text-navy mx-auto mb-4" />
            <h1 className="font-oswald text-3xl font-bold uppercase tracking-widest text-navy">Skyward Society</h1>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email</label>
              <input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-400 bg-white" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Password</label>
              <input type="password" required value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-400 bg-white" />
            </div>
            <div className="pt-4"><PrimaryButton>Access Portal</PrimaryButton></div>
          </form>
        </div>
      </div>
    );
  }

  const selectedAircraftData = aircraftList.find(a => a.tail_number === activeTail);
  const isTurbine = selectedAircraftData?.engine_type === 'Turbine';

  return (
    <div className="h-screen flex flex-col bg-neutral-100 relative">
      
      {/* ADD AIRCRAFT MODAL (Admin Only) */}
      {showAddAircraft && role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-brandOrange">
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy">Add Aircraft</h2>
              <button onClick={() => setShowAddAircraft(false)} className="text-gray-400 hover:text-red-500"><X size={24}/></button>
            </div>
            <form onSubmit={handleAddAircraft} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Tail Number</label>
                  <input type="text" required value={newTail} onChange={e=>setNewTail(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 uppercase" placeholder="N12345" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Engine Type</label>
                  <select value={newType} onChange={e=>setNewType(e.target.value as 'Piston'|'Turbine')} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 bg-white">
                    <option value="Piston">Piston</option>
                    <option value="Turbine">Turbine</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Model Name</label>
                <input type="text" required value={newModel} onChange={e=>setNewModel(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" placeholder="Cessna 172" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Current {newType === 'Turbine' ? 'AFTT' : 'Hobbs'}</label>
                  <input type="number" step="0.1" required value={newAirframeTime} onChange={e=>setNewAirframeTime(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Current {newType === 'Turbine' ? 'FTT' : 'Tach'}</label>
                  <input type="number" step="0.1" required value={newEngineTime} onChange={e=>setNewEngineTime(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" />
                </div>
              </div>
              <div className="pt-4">
                <PrimaryButton>{isSubmitting ? "Saving..." : "Save Aircraft"}</PrimaryButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TOP HEADER */}
      <header className="bg-navy text-white shadow-md z-10 sticky top-0">
        <div className="max-w-3xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex flex-col">
            <span className="text-[9px] font-bold uppercase tracking-widest text-brandOrange mb-[2px]">Active Aircraft</span>
            <div className="flex items-center gap-2">
              <PlaneTakeoff size={18} className="text-brandOrange" />
              <select 
                className="bg-transparent text-xl font-oswald font-bold uppercase tracking-wide focus:outline-none cursor-pointer"
                value={activeTail}
                onChange={(e) => handleTailChange(e.target.value)}
              >
                {aircraftList.map(a => (
                  <option key={a.id} value={a.tail_number} className="text-navy">{a.tail_number}</option>
                ))}
              </select>
              {role === 'admin' && (
                <button onClick={() => setShowAddAircraft(true)} className="ml-2 bg-brandOrange text-white rounded-full p-1 hover:bg-brandOrange-alt transition-colors">
                  <Plus size={14} />
                </button>
              )}
            </div>
          </div>
          <button onClick={handleLogout} className="text-gray-400 hover:text-white transition-colors flex flex-col items-center">
            <LogOut size={18} />
            <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Logout</span>
          </button>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 overflow-y-auto p-4 pb-24 flex justify-center">
        <div className="w-full max-w-3xl flex flex-col gap-6">
          
          {/* TAB 1: TIMES */}
          {activeTab === 'times' && (
            <>
              {/* Data View: The Logbook */}
              <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-brandOrange overflow-hidden flex flex-col">
                <div className="flex justify-between items-end mb-6">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-brandOrange block mb-1">{isTurbine ? 'TURBINE' : 'PISTON'} LOGBOOK</span>
                    <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Flight Log</h2>
                  </div>
                  <button onClick={exportCSV} disabled={isExporting} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-brandOrange hover:text-brandOrange-alt transition-colors disabled:opacity-50">
                    <Download size={14} /> {isExporting ? "Exporting..." : "Export CSV"}
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b-2 border-navy text-[10px] font-bold uppercase tracking-widest text-gray-500">
                        <th className="pb-2 pr-4">Date</th>
                        <th className="pb-2 pr-4">Init</th>
                        <th className="pb-2 pr-4">{isTurbine ? 'AFTT' : 'Hobbs'}</th>
                        <th className="pb-2 pr-4">{isTurbine ? 'FTT' : 'Tach'}</th>
                        <th className="pb-2 pr-4">Lndg</th>
                        <th className="pb-2 pr-4">Cyc</th>
                        <th className="pb-2 pr-4">Rsn</th>
                        <th className="pb-2">Pax</th>
                      </tr>
                    </thead>
                    <tbody className="text-xs font-roboto text-navy">
                      {flightLogs.length === 0 ? (
                        <tr><td colSpan={8} className="py-8 text-center text-gray-400 italic">No logs found for this aircraft.</td></tr>
                      ) : (
                        flightLogs.map((log) => (
                          <tr key={log.id} className="border-b border-gray-200 hover:bg-orange-50/50 transition-colors">
                            <td className="py-3 pr-4 whitespace-nowrap">{new Date(log.created_at).toLocaleDateString()}</td>
                            <td className="py-3 pr-4 font-bold">{log.initials}</td>
                            <td className="py-3 pr-4">{isTurbine ? log.aftt?.toFixed(1) : log.hobbs?.toFixed(1) || '-'}</td>
                            <td className="py-3 pr-4">{isTurbine ? log.ftt?.toFixed(1) : log.tach?.toFixed(1)}</td>
                            <td className="py-3 pr-4">{log.landings}</td>
                            <td className="py-3 pr-4">{log.engine_cycles}</td>
                            <td className="py-3 pr-4">{log.trip_reason || "-"}</td>
                            <td className="py-3 truncate max-w-[100px]" title={log.pax_info}>{log.pax_info || "-"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* PAGINATION CONTROLS */}
                {flightLogs.length > 0 && (
                  <div className="flex justify-between items-center mt-4 border-t border-gray-200 pt-4">
                    <button onClick={() => setLogPage(p => Math.max(1, p - 1))} disabled={logPage === 1} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-brandOrange">
                      <ChevronLeft size={14} /> Prev
                    </button>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Page {logPage}</span>
                    <button onClick={() => setLogPage(p => p + 1)} disabled={!hasMoreLogs} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-brandOrange">
                      Next <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* Action Form: New Entry */}
              <div className="bg-white border border-gray-200 shadow-sm rounded p-5">
                <h3 className="font-oswald font-bold uppercase text-lg mb-4 text-navy flex items-center gap-2">
                  <Plus size={18} className="text-brandOrange"/> Log New Flight
                </h3>
                
                <form onSubmit={submitFlightLog} className="space-y-4">
                  
                  {/* DYNAMIC TIMES ROW based on Turbine vs Piston */}
                  <div className="grid grid-cols-2 gap-4">
                    {isTurbine ? (
                      <>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-navy">New AFTT <span className="text-red-500">*</span></label>
                          <input type="number" step="0.1" required value={logAftt} onChange={e => setLogAftt(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none" placeholder={selectedAircraftData?.total_airframe_time} />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-navy">New FTT <span className="text-red-500">*</span></label>
                          <input type="number" step="0.1" required value={logFtt} onChange={e => setLogFtt(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none" placeholder={selectedAircraftData?.total_engine_time} />
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-navy">New Hobbs <span className="text-gray-400 font-normal lowercase">(Opt)</span></label>
                          <input type="number" step="0.1" value={logHobbs} onChange={e => setLogHobbs(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none" placeholder={selectedAircraftData?.total_airframe_time} />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-navy">New Tach <span className="text-red-500">*</span></label>
                          <input type="number" step="0.1" required value={logTach} onChange={e => setLogTach(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none" placeholder={selectedAircraftData?.total_engine_time} />
                        </div>
                      </>
                    )}
                  </div>

                  {/* Rest of the form */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Landings</label>
                      <input type="number" required value={logLandings} onChange={e => setLogLandings(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none" placeholder="0" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Engine Cycles</label>
                      <input type="number" required value={logCycles} onChange={e => setLogCycles(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none" placeholder="0" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Initials</label>
                      <input type="text" maxLength={3} required value={logInitials} onChange={e => setLogInitials(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none uppercase" placeholder="ABC" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Reason (Opt)</label>
                      <select value={logReason} onChange={e => setLogReason(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none bg-white">
                        <option value="">Select...</option>
                        <option value="PE">PE - Personal</option>
                        <option value="BE">BE - Business</option>
                        <option value="MX">MX - Maintenance</option>
                        <option value="T">T - Training</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Passengers (Opt)</label>
                    <input type="text" value={logPax} onChange={e => setLogPax(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none" placeholder="Names or notes..." />
                  </div>

                  <div className="pt-2">
                    <PrimaryButton>{isSubmitting ? "Saving..." : "Submit Log Entry"}</PrimaryButton>
                  </div>
                </form>
              </div>
            </>
          )}

          {/* OTHER TABS */}
          {activeTab !== 'times' && (
            <div className="bg-cream shadow-lg rounded-sm p-6 border-t-4 border-gray-400">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy m-0 mb-4">{activeTab} section</h2>
              <p className="text-sm text-gray-500 italic">Database fetch logic coming next...</p>
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
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 py-3 md:py-4 flex flex-col items-center justify-center transition-all relative ${activeTab === tab.id ? 'text-brandOrange' : 'text-gray-400 hover:text-navy hover:bg-gray-50'}`}
            >
              <tab.icon size={20} className="mb-1" />
              <span className={`text-[10px] font-bold uppercase tracking-widest ${activeTab === tab.id ? 'text-brandOrange' : 'text-navy'}`}>
                {tab.label}
              </span>
              {activeTab === tab.id && <div className="absolute top-0 w-12 h-1 bg-brandOrange rounded-b-full"></div>}
            </button>
          ))}
        </div>
      </nav>

    </div>
  );
}
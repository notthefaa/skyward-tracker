import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Download, ChevronLeft, ChevronRight, Plus, X, Edit2, Trash2 } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";

export default function TimesTab({ aircraft, session, role, onUpdate }: { aircraft: any, session: any, role: string, onUpdate: () => void }) {
  const [flightLogs, setFlightLogs] = useState<any[]>([]);
  const[logPage, setLogPage] = useState(1);
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  
  const [showLogModal, setShowLogModal] = useState(false);
  const[isSubmitting, setIsSubmitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const[logAftt, setLogAftt] = useState("");
  const [logFtt, setLogFtt] = useState("");
  const [logHobbs, setLogHobbs] = useState("");
  const[logTach, setLogTach] = useState("");
  const [logCycles, setLogCycles] = useState("");
  const[logLandings, setLogLandings] = useState("");
  const [logInitials, setLogInitials] = useState("");
  const [logPax, setLogPax] = useState("");
  const [logReason, setLogReason] = useState("");
  
  // NEW: Fuel State
  const [logFuel, setLogFuel] = useState("");
  const [logFuelUnit, setLogFuelUnit] = useState<'gallons' | 'lbs'>('gallons');

  const isTurbine = aircraft?.engine_type === 'Turbine';

  useEffect(() => { 
    if (aircraft) { 
      setLogPage(1); 
      fetchFlightLogs(aircraft.id, 1); 
    } 
  }, [aircraft?.id]);

  useEffect(() => { 
    if (aircraft) fetchFlightLogs(aircraft.id, logPage); 
  }, [logPage]);

  const fetchFlightLogs = async (aircraftId: string, page: number) => {
    const pageSize = 10; 
    const from = (page - 1) * pageSize; 
    const to = from + pageSize - 1;
    
    const { data, count } = await supabase
      .from('aft_flight_logs')
      .select('*', { count: 'exact' })
      .eq('aircraft_id', aircraftId)
      .order('created_at', { ascending: false })
      .range(from, to);
      
    if (data) { 
      setFlightLogs(data); 
      setHasMoreLogs(count !== null && count > to + 1); 
    }
  };

  const openLogForm = (log: any = null) => {
    if (log) {
      setEditingId(log.id); 
      setLogAftt(log.aftt || ""); 
      setLogFtt(log.ftt || ""); 
      setLogHobbs(log.hobbs || ""); 
      setLogTach(log.tach || "");
      setLogCycles(log.engine_cycles || ""); 
      setLogLandings(log.landings || ""); 
      setLogInitials(log.initials || ""); 
      setLogPax(log.pax_info || ""); 
      setLogReason(log.trip_reason || "");
      setLogFuel(log.fuel_gallons || "");
      setLogFuelUnit("gallons");
    } else {
      setEditingId(null); 
      setLogAftt(""); 
      setLogFtt(""); 
      setLogHobbs(""); 
      setLogTach(""); 
      setLogCycles(""); 
      setLogLandings(""); 
      setLogInitials(""); 
      setLogPax(""); 
      setLogReason("");
      setLogFuel("");
      setLogFuelUnit("gallons");
    }
    setShowLogModal(true);
  };

  const deleteLatestLog = async (log: any) => {
    if (!confirm("Are you sure you want to delete the most recent flight log? This will permanently erase it and roll the aircraft totals back to the previous log.")) return;
    
    setIsSubmitting(true);

    const { data: previousLogs } = await supabase
      .from('aft_flight_logs')
      .select('*')
      .eq('aircraft_id', aircraft.id)
      .order('created_at', { ascending: false })
      .limit(2);
    
    const previousLog = previousLogs && previousLogs.length > 1 ? previousLogs[1] : null;

    const updateData: any = {};
    if (isTurbine) {
      updateData.total_airframe_time = previousLog ? previousLog.aftt : 0;
      updateData.total_engine_time = previousLog ? previousLog.ftt : 0;
    } else {
      updateData.total_engine_time = previousLog ? previousLog.tach : 0;
      updateData.total_airframe_time = previousLog && previousLog.hobbs ? previousLog.hobbs : (aircraft.total_airframe_time || 0);
    }
    
    // Rollback Fuel safely
    updateData.current_fuel_gallons = previousLog && previousLog.fuel_gallons !== null ? previousLog.fuel_gallons : 0;

    await supabase.from('aft_flight_logs').delete().eq('id', log.id);
    await supabase.from('aft_aircraft').update(updateData).eq('id', aircraft.id);

    setLogPage(1);
    await fetchFlightLogs(aircraft.id, 1);
    onUpdate();
    setIsSubmitting(false);
  };

  const exportCSV = async () => {
    setIsExporting(true);
    const { data } = await supabase.from('aft_flight_logs').select('*').eq('aircraft_id', aircraft.id).order('created_at', { ascending: false });

    if (!data || data.length === 0) { 
      alert("No logs to export."); 
      setIsExporting(false); 
      return; 
    }

    const headers =['Date', 'Initials', isTurbine ? 'AFTT' : 'Hobbs', isTurbine ? 'FTT' : 'Tach', 'Landings'];
    if (isTurbine) headers.push('Engine Cycles');
    headers.push('Fuel (Gal)', 'Reason', 'Passengers');

    const csvRows =[headers.join(',')];

    data.forEach(log => {
      const row =[
        new Date(log.created_at).toLocaleDateString(),
        log.initials,
        isTurbine ? (log.aftt || '') : (log.hobbs || ''),
        isTurbine ? (log.ftt || '') : (log.tach || ''),
        log.landings
      ];
      if (isTurbine) row.push(log.engine_cycles);
      row.push(log.fuel_gallons || '-', log.trip_reason || 'N/A', `"${(log.pax_info || '').replace(/"/g, '""')}"`);
      csvRows.push(row.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); 
    a.href = window.URL.createObjectURL(blob); 
    a.download = `${aircraft.tail_number}_Flight_Logs.csv`; 
    a.click();
    setIsExporting(false);
  };

  const submitFlightLog = async (e: React.FormEvent) => {
    e.preventDefault(); 
    setIsSubmitting(true);

    // Fuel Conversion Logic
    let fuelGallons = logFuel ? parseFloat(logFuel) : null;
    if (fuelGallons !== null && logFuelUnit === 'lbs') {
      const weightPerGal = isTurbine ? 6.7 : 6.0;
      fuelGallons = fuelGallons / weightPerGal;
    }

    const payload: any = { 
      aircraft_id: aircraft.id, 
      user_id: session.user.id, 
      engine_cycles: isTurbine ? (parseInt(logCycles) || 0) : 0, 
      landings: parseInt(logLandings), 
      initials: logInitials.toUpperCase(), 
      pax_info: logPax || null, 
      trip_reason: logReason || null,
      fuel_gallons: fuelGallons
    };
    
    const aircraftUpdate: any = {};

    if (isTurbine) {
      payload.aftt = parseFloat(logAftt); 
      payload.ftt = parseFloat(logFtt);
      aircraftUpdate.total_airframe_time = parseFloat(logAftt); 
      aircraftUpdate.total_engine_time = parseFloat(logFtt);
    } else {
      payload.tach = parseFloat(logTach); 
      aircraftUpdate.total_engine_time = parseFloat(logTach);
      if (logHobbs) { 
        payload.hobbs = parseFloat(logHobbs); 
        aircraftUpdate.total_airframe_time = parseFloat(logHobbs); 
      }
    }

    // Only update aircraft's master fuel state if a new value was actually entered
    if (fuelGallons !== null) {
      aircraftUpdate.current_fuel_gallons = fuelGallons;
    }

    if (editingId) {
      await supabase.from('aft_flight_logs').update(payload).eq('id', editingId);
    } else {
      await supabase.from('aft_flight_logs').insert(payload);
    }

    await supabase.from('aft_aircraft').update(aircraftUpdate).eq('id', aircraft.id);

    await fetchFlightLogs(aircraft.id, logPage); 
    onUpdate(); 
    setShowLogModal(false); 
    setIsSubmitting(false);
  };

  if (!aircraft) return null;

  return (
    <>
      <div className="mb-2">
        <PrimaryButton onClick={() => openLogForm()}>
          <Plus size={18} /> Log New Flight
        </PrimaryButton>
      </div>

      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#F5B05B] overflow-hidden flex flex-col mb-6">
        <div className="flex justify-between items-end mb-6">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5B05B] block mb-1">
              {isTurbine ? 'TURBINE' : 'PISTON'} LOGBOOK
            </span>
            <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Flight Log</h2>
          </div>
          <button onClick={exportCSV} disabled={isExporting} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#F5B05B] hover:opacity-80 transition-colors disabled:opacity-50">
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
                {isTurbine && <th className="pb-2 pr-4">Cyc</th>}
                <th className="pb-2 pr-4">Fuel(G)</th>
                <th className="pb-2 pr-4">Rsn</th>
                <th className="pb-2">Pax</th>
                {role === 'admin' && <th className="pb-2"></th>}
              </tr>
            </thead>
            
            <tbody className="text-xs font-roboto text-navy">
              {flightLogs.map((log, index) => (
                <tr key={log.id} className="border-b border-gray-200 hover:bg-orange-50/50 transition-colors">
                  <td className="py-3 pr-4 whitespace-nowrap">{new Date(log.created_at).toLocaleDateString()}</td>
                  <td className="py-3 pr-4 font-bold">{log.initials}</td>
                  <td className="py-3 pr-4">{isTurbine ? log.aftt?.toFixed(1) : log.hobbs?.toFixed(1) || '-'}</td>
                  <td className="py-3 pr-4">{isTurbine ? log.ftt?.toFixed(1) : log.tach?.toFixed(1)}</td>
                  <td className="py-3 pr-4">{log.landings}</td>
                  {isTurbine && <td className="py-3 pr-4">{log.engine_cycles}</td>}
                  <td className="py-3 pr-4 text-gray-500">{log.fuel_gallons ? log.fuel_gallons.toFixed(1) : '-'}</td>
                  <td className="py-3 pr-4">{log.trip_reason || "-"}</td>
                  <td className="py-3 truncate max-w-[100px]" title={log.pax_info}>{log.pax_info || "-"}</td>
                  
                  {role === 'admin' && (
                    <td className="py-3 text-right flex justify-end items-center gap-3">
                      <button onClick={() => openLogForm(log)} className="text-gray-400 hover:text-[#F5B05B] transition-colors" title="Edit Log">
                        <Edit2 size={14}/>
                      </button>
                      {logPage === 1 && index === 0 && (
                        <button onClick={() => deleteLatestLog(log)} className="text-gray-400 hover:text-red-500 transition-colors" title="Delete Latest Log">
                          <Trash2 size={14}/>
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between items-center mt-4 border-t border-gray-200 pt-4">
          <button onClick={() => setLogPage(p => Math.max(1, p - 1))} disabled={logPage === 1} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-[#F5B05B] transition-colors">
            <ChevronLeft size={14} /> Prev
          </button>
          <span className="text-[10px] font-bold uppercase text-gray-400">Page {logPage}</span>
          <button onClick={() => setLogPage(p => p + 1)} disabled={!hasMoreLogs} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-[#F5B05B] transition-colors">
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {showLogModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-[#F5B05B] max-h-[90vh] overflow-y-auto animate-slide-up">
            
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy">{editingId ? 'Edit Flight Log' : 'Log New Flight'}</h2>
              <button onClick={() => setShowLogModal(false)} className="text-gray-400 hover:text-red-500 transition-colors"><X size={24}/></button>
            </div>
            
            <form onSubmit={submitFlightLog} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {isTurbine ? (
                  <>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-navy">AFTT *</label>
                      <input type="number" step="0.1" required value={logAftt} onChange={e=>setLogAftt(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-navy">FTT *</label>
                      <input type="number" step="0.1" required value={logFtt} onChange={e=>setLogFtt(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Hobbs (Opt)</label>
                      <input type="number" step="0.1" value={logHobbs} onChange={e=>setLogHobbs(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Tach *</label>
                      <input type="number" step="0.1" required value={logTach} onChange={e=>setLogTach(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" />
                    </div>
                  </>
                )}
              </div>

              {/* NEW FUEL ENTRY ROW */}
              <div className="grid grid-cols-2 gap-4 border border-[#F5B05B]/30 bg-[#F5B05B]/5 p-3 rounded">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Current Fuel State (Opt)</label>
                  <input type="number" step="0.1" value={logFuel} onChange={e=>setLogFuel(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" placeholder="Amount..." />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Fuel Unit</label>
                  <select value={logFuelUnit} onChange={e=>setLogFuelUnit(e.target.value as any)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-[#F5B05B] outline-none">
                    <option value="gallons">Gallons</option>
                    <option value="lbs">Lbs</option>
                  </select>
                </div>
              </div>

              <div className={`grid ${isTurbine ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Landings</label>
                  <input type="number" required value={logLandings} onChange={e=>setLogLandings(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" placeholder="0" />
                </div>
                {isTurbine && (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Engine Cycles</label>
                    <input type="number" required value={logCycles} onChange={e=>setLogCycles(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" placeholder="0" />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Initials</label>
                  <input type="text" maxLength={3} required value={logInitials} onChange={e=>setLogInitials(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-[#F5B05B] outline-none" placeholder="ABC" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Reason (Opt)</label>
                  <select value={logReason} onChange={e=>setLogReason(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-[#F5B05B] outline-none">
                    <option value="">Select...</option>
                    <option value="PE">PE</option>
                    <option value="BE">BE</option>
                    <option value="MX">MX</option>
                    <option value="T">T</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Passengers (Opt)</label>
                <input type="text" value={logPax} onChange={e=>setLogPax(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" placeholder="Names or notes..." />
              </div>

              <div className="pt-4">
                <PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Flight Log"}</PrimaryButton>
              </div>

            </form>
          </div>
        </div>
      )}
    </>
  );
}
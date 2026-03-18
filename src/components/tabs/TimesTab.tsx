import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Download, ChevronLeft, ChevronRight, Plus, X, Edit2, Trash2, Info } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";

export default function TimesTab({ 
  aircraft, 
  session, 
  role, 
  userInitials, 
  onUpdate 
}: { 
  aircraft: any, 
  session: any, 
  role: string, 
  userInitials: string, 
  onUpdate: () => void 
}) {
  const [flightLogs, setFlightLogs] = useState<any[]>([]);
  const [logPage, setLogPage] = useState(1);
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  
  const[showLogModal, setShowLogModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Modals State
  const [viewPax, setViewPax] = useState<string | null>(null);
  const[showLegend, setShowLegend] = useState(false);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [logAftt, setLogAftt] = useState("");
  const [logFtt, setLogFtt] = useState("");
  const[logHobbs, setLogHobbs] = useState("");
  const [logTach, setLogTach] = useState("");
  const [logCycles, setLogCycles] = useState("");
  const [logLandings, setLogLandings] = useState("");
  const [logInitials, setLogInitials] = useState("");
  const[logPax, setLogPax] = useState("");
  const [logReason, setLogReason] = useState("");
  
  // Fuel State
  const [logFuel, setLogFuel] = useState("");
  const[logFuelUnit, setLogFuelUnit] = useState<'gallons' | 'lbs'>('gallons');

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
    // Fetch 11 items so we can accurately calculate the duration of the 10th item!
    const to = from + pageSize; 
    
    const { data, count } = await supabase
      .from('aft_flight_logs')
      .select('*', { count: 'exact' })
      .eq('aircraft_id', aircraftId)
      .order('created_at', { ascending: false })
      .range(from, to);
      
    if (data) { 
      setFlightLogs(data); 
      setHasMoreLogs(count !== null && count > from + pageSize); 
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
      setLogInitials(userInitials || ""); // Auto-fill their initials!
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
    
    // Safely Rollback Fuel state and timestamp to the previous log (if available)
    updateData.current_fuel_gallons = previousLog && previousLog.fuel_gallons !== null ? previousLog.fuel_gallons : 0;
    updateData.fuel_last_updated = previousLog ? previousLog.created_at : null;

    await supabase.from('aft_flight_logs').delete().eq('id', log.id);
    await supabase.from('aft_aircraft').update(updateData).eq('id', aircraft.id);

    setLogPage(1);
    await fetchFlightLogs(aircraft.id, 1);
    onUpdate();
    setIsSubmitting(false);
  };

  const exportCSV = async () => {
    setIsExporting(true);
    const { data } = await supabase
      .from('aft_flight_logs')
      .select('*')
      .eq('aircraft_id', aircraft.id)
      .order('created_at', { ascending: false });

    if (!data || data.length === 0) { 
      alert("No logs to export."); 
      setIsExporting(false); 
      return; 
    }

    const headers =['Date', 'Initials', 'Flt Hrs', isTurbine ? 'AFTT' : 'Hobbs', isTurbine ? 'FTT' : 'Tach', 'Landings'];
    if (isTurbine) headers.push('Engine Cycles');
    headers.push('Fuel (Gal)', 'Reason', 'Passengers');

    const csvRows =[headers.join(',')];

    data.forEach((log, index) => {
      const prevLog = data[index + 1];
      let fltTime = "-";
      if (prevLog) {
        const diff = isTurbine 
          ? ((log.aftt || 0) - (prevLog.aftt || 0)) 
          : (log.hobbs ? (log.hobbs - (prevLog.hobbs || 0)) : ((log.tach || 0) - (prevLog.tach || 0)));
        fltTime = Math.max(0, diff).toFixed(1);
      }

      const row =[
        new Date(log.created_at).toLocaleDateString('en-US', { year: '2-digit', month: 'numeric', day: 'numeric' }),
        log.initials, 
        fltTime, 
        isTurbine ? (log.aftt || '') : (log.hobbs || ''), 
        isTurbine ? (log.ftt || '') : (log.tach || ''), 
        log.landings
      ];
      
      if (isTurbine) row.push(log.engine_cycles);
      
      row.push(
        log.fuel_gallons || '-', 
        log.trip_reason || 'N/A', 
        `"${(log.pax_info || '').replace(/"/g, '""')}"`
      );
      
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
    
    // --- DATA VALIDATION ---
    // We only enforce the "must be greater" rule on NEW logs (!editingId). 
    // If an Admin is editing a log, we allow them to bypass this to correct mistakes.
    if (!editingId) {
      if (isTurbine) {
        if (parseFloat(logAftt) < (aircraft.total_airframe_time || 0)) {
          return alert(`Error: New AFTT (${logAftt}) cannot be less than current AFTT (${aircraft.total_airframe_time || 0}).`);
        }
        if (parseFloat(logFtt) < (aircraft.total_engine_time || 0)) {
          return alert(`Error: New FTT (${logFtt}) cannot be less than current FTT (${aircraft.total_engine_time || 0}).`);
        }
      } else {
        if (parseFloat(logTach) < (aircraft.total_engine_time || 0)) {
          return alert(`Error: New Tach (${logTach}) cannot be less than current Tach (${aircraft.total_engine_time || 0}).`);
        }
        if (logHobbs && parseFloat(logHobbs) < (aircraft.total_airframe_time || 0)) {
          return alert(`Error: New Hobbs (${logHobbs}) cannot be less than current Hobbs (${aircraft.total_airframe_time || 0}).`);
        }
      }
    }
    
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
      aircraftUpdate.fuel_last_updated = new Date().toISOString(); // Record exactly when this fuel level was set!
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

  // We only display the first 10 items in the UI! The 11th item is just for math.
  const displayLogs = flightLogs.slice(0, 10);

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
            <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">
              Flight Log
            </h2>
          </div>
          <button 
            onClick={exportCSV} 
            disabled={isExporting} 
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#F5B05B] hover:opacity-80 transition-colors disabled:opacity-50"
          >
            <Download size={14} /> {isExporting ? "Exporting..." : "Export CSV"}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-navy text-[10px] font-bold uppercase tracking-widest text-gray-500">
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Init</th>
                <th className="pb-2 pr-4">FLT</th>
                <th className="pb-2 pr-4">{isTurbine ? 'AFTT' : 'Hobbs'}</th>
                <th className="pb-2 pr-4">{isTurbine ? 'FTT' : 'Tach'}</th>
                <th className="pb-2 pr-4">LDG</th>
                
                {/* Dynamically hide/show Cycles Header */}
                {isTurbine && (
                  <th className="pb-2 pr-4">Cyc</th>
                )}
                
                <th className="pb-2 pr-4">Rsn</th>
                <th className="pb-2 text-center">Pax</th>
                
                {/* Empty Header for Edit column */}
                {role === 'admin' && (
                  <th className="pb-2"></th>
                )}
              </tr>
            </thead>
            
            <tbody className="text-xs font-roboto text-navy">
              {displayLogs.map((log, index) => {
                
                // FLIGHT DURATION MATH (Calculated dynamically)
                const prevLog = flightLogs[index + 1];
                let fltTime = "-";
                if (prevLog) {
                  const diff = isTurbine 
                    ? ((log.aftt || 0) - (prevLog.aftt || 0)) 
                    : (log.hobbs ? (log.hobbs - (prevLog.hobbs || 0)) : ((log.tach || 0) - (prevLog.tach || 0)));
                  fltTime = Math.max(0, diff).toFixed(1);
                }

                return (
                  <tr key={log.id} className="border-b border-gray-200 hover:bg-orange-50/50 transition-colors">
                    
                    <td className="py-3 pr-4 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleDateString('en-US', { year: '2-digit', month: 'numeric', day: 'numeric' })}
                    </td>
                    
                    <td className="py-3 pr-4 font-bold">{log.initials}</td>
                    <td className="py-3 pr-4 text-[#F5B05B] font-bold">{fltTime}</td>
                    <td className="py-3 pr-4">{isTurbine ? log.aftt?.toFixed(1) : log.hobbs?.toFixed(1) || '-'}</td>
                    <td className="py-3 pr-4">{isTurbine ? log.ftt?.toFixed(1) : log.tach?.toFixed(1)}</td>
                    <td className="py-3 pr-4">{log.landings}</td>
                    
                    {/* Dynamically hide/show Cycles Data */}
                    {isTurbine && (
                      <td className="py-3 pr-4">{log.engine_cycles}</td>
                    )}
                    
                    <td className="py-3 pr-4">{log.trip_reason || "-"}</td>
                    
                    {/* CLICKABLE PAX Y/N */}
                    <td className="py-3 text-center">
                      {log.pax_info ? (
                        <button 
                          onClick={() => setViewPax(log.pax_info)} 
                          className="text-[#F5B05B] font-bold underline active:scale-95 transition-transform"
                        >
                          Y
                        </button>
                      ) : (
                        <span className="text-gray-400 font-medium">N</span>
                      )}
                    </td>
                    
                    {/* Admin Actions */}
                    {role === 'admin' && (
                      <td className="py-3 text-right flex justify-end items-center gap-3">
                        <button 
                          onClick={() => openLogForm(log)} 
                          className="text-gray-400 hover:text-[#F5B05B] transition-colors" 
                          title="Edit Log"
                        >
                          <Edit2 size={14}/>
                        </button>
                        
                        {/* Only show delete on the very first row */}
                        {logPage === 1 && index === 0 && (
                          <button 
                            onClick={() => deleteLatestLog(log)} 
                            className="text-gray-400 hover:text-red-500 transition-colors" 
                            title="Delete Latest Log"
                          >
                            <Trash2 size={14}/>
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* PAGINATION */}
        <div className="flex justify-between items-center mt-4 border-t border-gray-200 pt-4">
          <button 
            onClick={() => setLogPage(p => Math.max(1, p - 1))} 
            disabled={logPage === 1} 
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-[#F5B05B] transition-colors"
          >
            <ChevronLeft size={14} /> Prev
          </button>
          
          <span className="text-[10px] font-bold uppercase text-gray-400">
            Page {logPage}
          </span>
          
          <button 
            onClick={() => setLogPage(p => p + 1)} 
            disabled={!hasMoreLogs} 
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-[#F5B05B] transition-colors"
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* PAX INFO SHADOW BOX MODAL */}
      {viewPax && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 animate-fade-in" onClick={() => setViewPax(null)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-[#F5B05B] animate-slide-up relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setViewPax(null)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500 transition-colors">
              <X size={20}/>
            </button>
            <h3 className="font-oswald text-xl font-bold uppercase tracking-widest text-navy mb-4">
              Passenger Info
            </h3>
            <p className="text-sm text-navy font-roboto whitespace-pre-wrap">{viewPax}</p>
          </div>
        </div>
      )}

      {/* REASON LEGEND SHADOW BOX MODAL */}
      {showLegend && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 animate-fade-in" onClick={() => setShowLegend(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-[#F5B05B] animate-slide-up relative" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setShowLegend(false)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500 transition-colors">
              <X size={20}/>
            </button>
            <h3 className="font-oswald text-xl font-bold uppercase tracking-widest text-navy mb-4">
              Reason Codes
            </h3>
            <ul className="text-sm text-navy font-roboto space-y-3">
              <li><strong className="text-[#F5B05B] w-8 inline-block">PE:</strong> Personal Entertainment</li>
              <li><strong className="text-[#F5B05B] w-8 inline-block">BE:</strong> Business Entertainment</li>
              <li><strong className="text-[#F5B05B] w-8 inline-block">MX:</strong> Maintenance</li>
              <li><strong className="text-[#F5B05B] w-8 inline-block">T:</strong> Training</li>
            </ul>
          </div>
        </div>
      )}

      {/* LOG FLIGHT MODAL */}
      {showLogModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-[#F5B05B] max-h-[90vh] overflow-y-auto animate-slide-up">
            
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy">
                {editingId ? 'Edit Flight Log' : 'Log New Flight'}
              </h2>
              <button onClick={() => setShowLogModal(false)} className="text-gray-400 hover:text-red-500 transition-colors">
                <X size={24}/>
              </button>
            </div>
            
            <form onSubmit={submitFlightLog} className="space-y-4">
              
              {/* TIMES ROW */}
              <div className="grid grid-cols-2 gap-4">
                {isTurbine ? (
                  <>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
                        AFTT *
                      </label>
                      <input 
                        type="number" 
                        step="0.1" 
                        required 
                        value={logAftt} 
                        onChange={e=>setLogAftt(e.target.value)} 
                        className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" 
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
                        FTT *
                      </label>
                      <input 
                        type="number" 
                        step="0.1" 
                        required 
                        value={logFtt} 
                        onChange={e=>setLogFtt(e.target.value)} 
                        className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" 
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
                        Hobbs (Opt)
                      </label>
                      <input 
                        type="number" 
                        step="0.1" 
                        value={logHobbs} 
                        onChange={e=>setLogHobbs(e.target.value)} 
                        className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" 
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
                        Tach *
                      </label>
                      <input 
                        type="number" 
                        step="0.1" 
                        required 
                        value={logTach} 
                        onChange={e=>setLogTach(e.target.value)} 
                        className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" 
                      />
                    </div>
                  </>
                )}
              </div>

              {/* FUEL ENTRY ROW */}
              <div className="grid grid-cols-2 gap-4 border border-[#F5B05B]/30 bg-[#F5B05B]/5 p-3 rounded">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
                    Current Fuel State (Opt)
                  </label>
                  <input 
                    type="number" 
                    step="0.1" 
                    value={logFuel} 
                    onChange={e=>setLogFuel(e.target.value)} 
                    className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" 
                    placeholder="Amount..." 
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
                    Fuel Unit
                  </label>
                  <select 
                    value={logFuelUnit} 
                    onChange={e=>setLogFuelUnit(e.target.value as any)} 
                    className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-[#F5B05B] outline-none"
                  >
                    <option value="gallons">Gallons</option>
                    <option value="lbs">Lbs</option>
                  </select>
                </div>
              </div>

              {/* LANDINGS & CYCLES */}
              <div className={`grid ${isTurbine ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
                    Landings
                  </label>
                  <input 
                    type="number" 
                    required 
                    value={logLandings} 
                    onChange={e=>setLogLandings(e.target.value)} 
                    className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" 
                    placeholder="0" 
                  />
                </div>
                {isTurbine && (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
                      Engine Cycles
                    </label>
                    <input 
                      type="number" 
                      required 
                      value={logCycles} 
                      onChange={e=>setLogCycles(e.target.value)} 
                      className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" 
                      placeholder="0" 
                    />
                  </div>
                )}
              </div>

              {/* INITIALS & REASON */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
                    Initials
                  </label>
                  <input 
                    type="text" 
                    maxLength={3} 
                    required 
                    value={logInitials} 
                    onChange={e=>setLogInitials(e.target.value)} 
                    className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-[#F5B05B] outline-none" 
                    placeholder="ABC" 
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1 mt-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
                      Reason (Opt)
                    </label>
                    <button 
                      type="button" 
                      onClick={() => setShowLegend(true)} 
                      className="text-[10px] text-[#F5B05B] hover:text-orange-600 flex items-center gap-1"
                    >
                      <Info size={10} /> Legend
                    </button>
                  </div>
                  <select 
                    value={logReason} 
                    onChange={e=>setLogReason(e.target.value)} 
                    className="w-full border border-gray-300 rounded p-3 text-sm bg-white focus:border-[#F5B05B] outline-none"
                  >
                    <option value="">Select...</option>
                    <option value="PE">PE</option>
                    <option value="BE">BE</option>
                    <option value="MX">MX</option>
                    <option value="T">T</option>
                  </select>
                </div>
              </div>

              {/* PAX */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
                  Passengers (Opt)
                </label>
                <input 
                  type="text" 
                  value={logPax} 
                  onChange={e=>setLogPax(e.target.value)} 
                  className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F5B05B] outline-none" 
                  placeholder="Names or notes..." 
                />
              </div>

              <div className="pt-4">
                <PrimaryButton disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save Flight Log"}
                </PrimaryButton>
              </div>

            </form>
          </div>
        </div>
      )}
    </>
  );
}
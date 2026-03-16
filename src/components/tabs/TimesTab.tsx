import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Download, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";

export default function TimesTab({ aircraft, session, onUpdate }: { aircraft: any, session: any, onUpdate: () => void }) {
  const [flightLogs, setFlightLogs] = useState<any[]>([]);
  const [logPage, setLogPage] = useState(1);
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const[isSubmitting, setIsSubmitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [logAftt, setLogAftt] = useState("");
  const[logFtt, setLogFtt] = useState("");
  const [logHobbs, setLogHobbs] = useState("");
  const [logTach, setLogTach] = useState("");
  const[logCycles, setLogCycles] = useState("");
  const [logLandings, setLogLandings] = useState("");
  const [logInitials, setLogInitials] = useState("");
  const[logPax, setLogPax] = useState("");
  const [logReason, setLogReason] = useState("");

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
    const { data, count } = await supabase.from('aft_flight_logs').select('*', { count: 'exact' }).eq('aircraft_id', aircraftId).order('created_at', { ascending: false }).range(from, to);
    if (data) { setFlightLogs(data); setHasMoreLogs(count !== null && count > to + 1); }
  };

  const exportCSV = async () => {
    setIsExporting(true);
    const { data } = await supabase.from('aft_flight_logs').select('*').eq('aircraft_id', aircraft.id).order('created_at', { ascending: false });
    if (!data || data.length === 0) { alert("No logs to export."); setIsExporting(false); return; }

    const headers =['Date', 'Initials', isTurbine ? 'AFTT' : 'Hobbs', isTurbine ? 'FTT' : 'Tach', 'Landings', 'Engine Cycles', 'Reason', 'Passengers'];
    const csvRows = [headers.join(',')];
    data.forEach(log => {
      csvRows.push([new Date(log.created_at).toLocaleDateString(), log.initials, isTurbine ? (log.aftt || '') : (log.hobbs || ''), isTurbine ? (log.ftt || '') : (log.tach || ''), log.landings, log.engine_cycles, log.trip_reason || 'N/A', `"${(log.pax_info || '').replace(/"/g, '""')}"`].join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = window.URL.createObjectURL(blob); a.download = `${aircraft.tail_number}_Flight_Logs.csv`; a.click();
    setIsExporting(false);
  };

  const submitFlightLog = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    const insertData: any = { aircraft_id: aircraft.id, user_id: session.user.id, engine_cycles: parseInt(logCycles), landings: parseInt(logLandings), initials: logInitials.toUpperCase(), pax_info: logPax || null, trip_reason: logReason || null };
    const updateData: any = {};

    if (isTurbine) {
      insertData.aftt = parseFloat(logAftt); insertData.ftt = parseFloat(logFtt);
      updateData.total_airframe_time = parseFloat(logAftt); updateData.total_engine_time = parseFloat(logFtt);
    } else {
      insertData.tach = parseFloat(logTach); updateData.total_engine_time = parseFloat(logTach);
      if (logHobbs) { insertData.hobbs = parseFloat(logHobbs); updateData.total_airframe_time = parseFloat(logHobbs); }
    }

    await supabase.from('aft_flight_logs').insert(insertData);
    await supabase.from('aft_aircraft').update(updateData).eq('id', aircraft.id);

    setLogPage(1); 
    await fetchFlightLogs(aircraft.id, 1); 
    onUpdate(); // Tells the main page to refresh the aircraft times
    
    setLogAftt(""); setLogFtt(""); setLogHobbs(""); setLogTach(""); setLogCycles(""); setLogLandings(""); setLogInitials(""); setLogPax(""); setLogReason("");
    setIsSubmitting(false);
  };

  if (!aircraft) return null;

  return (
    <>
      {/* LOGBOOK TABLE */}
      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-brandOrange overflow-hidden flex flex-col mb-6">
        <div className="flex justify-between items-end mb-6">
          <div><span className="text-[10px] font-bold uppercase tracking-widest text-brandOrange block mb-1">{isTurbine ? 'TURBINE' : 'PISTON'} LOGBOOK</span><h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Flight Log</h2></div>
          <button onClick={exportCSV} disabled={isExporting} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-brandOrange hover:text-brandOrange-alt transition-colors disabled:opacity-50"><Download size={14} /> {isExporting ? "Exporting..." : "Export CSV"}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead><tr className="border-b-2 border-navy text-[10px] font-bold uppercase tracking-widest text-gray-500"><th className="pb-2 pr-4">Date</th><th className="pb-2 pr-4">Init</th><th className="pb-2 pr-4">{isTurbine ? 'AFTT' : 'Hobbs'}</th><th className="pb-2 pr-4">{isTurbine ? 'FTT' : 'Tach'}</th><th className="pb-2 pr-4">Lndg</th><th className="pb-2 pr-4">Cyc</th><th className="pb-2 pr-4">Rsn</th><th className="pb-2">Pax</th></tr></thead>
            <tbody className="text-xs font-roboto text-navy">
              {flightLogs.length === 0 ? (<tr><td colSpan={8} className="py-8 text-center text-gray-400 italic">No logs found.</td></tr>) : (
                flightLogs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-200 hover:bg-orange-50/50 transition-colors">
                    <td className="py-3 pr-4 whitespace-nowrap">{new Date(log.created_at).toLocaleDateString()}</td><td className="py-3 pr-4 font-bold">{log.initials}</td>
                    <td className="py-3 pr-4">{isTurbine ? log.aftt?.toFixed(1) : log.hobbs?.toFixed(1) || '-'}</td><td className="py-3 pr-4">{isTurbine ? log.ftt?.toFixed(1) : log.tach?.toFixed(1)}</td>
                    <td className="py-3 pr-4">{log.landings}</td><td className="py-3 pr-4">{log.engine_cycles}</td><td className="py-3 pr-4">{log.trip_reason || "-"}</td><td className="py-3 truncate max-w-[100px]" title={log.pax_info}>{log.pax_info || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {flightLogs.length > 0 && (
          <div className="flex justify-between items-center mt-4 border-t border-gray-200 pt-4">
            <button onClick={() => setLogPage(p => Math.max(1, p - 1))} disabled={logPage === 1} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-brandOrange"><ChevronLeft size={14} /> Prev</button>
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Page {logPage}</span>
            <button onClick={() => setLogPage(p => p + 1)} disabled={!hasMoreLogs} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-brandOrange">Next <ChevronRight size={14} /></button>
          </div>
        )}
      </div>

      {/* ACTION FORM */}
      <div className="bg-white border border-gray-200 shadow-sm rounded p-5">
        <h3 className="font-oswald font-bold uppercase text-lg mb-4 text-navy flex items-center gap-2"><Plus size={18} className="text-brandOrange"/> Log New Flight</h3>
        <form onSubmit={submitFlightLog} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {isTurbine ? (
              <>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">New AFTT <span className="text-red-500">*</span></label><input type="number" step="0.1" required value={logAftt} onChange={e => setLogAftt(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none" placeholder={aircraft?.total_airframe_time} /></div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">New FTT <span className="text-red-500">*</span></label><input type="number" step="0.1" required value={logFtt} onChange={e => setLogFtt(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none" placeholder={aircraft?.total_engine_time} /></div>
              </>
            ) : (
              <>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">New Hobbs <span className="text-gray-400 font-normal lowercase">(Opt)</span></label><input type="number" step="0.1" value={logHobbs} onChange={e => setLogHobbs(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none" placeholder={aircraft?.total_airframe_time} /></div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">New Tach <span className="text-red-500">*</span></label><input type="number" step="0.1" required value={logTach} onChange={e => setLogTach(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none" placeholder={aircraft?.total_engine_time} /></div>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Landings</label><input type="number" required value={logLandings} onChange={e => setLogLandings(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none" placeholder="0" /></div>
            <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Engine Cycles</label><input type="number" required value={logCycles} onChange={e => setLogCycles(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none" placeholder="0" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Initials</label><input type="text" maxLength={3} required value={logInitials} onChange={e => setLogInitials(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none uppercase" placeholder="ABC" /></div>
            <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Reason (Opt)</label><select value={logReason} onChange={e => setLogReason(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none bg-white"><option value="">Select...</option><option value="PE">PE - Personal</option><option value="BE">BE - Business</option><option value="MX">MX - Maintenance</option><option value="T">T - Training</option></select></div>
          </div>
          <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Passengers (Opt)</label><input type="text" value={logPax} onChange={e => setLogPax(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none" placeholder="Names or notes..." /></div>
          <div className="pt-2"><PrimaryButton>{isSubmitting ? "Saving..." : "Submit Log Entry"}</PrimaryButton></div>
        </form>
      </div>
    </>
  );
}
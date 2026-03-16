import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Wrench, Trash2 } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";

export default function MaintenanceTab({ aircraft, role, onGroundedStatusChange }: { aircraft: any, role: string, onGroundedStatusChange: (isGrounded: boolean) => void }) {
  const[mxItems, setMxItems] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [mxName, setMxName] = useState("");
  const[mxIsRequired, setMxIsRequired] = useState(true);
  const [mxTrackingType, setMxTrackingType] = useState<'time' | 'date'>('time');
  const [mxLastTime, setMxLastTime] = useState("");
  const [mxIntervalTime, setMxIntervalTime] = useState("");
  const[mxDueTime, setMxDueTime] = useState("");
  const [mxLastDate, setMxLastDate] = useState("");
  const [mxIntervalDays, setMxIntervalDays] = useState("");
  const[mxDueDate, setMxDueDate] = useState("");

  const isTurbine = aircraft?.engine_type === 'Turbine';
  const currentEngineTime = aircraft?.total_engine_time || 0;

  useEffect(() => {
    if (aircraft) fetchMxItems(aircraft.id);
  }, [aircraft?.id]);

  const fetchMxItems = async (aircraftId: string) => {
    const { data } = await supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraftId).order('due_date').order('due_time');
    if (data) {
      setMxItems(data);
      checkCompliance(data);
    }
  };

  const checkCompliance = (items: any[]) => {
    const isGrounded = items.some(item => {
      if (!item.is_required) return false;
      if (item.tracking_type === 'time') return item.due_time <= currentEngineTime;
      if (item.tracking_type === 'date') {
        const dueDate = new Date(item.due_date + 'T00:00:00');
        const today = new Date(); today.setHours(0,0,0,0);
        return dueDate < today;
      }
      return false;
    });
    onGroundedStatusChange(isGrounded);
  };

  const submitMxItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    let finalDueTime = null;
    let finalDueDate = null;

    if (mxTrackingType === 'time') {
      finalDueTime = mxIntervalTime ? parseFloat(mxLastTime) + parseFloat(mxIntervalTime) : parseFloat(mxDueTime);
    } else {
      if (mxIntervalDays) {
        const d = new Date(mxLastDate);
        d.setDate(d.getDate() + parseInt(mxIntervalDays));
        finalDueDate = d.toISOString().split('T')[0];
      } else {
        finalDueDate = mxDueDate;
      }
    }

    await supabase.from('aft_maintenance_items').insert({
      aircraft_id: aircraft.id,
      item_name: mxName,
      tracking_type: mxTrackingType,
      is_required: mxIsRequired,
      last_completed_time: mxLastTime ? parseFloat(mxLastTime) : null,
      time_interval: mxIntervalTime ? parseFloat(mxIntervalTime) : null,
      due_time: finalDueTime,
      last_completed_date: mxLastDate || null,
      date_interval_days: mxIntervalDays ? parseInt(mxIntervalDays) : null,
      due_date: finalDueDate
    });

    await fetchMxItems(aircraft.id);
    setMxName(""); setMxLastTime(""); setMxIntervalTime(""); setMxDueTime(""); setMxLastDate(""); setMxIntervalDays(""); setMxDueDate("");
    setIsSubmitting(false);
  };

  const deleteMxItem = async (id: string) => {
    if (confirm("Delete this maintenance item?")) {
      await supabase.from('aft_maintenance_items').delete().eq('id', id);
      fetchMxItems(aircraft.id);
    }
  };

  if (!aircraft) return null;

  // Re-calculate local grounded status for UI colors
  const isGroundedLocally = mxItems.some(item => {
    if (!item.is_required) return false;
    if (item.tracking_type === 'time') return item.due_time <= currentEngineTime;
    if (item.tracking_type === 'date') return new Date(item.due_date + 'T00:00:00') < new Date(new Date().setHours(0,0,0,0));
    return false;
  });

  return (
    <>
      <div className={`bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 mb-6 ${isGroundedLocally ? 'border-red-600' : 'border-success'}`}>
        <div className="flex justify-between items-end mb-6">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">COMPLIANCE DASHBOARD</span>
            <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Maintenance</h2>
          </div>
          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded ${isGroundedLocally ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
            {isGroundedLocally ? 'GROUNDED' : 'AIRWORTHY'}
          </span>
        </div>

        <div className="space-y-3">
          {mxItems.length === 0 ? (<p className="text-center text-sm text-gray-400 italic py-4">No maintenance items tracked.</p>) : (
            mxItems.map(item => {
              let isExpired = false; let dueText = "";
              if (item.tracking_type === 'time') {
                const remaining = (item.due_time - currentEngineTime).toFixed(1);
                isExpired = parseFloat(remaining) <= 0;
                dueText = isExpired ? `Expired by ${Math.abs(parseFloat(remaining))} hrs` : `Due in ${remaining} hrs (@ ${item.due_time})`;
              } else {
                const diffTime = new Date(item.due_date + 'T00:00:00').getTime() - new Date(new Date().setHours(0,0,0,0)).getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                isExpired = diffDays < 0;
                dueText = isExpired ? `Expired ${Math.abs(diffDays)} days ago` : `Due in ${diffDays} days (${item.due_date})`;
              }
              const colorClass = isExpired ? (item.is_required ? 'text-red-600 bg-red-50 border-red-200' : 'text-orange-600 bg-orange-50 border-orange-200') : 'text-navy bg-white border-gray-200';

              return (
                <div key={item.id} className={`p-4 border rounded flex justify-between items-center ${colorClass}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-oswald font-bold uppercase text-sm">{item.item_name}</h4>
                      {!item.is_required && <span className="text-[8px] border border-current px-1 rounded uppercase tracking-widest opacity-70">Optional</span>}
                    </div>
                    <p className="text-xs mt-1 font-roboto font-bold">{dueText}</p>
                  </div>
                  {role === 'admin' && <button onClick={() => deleteMxItem(item.id)} className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={16}/></button>}
                </div>
              );
            })
          )}
        </div>
      </div>

      {role === 'admin' ? (
        <div className="bg-white border border-gray-200 shadow-sm rounded p-5">
          <h3 className="font-oswald font-bold uppercase text-lg mb-4 text-navy flex items-center gap-2"><Wrench size={18} className="text-brandOrange"/> Track New Item</h3>
          <form onSubmit={submitMxItem} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Item Name <span className="text-red-500">*</span></label><input type="text" required value={mxName} onChange={e=>setMxName(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none" placeholder="e.g. Annual Inspection" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Required?</label><select value={mxIsRequired ? "yes" : "no"} onChange={e=>setMxIsRequired(e.target.value === "yes")} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-brandOrange outline-none bg-white"><option value="yes">Yes</option><option value="no">Optional</option></select></div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy block mb-2">Tracking Method</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm font-bold text-navy"><input type="radio" checked={mxTrackingType==='time'} onChange={()=>setMxTrackingType('time')} /> Track by Time</label>
                <label className="flex items-center gap-2 text-sm font-bold text-navy"><input type="radio" checked={mxTrackingType==='date'} onChange={()=>setMxTrackingType('date')} /> Track by Date</label>
              </div>
            </div>
            {mxTrackingType === 'time' ? (
              <div className="bg-gray-50 p-4 rounded border border-gray-200 grid grid-cols-2 gap-4">
                <div className="col-span-2"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Last Completed ({isTurbine ? 'FTT' : 'Tach'}) <span className="text-red-500">*</span></label><input type="number" step="0.1" required value={mxLastTime} onChange={e=>setMxLastTime(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" /></div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Interval (Hrs)</label><input type="number" step="0.1" value={mxIntervalTime} onChange={e=>setMxIntervalTime(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" /></div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">OR Exact Due Time</label><input type="number" step="0.1" required={!mxIntervalTime} value={mxDueTime} onChange={e=>setMxDueTime(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" /></div>
              </div>
            ) : (
              <div className="bg-gray-50 p-4 rounded border border-gray-200 grid grid-cols-2 gap-4">
                <div className="col-span-2"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Last Completed Date <span className="text-red-500">*</span></label><input type="date" required value={mxLastDate} onChange={e=>setMxLastDate(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" /></div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Interval (Days)</label><input type="number" value={mxIntervalDays} onChange={e=>setMxIntervalDays(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" /></div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">OR Exact Due Date</label><input type="date" required={!mxIntervalDays} value={mxDueDate} onChange={e=>setMxDueDate(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" /></div>
              </div>
            )}
            <div className="pt-2"><PrimaryButton>{isSubmitting ? "Saving..." : "Add Maintenance Item"}</PrimaryButton></div>
          </form>
        </div>
      ) : (
        <div className="bg-gray-100 text-gray-500 text-center py-4 rounded border border-gray-200 text-xs font-bold uppercase tracking-widest">Only administrators can add maintenance items.</div>
      )}
    </>
  );
}
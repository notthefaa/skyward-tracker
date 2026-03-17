import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Wrench, Trash2, Plus, X, Edit2 } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";

export default function MaintenanceTab({ aircraft, role, onGroundedStatusChange }: { aircraft: any, role: string, onGroundedStatusChange: (isGrounded: boolean) => void }) {
  const [mxItems, setMxItems] = useState<any[]>([]);
  const[showMxModal, setShowMxModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mxName, setMxName] = useState("");
  const[mxIsRequired, setMxIsRequired] = useState(true);
  const[mxTrackingType, setMxTrackingType] = useState<'time' | 'date'>('time');
  const[mxLastTime, setMxLastTime] = useState("");
  const [mxIntervalTime, setMxIntervalTime] = useState("");
  const [mxDueTime, setMxDueTime] = useState("");
  const[mxLastDate, setMxLastDate] = useState("");
  const [mxIntervalDays, setMxIntervalDays] = useState("");
  const [mxDueDate, setMxDueDate] = useState("");

  const isTurbine = aircraft?.engine_type === 'Turbine';
  const currentEngineTime = aircraft?.total_engine_time || 0;

  useEffect(() => { if (aircraft) fetchMxItems(aircraft.id); }, [aircraft?.id]);

  const fetchMxItems = async (aircraftId: string) => {
    const { data } = await supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraftId).order('due_date').order('due_time');
    if (data) { setMxItems(data); checkCompliance(data); }
  };

  const checkCompliance = (items: any[]) => {
    const isGrounded = items.some(item => {
      if (!item.is_required) return false;
      if (item.tracking_type === 'time') return item.due_time <= currentEngineTime;
      if (item.tracking_type === 'date') return new Date(item.due_date + 'T00:00:00') < new Date(new Date().setHours(0,0,0,0));
      return false;
    });
    onGroundedStatusChange(isGrounded);
  };

  const openMxForm = (item: any = null) => {
    if (item) {
      setEditingId(item.id); setMxName(item.item_name); setMxIsRequired(item.is_required); setMxTrackingType(item.tracking_type);
      setMxLastTime(item.last_completed_time || ""); setMxIntervalTime(item.time_interval || ""); setMxDueTime(item.due_time || "");
      setMxLastDate(item.last_completed_date || ""); setMxIntervalDays(item.date_interval_days || ""); setMxDueDate(item.due_date || "");
    } else {
      setEditingId(null); setMxName(""); setMxIsRequired(true); setMxTrackingType('time');
      setMxLastTime(""); setMxIntervalTime(""); setMxDueTime(""); setMxLastDate(""); setMxIntervalDays(""); setMxDueDate("");
    }
    setShowMxModal(true);
  };

  const submitMxItem = async (e: React.FormEvent) => {
    e.preventDefault(); setIsSubmitting(true);
    let finalDueTime = null; let finalDueDate = null;

    if (mxTrackingType === 'time') {
      finalDueTime = mxIntervalTime ? parseFloat(mxLastTime) + parseFloat(mxIntervalTime) : parseFloat(mxDueTime);
    } else {
      if (mxIntervalDays) {
        const d = new Date(mxLastDate); d.setDate(d.getDate() + parseInt(mxIntervalDays)); finalDueDate = d.toISOString().split('T')[0];
      } else { finalDueDate = mxDueDate; }
    }

    const payload = {
      aircraft_id: aircraft.id, item_name: mxName, tracking_type: mxTrackingType, is_required: mxIsRequired,
      last_completed_time: mxLastTime ? parseFloat(mxLastTime) : null, time_interval: mxIntervalTime ? parseFloat(mxIntervalTime) : null, due_time: finalDueTime,
      last_completed_date: mxLastDate || null, date_interval_days: mxIntervalDays ? parseInt(mxIntervalDays) : null, due_date: finalDueDate
    };

    if (editingId) await supabase.from('aft_maintenance_items').update(payload).eq('id', editingId);
    else await supabase.from('aft_maintenance_items').insert(payload);

    await fetchMxItems(aircraft.id);
    setShowMxModal(false); setIsSubmitting(false);
  };

  const deleteMxItem = async (id: string) => {
    if (confirm("Delete this maintenance item?")) { await supabase.from('aft_maintenance_items').delete().eq('id', id); fetchMxItems(aircraft.id); }
  };

  if (!aircraft) return null;

  return (
    <>
      {role === 'admin' && (<div className="mb-2"><PrimaryButton onClick={() => openMxForm()}><Plus size={18} /> Track New MX Item</PrimaryButton></div>)}
      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 mb-6 border-navy">
        <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 mb-6 leading-none">Maintenance</h2>
        <div className="space-y-3">
          {mxItems.length === 0 ? (<p className="text-center text-sm text-gray-400 italic py-4">No maintenance items tracked.</p>) : (
            mxItems.map(item => {
              let isExpired = false; let dueText = "";
              if (item.tracking_type === 'time') {
                const remaining = (item.due_time - currentEngineTime).toFixed(1); isExpired = parseFloat(remaining) <= 0;
                dueText = isExpired ? `Expired by ${Math.abs(parseFloat(remaining))} hrs` : `Due in ${remaining} hrs (@ ${item.due_time})`;
              } else {
                const diffTime = new Date(item.due_date + 'T00:00:00').getTime() - new Date(new Date().setHours(0,0,0,0)).getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); isExpired = diffDays < 0;
                dueText = isExpired ? `Expired ${Math.abs(diffDays)} days ago` : `Due in ${diffDays} days (${item.due_date})`;
              }
              const colorClass = isExpired ? (item.is_required ? 'text-red-600 bg-red-50 border-red-200' : 'text-orange-600 bg-orange-50 border-orange-200') : 'text-navy bg-white border-gray-200';

              return (
                <div key={item.id} className={`p-4 border rounded flex justify-between items-center ${colorClass}`}>
                  <div>
                    <div className="flex items-center gap-2"><h4 className="font-oswald font-bold uppercase text-sm">{item.item_name}</h4>{!item.is_required && <span className="text-[8px] border border-current px-1 rounded uppercase tracking-widest opacity-70">Optional</span>}</div>
                    <p className="text-xs mt-1 font-roboto font-bold">{dueText}</p>
                  </div>
                  {role === 'admin' && (
                    <div className="flex gap-3">
                      <button onClick={() => openMxForm(item)} className="text-gray-400 hover:text-[#F08B46] transition-colors"><Edit2 size={16}/></button>
                      <button onClick={() => deleteMxItem(item.id)} className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={16}/></button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {showMxModal && role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-[#F08B46] max-h-[90vh] overflow-y-auto animate-slide-up">
            <div className="flex justify-between items-center mb-6"><h2 className="font-oswald text-2xl font-bold uppercase text-navy">{editingId ? 'Edit MX Item' : 'Track New Item'}</h2><button onClick={() => setShowMxModal(false)} className="text-gray-400 hover:text-red-500 transition-colors"><X size={24}/></button></div>
            <form onSubmit={submitMxItem} className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Item Name *</label><input type="text" required value={mxName} onChange={e=>setMxName(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Required?</label><select value={mxIsRequired ? "yes" : "no"} onChange={e=>setMxIsRequired(e.target.value === "yes")} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white"><option value="yes">Yes</option><option value="no">Optional</option></select></div>
              </div>
              <div className="pt-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy block mb-2">Tracking Method</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm font-bold text-navy"><input type="radio" checked={mxTrackingType==='time'} onChange={()=>setMxTrackingType('time')} /> Track by Time</label>
                  <label className="flex items-center gap-2 text-sm font-bold text-navy"><input type="radio" checked={mxTrackingType==='date'} onChange={()=>setMxTrackingType('date')} /> Track by Date</label>
                </div>
              </div>
              {mxTrackingType === 'time' ? (
                <div className="bg-gray-50 p-4 rounded border border-gray-200 grid grid-cols-2 gap-4">
                  <div className="col-span-2"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Last Completed ({isTurbine ? 'FTT' : 'Tach'}) *</label><input type="number" step="0.1" required value={mxLastTime} onChange={e=>setMxLastTime(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1" /></div>
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Interval (Hrs)</label><input type="number" step="0.1" value={mxIntervalTime} onChange={e=>setMxIntervalTime(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1" /></div>
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">OR Exact Due Time</label><input type="number" step="0.1" required={!mxIntervalTime} value={mxDueTime} onChange={e=>setMxDueTime(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1" /></div>
                </div>
              ) : (
                <div className="bg-gray-50 p-4 rounded border border-gray-200 grid grid-cols-2 gap-4">
                  <div className="col-span-2"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Last Completed Date *</label><input type="date" required value={mxLastDate} onChange={e=>setMxLastDate(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1" /></div>
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Interval (Days)</label><input type="number" value={mxIntervalDays} onChange={e=>setMxIntervalDays(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1" /></div>
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">OR Exact Due Date</label><input type="date" required={!mxIntervalDays} value={mxDueDate} onChange={e=>setMxDueDate(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1" /></div>
                </div>
              )}
              <div className="pt-4"><PrimaryButton>{isSubmitting ? "Saving..." : "Save Maintenance Item"}</PrimaryButton></div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
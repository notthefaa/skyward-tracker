import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { processMxItem, getMxTextColor, isMxExpired } from "@/lib/math";
import type { AircraftWithMetrics, SystemSettings } from "@/lib/types";
import useSWR from "swr";
import { Wrench, Trash2, Plus, X, Edit2, Calendar, Send, ExternalLink, ChevronRight } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import ServiceEventModal from "@/components/modals/ServiceEventModal";

export default function MaintenanceTab({ 
  aircraft, 
  role, 
  onGroundedStatusChange,
  sysSettings 
}: { 
  aircraft: AircraftWithMetrics | null, 
  role: string, 
  onGroundedStatusChange: () => void,
  sysSettings: SystemSettings
}) {
  const currentEngineTime = aircraft?.total_engine_time || 0;

  const { data: mxItems = [], mutate } = useSWR(
    aircraft ? `mx-${aircraft.id}` : null,
    async () => {
      const { data } = await supabase
        .from('aft_maintenance_items')
        .select('*')
        .eq('aircraft_id', aircraft!.id)
        .order('due_date')
        .order('due_time');
      return (data || []) as any[];
    }
  );

  // Fetch active maintenance events for this aircraft
  const { data: activeEvents = [], mutate: mutateEvents } = useSWR(
    aircraft ? `mx-events-${aircraft.id}` : null,
    async () => {
      const { data } = await supabase
        .from('aft_maintenance_events')
        .select('*')
        .eq('aircraft_id', aircraft!.id)
        .in('status', ['draft', 'scheduling', 'confirmed', 'in_progress'])
        .order('created_at', { ascending: false });
      return (data || []) as any[];
    }
  );

  const isGroundedLocally = mxItems.some((item: any) => isMxExpired(item, currentEngineTime));

  const [showMxModal, setShowMxModal] = useState(false);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendingEventId, setResendingEventId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [mxName, setMxName] = useState("");
  const [mxIsRequired, setMxIsRequired] = useState(true);
  const [mxTrackingType, setMxTrackingType] = useState<'time' | 'date'>('time');
  const [mxLastTime, setMxLastTime] = useState("");
  const [mxIntervalTime, setMxIntervalTime] = useState("");
  const [mxDueTime, setMxDueTime] = useState("");
  const [mxLastDate, setMxLastDate] = useState("");
  const [mxIntervalDays, setMxIntervalDays] = useState("");
  const [mxDueDate, setMxDueDate] = useState("");
  const [automateScheduling, setAutomateScheduling] = useState(false);

  const isTurbine = aircraft?.engine_type === 'Turbine';

  const handleManualMxTrigger = async (item: any) => {
    setIsSubmitting(true);
    try {
      await authFetch('/api/emails/mx-schedule', {
        method: 'POST',
        body: JSON.stringify({ aircraft, mxItem: item })
      });
      await mutate();
    } catch (e) {
      alert("Failed to send email");
    }
    setIsSubmitting(false);
  };

  const handleResendWorkpackage = async (eventId: string) => {
    setResendingEventId(eventId);
    try {
      const res = await authFetch('/api/mx-events/send-workpackage', {
        method: 'POST',
        body: JSON.stringify({ eventId, additionalMxItemIds: [], additionalSquawkIds: [], addonServices: [], resend: true })
      });
      if (!res.ok) throw new Error('Failed');
      alert("Work package resent successfully.");
      await mutateEvents();
    } catch (err) {
      alert("Failed to resend work package.");
    }
    setResendingEventId(null);
  };

  const openMxForm = (item: any = null) => {
    if (item) {
      setEditingId(item.id); setMxName(item.item_name); setMxIsRequired(item.is_required); setMxTrackingType(item.tracking_type);
      setMxLastTime(item.last_completed_time?.toString() || ""); setMxIntervalTime(item.time_interval?.toString() || ""); setMxDueTime(item.due_time?.toString() || "");
      setMxLastDate(item.last_completed_date || ""); setMxIntervalDays(item.date_interval_days?.toString() || ""); setMxDueDate(item.due_date || "");
      setAutomateScheduling(item.automate_scheduling || false);
    } else {
      setEditingId(null); setMxName(""); setMxIsRequired(true); setMxTrackingType('time');
      setMxLastTime(""); setMxIntervalTime(""); setMxDueTime(""); setMxLastDate(""); setMxIntervalDays(""); setMxDueDate("");
      setAutomateScheduling(false);
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

    const payload: any = {
      aircraft_id: aircraft!.id, item_name: mxName, tracking_type: mxTrackingType, is_required: mxIsRequired,
      last_completed_time: mxLastTime ? parseFloat(mxLastTime) : null, time_interval: mxIntervalTime ? parseFloat(mxIntervalTime) : null, due_time: finalDueTime,
      last_completed_date: mxLastDate || null, date_interval_days: mxIntervalDays ? parseInt(mxIntervalDays) : null, due_date: finalDueDate,
      automate_scheduling: automateScheduling
    };

    if (editingId) {
      await supabase.from('aft_maintenance_items').update(payload).eq('id', editingId);
    } else {
      await supabase.from('aft_maintenance_items').insert(payload);
      if (automateScheduling) {
        try {
          await authFetch('/api/emails/mx-schedule', {
            method: 'POST',
            body: JSON.stringify({ aircraft, mxItem: payload })
          });
        } catch (err) { console.error("Failed to send MX scheduling email", err); }
      }
    }

    await mutate();
    onGroundedStatusChange();
    setShowMxModal(false); setIsSubmitting(false);
  };

  const deleteMxItem = async (id: string) => {
    if (confirm("Delete this maintenance item?")) { 
      await supabase.from('aft_maintenance_items').delete().eq('id', id); 
      await mutate(); 
      onGroundedStatusChange();
    }
  };

  if (!aircraft) return null;

  const statusLabel = (s: string) => {
    if (s === 'draft') return 'Draft — Review & Send';
    if (s === 'scheduling') return 'Scheduling';
    if (s === 'confirmed') return 'Confirmed';
    if (s === 'in_progress') return 'In Progress';
    return s;
  };

  const statusColor = (s: string) => {
    if (s === 'draft') return 'bg-[#F08B46]';
    if (s === 'scheduling') return 'bg-gray-500';
    if (s === 'confirmed') return 'bg-[#3AB0FF]';
    if (s === 'in_progress') return 'bg-[#56B94A]';
    return 'bg-gray-400';
  };

  return (
    <>
      {role === 'admin' && (
        <div className="mb-2 flex gap-2">
          <div className="flex-1">
            <PrimaryButton onClick={() => openMxForm()}>
              <Plus size={18} /> Track New MX Item
            </PrimaryButton>
          </div>
          <div className="flex-1">
            <button 
              onClick={() => setShowServiceModal(true)}
              className="w-full bg-[#F08B46] text-white font-oswald tracking-widest uppercase py-3 px-4 rounded hover:bg-opacity-90 active:scale-95 transition-all duration-150 ease-out flex justify-center items-center gap-2 text-sm"
            >
              <Calendar size={18} /> Schedule Service
            </button>
          </div>
        </div>
      )}

      <ServiceEventModal 
        aircraft={aircraft} 
        show={showServiceModal} 
        onClose={() => { setShowServiceModal(false); mutateEvents(); }} 
        onRefresh={() => { mutate(); mutateEvents(); }}
      />

      {/* ACTIVE EVENTS BANNER — visible directly on the MX tab */}
      {activeEvents.length > 0 && (
        <div className="mb-4 space-y-2">
          {activeEvents.map(ev => (
            <div key={ev.id} className={`bg-white shadow-lg rounded-sm p-4 border-t-4 ${ev.status === 'draft' ? 'border-[#F08B46]' : ev.status === 'confirmed' ? 'border-[#3AB0FF]' : ev.status === 'in_progress' ? 'border-[#56B94A]' : 'border-gray-400'}`}>
              <div className="flex justify-between items-start">
                <div>
                  <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white ${statusColor(ev.status)}`}>
                    {statusLabel(ev.status)}
                  </span>
                  <p className="font-oswald font-bold text-navy text-sm mt-2">
                    {ev.status === 'draft' ? 'Work Package Ready for Review'
                      : ev.confirmed_date ? `Service: ${ev.confirmed_date}`
                      : ev.proposed_date ? `Proposed: ${ev.proposed_date} (by ${ev.proposed_by})`
                      : 'Awaiting Date'}
                  </p>
                  {ev.estimated_completion && (
                    <p className="text-[10px] text-gray-500 mt-1">Est. completion: {ev.estimated_completion}</p>
                  )}
                  <p className="text-[10px] text-gray-400 mt-1">MX Contact: {ev.mx_contact_name || 'N/A'}</p>
                </div>
                <div className="flex flex-col gap-2 items-end shrink-0 ml-3">
                  <button
                    onClick={() => setShowServiceModal(true)}
                    className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] hover:underline flex items-center gap-1"
                  >
                    View <ChevronRight size={12} />
                  </button>
                  {ev.status !== 'draft' && (
                    <button
                      onClick={() => handleResendWorkpackage(ev.id)}
                      disabled={resendingEventId === ev.id}
                      className="text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-[#F08B46] flex items-center gap-1 disabled:opacity-50"
                    >
                      <Send size={10} /> {resendingEventId === ev.id ? 'Sending...' : 'Resend'}
                    </button>
                  )}
                  {ev.access_token && ev.status !== 'draft' && (
                    <a
                      href={`/service/${ev.access_token}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-[#3AB0FF] flex items-center gap-1"
                    >
                      <ExternalLink size={10} /> Portal
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      
      <div className={`bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 mb-6 ${isGroundedLocally ? 'border-[#CE3732]' : 'border-[#F08B46]'}`}>
        <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 mb-6 leading-none">Maintenance</h2>
        
        <div className="space-y-3">
          {mxItems.length === 0 ? (
            <p className="text-center text-sm text-gray-400 italic py-4">No maintenance items tracked.</p>
          ) : (
            mxItems.map((item) => {
              const processed = processMxItem(item, currentEngineTime, aircraft.burnRate, aircraft.burnRateLow, aircraft.burnRateHigh);
              const dueTextColor = getMxTextColor(processed, sysSettings);
              const containerColorClass = processed.isExpired 
                ? (item.is_required ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200') 
                : 'bg-white border-gray-200';

              return (
                <div key={item.id} className={`p-4 border rounded flex justify-between items-center ${containerColorClass}`}>
                  <div className="w-full">
                    <div className="flex items-center gap-2">
                      <h4 className={`font-oswald font-bold uppercase text-sm ${processed.isExpired ? 'text-[#CE3732]' : 'text-navy'}`}>{item.item_name}</h4>
                      {!item.is_required && (
                        <span className={`text-[8px] border px-1 rounded uppercase tracking-widest opacity-70 ${processed.isExpired ? 'border-[#CE3732] text-[#CE3732]' : 'border-navy text-navy'}`}>Optional</span>
                      )}
                    </div>
                    <p className={`text-xs mt-1 font-roboto font-bold ${dueTextColor}`}>{processed.dueText}</p>
                    {item.primary_heads_up_sent && !item.mx_schedule_sent && (
                      <div className="mt-3 bg-red-50 border border-red-200 p-3 rounded w-full max-w-sm">
                        <p className="text-[10px] text-[#CE3732] font-bold uppercase mb-2 leading-tight">Action Required: Projected MX Due<br/>(System Confidence: {aircraft.confidenceScore || 0}%)</p>
                        <button onClick={() => handleManualMxTrigger(item)} disabled={isSubmitting} className="w-full bg-[#CE3732] text-white text-[10px] font-bold uppercase px-3 py-2 rounded shadow active:scale-95 transition-transform disabled:opacity-50">
                          {isSubmitting ? "Processing..." : "Approve & Email Mechanic"}
                        </button>
                      </div>
                    )}
                  </div>
                  {role === 'admin' && (
                    <div className="flex gap-3 pl-4">
                      <button onClick={() => openMxForm(item)} className="text-gray-400 hover:text-[#F08B46] transition-colors active:scale-95"><Edit2 size={16}/></button>
                      <button onClick={() => deleteMxItem(item.id)} className="text-gray-400 hover:text-[#CE3732] transition-colors active:scale-95"><Trash2 size={16}/></button>
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
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy">{editingId ? 'Edit MX Item' : 'Track New Item'}</h2>
              <button onClick={() => setShowMxModal(false)} className="text-gray-400 hover:text-[#CE3732] transition-colors"><X size={24}/></button>
            </div>
            <form onSubmit={submitMxItem} className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 min-w-0">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Item Name *</label>
                  <input type="text" required value={mxName} onChange={e=>setMxName(e.target.value)} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" placeholder="e.g. Annual Inspection" />
                </div>
                <div className="min-w-0">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Required?</label>
                  <select value={mxIsRequired ? "yes" : "no"} onChange={e=>setMxIsRequired(e.target.value === "yes")} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white">
                    <option value="yes">Yes</option><option value="no">Optional</option>
                  </select>
                </div>
              </div>
              <div className="pt-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy block mb-2">Tracking Method</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm font-bold text-navy cursor-pointer"><input type="radio" checked={mxTrackingType==='time'} onChange={()=>setMxTrackingType('time')} /> Track by Time</label>
                  <label className="flex items-center gap-2 text-sm font-bold text-navy cursor-pointer"><input type="radio" checked={mxTrackingType==='date'} onChange={()=>setMxTrackingType('date')} /> Track by Date</label>
                </div>
              </div>
              {mxTrackingType === 'time' ? (
                <div className="bg-gray-50 p-3 md:p-4 rounded border border-gray-200 flex flex-col gap-4">
                  <div className="w-full min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Last Completed ({isTurbine ? 'FTT' : 'Tach'}) *</label>
                    <input type="number" step="0.1" required value={mxLastTime} onChange={e=>setMxLastTime(e.target.value)} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 w-full min-w-0">
                    <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Interval (Hrs)</label><input type="number" step="0.1" value={mxIntervalTime} onChange={e=>setMxIntervalTime(e.target.value)} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
                    <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">OR Exact Due</label><input type="number" step="0.1" required={!mxIntervalTime} value={mxDueTime} onChange={e=>setMxDueTime(e.target.value)} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
                  </div>
                </div>
              ) : (
                <div className="bg-gray-50 p-3 md:p-4 rounded border border-gray-200 flex flex-col gap-4">
                  <div className="w-full min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Last Completed Date *</label>
                    <input type="date" required value={mxLastDate} onChange={e=>setMxLastDate(e.target.value)} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 w-full min-w-0">
                    <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Interval (Days)</label><input type="number" value={mxIntervalDays} onChange={e=>setMxIntervalDays(e.target.value)} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
                    <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">OR Exact Due</label><input type="date" required={!mxIntervalDays} value={mxDueDate} onChange={e=>setMxDueDate(e.target.value)} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
                  </div>
                </div>
              )}
              {!editingId && (
                <div className="pt-2 pb-2">
                  <label className="flex items-start gap-2 text-xs font-bold text-navy cursor-pointer">
                    <input type="checkbox" checked={automateScheduling} onChange={e=>setAutomateScheduling(e.target.checked)} className="mt-0.5 w-4 h-4 text-[#F08B46] border-gray-300 rounded focus:ring-[#F08B46] cursor-pointer shrink-0" />
                    <span className="flex flex-col">
                      <span>Automate MX Communication</span>
                      <span className="text-[10px] text-gray-500 font-normal mt-1 leading-tight">Emails the MX contact when the item crosses global thresholds. Time-based items will use historical flight data to predict scheduling needs.</span>
                    </span>
                  </label>
                </div>
              )}
              <div className="pt-4"><PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Maintenance Item"}</PrimaryButton></div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { processMxItem, getMxTextColor, isMxExpired } from "@/lib/math";
import type { AircraftWithMetrics, SystemSettings, AircraftRole, MxSubTab } from "@/lib/types";
import useSWR from "swr";
import { Wrench, Trash2, Plus, X, Edit2, Calendar, Send, ExternalLink, ChevronRight, HelpCircle, AlertTriangle } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import ServiceEventModal from "@/components/modals/ServiceEventModal";
import MxGuideModal from "@/components/modals/MxGuideModal";
import SquawksTab from "@/components/tabs/SquawksTab";

export default function MaintenanceTab({ 
  aircraft, role, aircraftRole, onGroundedStatusChange, sysSettings, session, userInitials
}: { 
  aircraft: AircraftWithMetrics | null, 
  role: string,
  aircraftRole: AircraftRole | null,
  onGroundedStatusChange: () => void,
  sysSettings: SystemSettings,
  session: any,
  userInitials: string
}) {
  const [subTab, setSubTab] = useState<MxSubTab>('maintenance');
  const canEditMx = role === 'admin' || aircraftRole === 'admin';
  const currentEngineTime = aircraft?.total_engine_time || 0;
  const isTurbine = aircraft?.engine_type === 'Turbine';

  const { data: mxItems = [], mutate } = useSWR(
    aircraft ? `mx-${aircraft.id}` : null,
    async () => {
      const { data } = await supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraft!.id).order('due_date').order('due_time');
      return (data || []) as any[];
    }
  );

  const { data: activeEvents = [], mutate: mutateEvents } = useSWR(
    aircraft ? `mx-events-${aircraft.id}` : null,
    async () => {
      const { data } = await supabase.from('aft_maintenance_events').select('*').eq('aircraft_id', aircraft!.id).in('status', ['draft', 'scheduling', 'confirmed', 'in_progress', 'ready_for_pickup']).order('created_at', { ascending: false });
      return data || [];
    }
  );

  // Squawk count for badge
  const { data: activeSquawkCount = 0 } = useSWR(
    aircraft ? `squawk-count-${aircraft.id}` : null,
    async () => {
      const { count } = await supabase.from('aft_squawks').select('*', { count: 'exact', head: true }).eq('aircraft_id', aircraft!.id).eq('status', 'open');
      return count || 0;
    }
  );

  const [showMxModal, setShowMxModal] = useState(false);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mxName, setMxName] = useState("");
  const [mxTrackingType, setMxTrackingType] = useState<'time'|'date'>('date');
  const [mxIsRequired, setMxIsRequired] = useState(true);
  const [mxLastTime, setMxLastTime] = useState(""); const [mxIntervalTime, setMxIntervalTime] = useState(""); const [mxDueTime, setMxDueTime] = useState("");
  const [mxLastDate, setMxLastDate] = useState(""); const [mxIntervalDays, setMxIntervalDays] = useState(""); const [mxDueDate, setMxDueDate] = useState("");
  const [automateScheduling, setAutomateScheduling] = useState(false);
  const [confirmResendId, setConfirmResendId] = useState<string | null>(null);
  const [resendingEventId, setResendingEventId] = useState<string | null>(null);

  const isGroundedLocally = mxItems.some(item => {
    if (!item.is_required) return false;
    if (item.tracking_type === 'time') return item.due_time <= currentEngineTime;
    if (item.tracking_type === 'date') return new Date(item.due_date + 'T00:00:00') < new Date(new Date().setHours(0,0,0,0));
    return false;
  });

  const openMxForm = (item: any = null) => {
    if (item) {
      setEditingId(item.id); setMxName(item.item_name); setMxTrackingType(item.tracking_type); setMxIsRequired(item.is_required);
      setMxLastTime(item.last_completed_time?.toString() || ""); setMxIntervalTime(item.time_interval?.toString() || ""); setMxDueTime(item.due_time?.toString() || "");
      setMxLastDate(item.last_completed_date || ""); setMxIntervalDays(item.date_interval_days?.toString() || ""); setMxDueDate(item.due_date || "");
      setAutomateScheduling(item.automate_scheduling || false);
    } else {
      setEditingId(null); setMxName(""); setMxTrackingType('date'); setMxIsRequired(true);
      setMxLastTime(""); setMxIntervalTime(""); setMxDueTime("");
      setMxLastDate(""); setMxIntervalDays(""); setMxDueDate("");
      setAutomateScheduling(false);
    }
    setShowMxModal(true);
  };

  const handleManualMxTrigger = async (item: any) => {
    if (!confirm(`Create a draft work package for "${item.item_name}" and notify the primary contact?`)) return;
    setIsSubmitting(true);
    try {
      await authFetch('/api/mx-events/manual-trigger', { method: 'POST', body: JSON.stringify({ mxItemId: item.id, aircraftId: aircraft!.id }) });
      await mutate(); await mutateEvents();
    } catch (err) { console.error(err); }
    setIsSubmitting(false);
  };

  const handleResendWorkpackage = async (eventId: string) => {
    setResendingEventId(eventId); setConfirmResendId(null);
    try {
      await authFetch('/api/mx-events/send-workpackage', { method: 'POST', body: JSON.stringify({ eventId }) });
    } catch (err) { console.error(err); alert("Failed to resend."); }
    setResendingEventId(null);
  };

  const submitMxItem = async (e: React.FormEvent) => {
    e.preventDefault(); setIsSubmitting(true);
    const payload: Record<string, any> = { aircraft_id: aircraft!.id, item_name: mxName, tracking_type: mxTrackingType, is_required: mxIsRequired, automate_scheduling: automateScheduling };
    if (mxTrackingType === 'time') {
      payload.last_completed_time = parseFloat(mxLastTime) || 0;
      payload.time_interval = mxIntervalTime ? parseFloat(mxIntervalTime) : null;
      payload.due_time = mxDueTime ? parseFloat(mxDueTime) : (parseFloat(mxLastTime) + parseFloat(mxIntervalTime || '0'));
      payload.last_completed_date = null; payload.date_interval_days = null; payload.due_date = null;
    } else {
      payload.last_completed_date = mxLastDate;
      payload.date_interval_days = mxIntervalDays ? parseInt(mxIntervalDays) : null;
      payload.due_date = mxDueDate || (mxLastDate && mxIntervalDays ? new Date(new Date(mxLastDate).getTime() + parseInt(mxIntervalDays) * 86400000).toISOString().split('T')[0] : null);
      payload.last_completed_time = null; payload.time_interval = null; payload.due_time = null;
    }
    if (editingId) { await supabase.from('aft_maintenance_items').update(payload).eq('id', editingId); }
    else {
      await supabase.from('aft_maintenance_items').insert(payload);
      if (automateScheduling) { try { await authFetch('/api/emails/mx-schedule', { method: 'POST', body: JSON.stringify({ aircraft, mxItem: payload }) }); } catch (err) { console.error(err); } }
    }
    await mutate(); onGroundedStatusChange(); setShowMxModal(false); setIsSubmitting(false);
  };

  const deleteMxItem = async (id: string) => {
    if (confirm("Delete this maintenance item?")) { await supabase.from('aft_maintenance_items').delete().eq('id', id); await mutate(); onGroundedStatusChange(); }
  };

  if (!aircraft) return null;

  const statusLabel = (s: string) => ({ draft: 'Draft — Review & Send', scheduling: 'Scheduling', confirmed: 'Confirmed', in_progress: 'In Progress', ready_for_pickup: 'Ready for Pickup', cancelled: 'Cancelled' }[s] || s);
  const statusColor = (s: string) => ({ draft: 'bg-[#F08B46]', scheduling: 'bg-gray-500', confirmed: 'bg-[#3AB0FF]', in_progress: 'bg-[#56B94A]', ready_for_pickup: 'bg-[#56B94A]', cancelled: 'bg-[#CE3732]' }[s] || 'bg-gray-400');

  return (
    <>
      {/* ─── SEGMENTED TOGGLE ─── */}
      <div className="flex gap-1 mb-4 bg-white rounded-sm p-1 shadow-lg border border-gray-200">
        <button onClick={() => setSubTab('maintenance')} className={`flex-1 py-2.5 rounded-sm text-[10px] font-bold uppercase tracking-widest transition-colors active:scale-95 flex items-center justify-center gap-1.5 ${subTab === 'maintenance' ? 'bg-[#F08B46] text-white shadow-sm' : 'text-gray-500 hover:text-navy hover:bg-gray-50'}`}>
          <Wrench size={14} /> Maintenance
        </button>
        <button onClick={() => setSubTab('squawks')} className={`flex-1 py-2.5 rounded-sm text-[10px] font-bold uppercase tracking-widest transition-colors active:scale-95 flex items-center justify-center gap-1.5 relative ${subTab === 'squawks' ? 'bg-[#CE3732] text-white shadow-sm' : 'text-gray-500 hover:text-navy hover:bg-gray-50'}`}>
          <AlertTriangle size={14} /> Squawks
          {activeSquawkCount > 0 && subTab !== 'squawks' && (
            <span className="flex h-2.5 w-2.5 ml-0.5">
              <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-[#CE3732] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#CE3732]"></span>
            </span>
          )}
        </button>
      </div>

      {/* ─── MAINTENANCE SUB-VIEW ─── */}
      {subTab === 'maintenance' && (
        <>
          {canEditMx && (
            <div className="mb-2 flex gap-2">
              <div className="flex-1"><PrimaryButton onClick={() => openMxForm()}><Plus size={18} /> Track New MX Item</PrimaryButton></div>
              <div className="flex-1">
                <button onClick={() => setShowServiceModal(true)} className="w-full bg-[#F08B46] text-white font-oswald tracking-widest uppercase py-3 px-4 rounded hover:bg-opacity-90 active:scale-95 transition-all duration-150 ease-out flex justify-center items-center gap-2 text-sm">
                  <Calendar size={18} /> Schedule Service
                </button>
              </div>
            </div>
          )}

          <ServiceEventModal aircraft={aircraft} show={showServiceModal} onClose={() => { setShowServiceModal(false); mutateEvents(); }} onRefresh={() => { mutate(); mutateEvents(); }} />
          <MxGuideModal show={showGuideModal} onClose={() => setShowGuideModal(false)} />

          {activeEvents.length > 0 && (
            <div className="mb-4 space-y-2">
              {activeEvents.map(ev => (
                <div key={ev.id} className={`bg-white shadow-lg rounded-sm p-4 border-t-4 ${ev.status === 'draft' ? 'border-[#F08B46]' : ev.status === 'confirmed' ? 'border-[#3AB0FF]' : ev.status === 'in_progress' || ev.status === 'ready_for_pickup' ? 'border-[#56B94A]' : 'border-gray-400'}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white ${statusColor(ev.status)}`}>{statusLabel(ev.status)}</span>
                      <p className="font-oswald font-bold text-navy text-sm mt-2">{ev.status === 'draft' ? 'Work Package Ready for Review' : ev.confirmed_date ? `Service: ${ev.confirmed_date}` : ev.proposed_date ? `Proposed: ${ev.proposed_date} (by ${ev.proposed_by})` : 'Awaiting Date'}</p>
                      {ev.estimated_completion && <p className="text-[10px] text-gray-500 mt-1">Est. completion: {ev.estimated_completion}</p>}
                      <p className="text-[10px] text-gray-400 mt-1">MX Contact: {ev.mx_contact_name || 'N/A'}</p>
                    </div>
                    <div className="flex flex-col gap-2 items-end shrink-0 ml-3">
                      <button onClick={() => setShowServiceModal(true)} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] bg-blue-50 border border-blue-200 px-2.5 py-1.5 rounded transition-colors active:scale-95">View <ChevronRight size={12} /></button>
                      {ev.status !== 'draft' && <button onClick={() => setConfirmResendId(ev.id)} disabled={resendingEventId === ev.id} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#F08B46] bg-orange-50 border border-orange-200 px-2.5 py-1.5 rounded transition-colors active:scale-95 disabled:opacity-50"><Send size={10} /> {resendingEventId === ev.id ? '...' : 'Resend'}</button>}
                      {ev.access_token && ev.status !== 'draft' && <a href={`/service/${ev.access_token}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy bg-gray-50 border border-gray-200 px-2.5 py-1.5 rounded transition-colors active:scale-95"><ExternalLink size={10} /> Portal</a>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={`bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 mb-6 ${isGroundedLocally ? 'border-[#CE3732]' : 'border-[#F08B46]'}`}>
            <div className="flex justify-between items-end mb-6">
              <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Maintenance</h2>
              <button onClick={() => setShowGuideModal(true)} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#F08B46] hover:opacity-80 transition-colors active:scale-95"><HelpCircle size={14} /> Guide</button>
            </div>
            <div className="space-y-3">
              {mxItems.length === 0 ? (
                <p className="text-center text-sm text-gray-400 italic py-4">No maintenance items tracked.</p>
              ) : mxItems.map(item => {
                const processed = processMxItem(item, currentEngineTime, aircraft.burnRate, aircraft.burnRateLow, aircraft.burnRateHigh);
                const dueTextColor = getMxTextColor(processed, sysSettings);
                const containerClass = processed.isExpired ? (item.is_required ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200') : 'bg-white border-gray-200';
                return (
                  <div key={item.id} className={`p-4 border rounded flex justify-between items-center ${containerClass}`}>
                    <div className="w-full">
                      <div className="flex items-center gap-2">
                        <h4 className={`font-oswald font-bold uppercase text-sm ${processed.isExpired ? 'text-[#CE3732]' : 'text-navy'}`}>{item.item_name}</h4>
                        {!item.is_required && <span className={`text-[8px] border px-1 rounded uppercase tracking-widest opacity-70 ${processed.isExpired ? 'border-[#CE3732] text-[#CE3732]' : 'border-navy text-navy'}`}>Optional</span>}
                      </div>
                      <p className={`text-xs mt-1 font-roboto font-bold ${dueTextColor}`}>{processed.dueText}</p>
                      {item.primary_heads_up_sent && !item.mx_schedule_sent && (
                        <div className="mt-3 bg-red-50 border border-red-200 p-3 rounded w-full max-w-sm">
                          <p className="text-[10px] text-[#CE3732] font-bold uppercase mb-2 leading-tight">Action Required: Projected MX Due<br/>(System Confidence: {aircraft.confidenceScore || 0}%)</p>
                          <button onClick={() => handleManualMxTrigger(item)} disabled={isSubmitting} className="w-full bg-[#CE3732] text-white text-[10px] font-bold uppercase px-3 py-2 rounded shadow active:scale-95 transition-transform disabled:opacity-50">{isSubmitting ? "Processing..." : "Approve & Email Mechanic"}</button>
                        </div>
                      )}
                    </div>
                    {canEditMx && (
                      <div className="flex gap-3 pl-4">
                        <button onClick={() => openMxForm(item)} className="text-gray-400 hover:text-[#F08B46] transition-colors active:scale-95"><Edit2 size={16}/></button>
                        <button onClick={() => deleteMxItem(item.id)} className="text-gray-400 hover:text-[#CE3732] transition-colors active:scale-95"><Trash2 size={16}/></button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {showMxModal && canEditMx && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
              <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-[#F08B46] max-h-[90vh] overflow-y-auto animate-slide-up">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="font-oswald text-2xl font-bold uppercase text-navy">{editingId ? 'Edit MX Item' : 'Track New Item'}</h2>
                  <button onClick={() => setShowMxModal(false)} className="text-gray-400 hover:text-[#CE3732] transition-colors"><X size={24}/></button>
                </div>
                <form onSubmit={submitMxItem} className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2 min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Item Name *</label><input type="text" required value={mxName} onChange={e=>setMxName(e.target.value)} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" placeholder="e.g. Annual Inspection" /></div>
                    <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Required?</label><select value={mxIsRequired ? "yes" : "no"} onChange={e=>setMxIsRequired(e.target.value === "yes")} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white"><option value="yes">Yes</option><option value="no">Optional</option></select></div>
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
                      <div className="w-full min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Last Completed ({isTurbine ? 'FTT' : 'Tach'}) *</label><input type="number" step="0.1" required value={mxLastTime} onChange={e=>setMxLastTime(e.target.value)} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
                      <div className="grid grid-cols-2 gap-3 w-full min-w-0">
                        <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Interval (Hrs)</label><input type="number" step="0.1" value={mxIntervalTime} onChange={e=>setMxIntervalTime(e.target.value)} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
                        <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">OR Exact Due</label><input type="number" step="0.1" required={!mxIntervalTime} value={mxDueTime} onChange={e=>setMxDueTime(e.target.value)} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-gray-50 p-3 md:p-4 rounded border border-gray-200 flex flex-col gap-4">
                      <div className="w-full min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Last Completed Date *</label><input type="date" required value={mxLastDate} onChange={e=>setMxLastDate(e.target.value)} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
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
                        <span className="flex flex-col"><span>Automate MX Communication</span><span className="text-[10px] text-gray-500 font-normal mt-1 leading-tight">Emails the MX contact when the item crosses global thresholds.</span></span>
                      </label>
                    </div>
                  )}
                  <div className="pt-4"><PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Maintenance Item"}</PrimaryButton></div>
                </form>
              </div>
            </div>
          )}

          {confirmResendId && (
            <div className="fixed inset-0 bg-black/60 z-[10001] flex items-center justify-center p-4 animate-fade-in" onClick={() => setConfirmResendId(null)}>
              <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-[#F08B46] animate-slide-up" onClick={e => e.stopPropagation()}>
                <h3 className="font-oswald text-xl font-bold uppercase text-navy mb-3">Resend Work Package?</h3>
                <p className="text-sm text-gray-600 mb-6">Are you sure you want to resend the work order to <strong>{activeEvents.find(e => e.id === confirmResendId)?.mx_contact_name || 'the primary maintenance contact'}</strong>?</p>
                <div className="flex gap-3">
                  <button onClick={() => setConfirmResendId(null)} className="flex-1 border border-gray-300 text-gray-600 font-oswald font-bold uppercase tracking-widest py-3 rounded text-xs active:scale-95">Cancel</button>
                  <button onClick={() => handleResendWorkpackage(confirmResendId)} disabled={resendingEventId === confirmResendId} className="flex-1 bg-[#F08B46] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded text-xs active:scale-95 disabled:opacity-50">{resendingEventId === confirmResendId ? 'Sending...' : 'Resend'}</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── SQUAWKS SUB-VIEW ─── */}
      {subTab === 'squawks' && (
        <SquawksTab aircraft={aircraft} session={session} role={role} userInitials={userInitials} onGroundedStatusChange={onGroundedStatusChange} />
      )}
    </>
  );
}

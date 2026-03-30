"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { PrimaryButton } from "@/components/AppButtons";
import { 
  X, Calendar, Wrench, AlertTriangle, Sparkles, CheckCircle, 
  Send, MessageSquare, Clock, ChevronRight, ChevronDown, ExternalLink, XCircle, Plane,
  Paperclip, FileText, Image as ImageIcon
} from "lucide-react";
import Toast from "@/components/Toast";

const ADDON_OPTIONS = [
  "Aircraft Wash & Detail",
  "Engine Oil Change & Top-Off",
  "Fluid Check & Top-Off",
  "Nav Database Update",
  "Tire Inspection & Pressure Check",
  "Interior Cleaning",
  "Pitot-Static System Check",
  "Battery Condition Check",
];

// Inline style to force white background on inputs (Tailwind v4 bg-white not reliable)
const whiteBg = { backgroundColor: '#ffffff' } as const;

interface ServiceEventModalProps {
  aircraft: any;
  show: boolean;
  onClose: () => void;
  onRefresh: () => void;
  /** If false, hide create/send/manage actions (read-only view for non-admin pilots) */
  canManageService?: boolean;
}

export default function ServiceEventModal({ aircraft, show, onClose, onRefresh, canManageService = true }: ServiceEventModalProps) {
  const [view, setView] = useState<'list' | 'create' | 'detail' | 'complete' | 'review_draft' | 'counter'>('list');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [events, setEvents] = useState<any[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [eventLineItems, setEventLineItems] = useState<any[]>([]);
  const [eventMessages, setEventMessages] = useState<any[]>([]);

  const [mxItems, setMxItems] = useState<any[]>([]);
  const [squawks, setSquawks] = useState<any[]>([]);
  const [selectedMxIds, setSelectedMxIds] = useState<string[]>([]);
  const [selectedSquawkIds, setSelectedSquawkIds] = useState<string[]>([]);
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  const [proposedDate, setProposedDate] = useState("");

  const [ownerMessage, setOwnerMessage] = useState("");
  const [completionItems, setCompletionItems] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [viewingAttachment, setViewingAttachment] = useState<string | null>(null);

  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);
  const showSuccess = (msg: string) => { setToastMessage(msg); setShowToast(true); };

  useEffect(() => {
    if (show) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [show]);

  useEffect(() => {
    if (show && aircraft) fetchEvents();
  }, [show, aircraft]);

  const fetchEvents = async () => {
    const { data } = await supabase
      .from('aft_maintenance_events').select('*').eq('aircraft_id', aircraft.id)
      .neq('status', 'cancelled').order('created_at', { ascending: false });
    setEvents(data || []);
    setView('list');
  };

  const fetchEventDetail = async (eventId: string) => {
    const { data: ev } = await supabase.from('aft_maintenance_events').select('*').eq('id', eventId).single();
    if (ev) setSelectedEvent(ev);
    const { data: lines } = await supabase.from('aft_event_line_items').select('*').eq('event_id', eventId).order('created_at');
    setEventLineItems(lines || []);
    const { data: msgs } = await supabase.from('aft_event_messages').select('*').eq('event_id', eventId).order('created_at');
    setEventMessages(msgs || []);
  };

  const openCreateFlow = async () => {
    const { data: mx } = await supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraft.id).order('due_time').order('due_date');
    const { data: sq } = await supabase.from('aft_squawks').select('*').eq('aircraft_id', aircraft.id).eq('status', 'open').order('created_at', { ascending: false });
    setMxItems(mx || []); setSquawks(sq || []);
    setSelectedMxIds([]); setSelectedSquawkIds([]); setSelectedAddons([]); setProposedDate("");
    setView('create');
  };

  const handleCreateEvent = async () => {
    if (selectedMxIds.length === 0 && selectedSquawkIds.length === 0 && selectedAddons.length === 0) return alert("Please select at least one item for the work package.");
    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/mx-events/create', { method: 'POST', body: JSON.stringify({ aircraftId: aircraft.id, mxItemIds: selectedMxIds, squawkIds: selectedSquawkIds, addonServices: selectedAddons, proposedDate: proposedDate || null }) });
      if (!res.ok) throw new Error('Failed to create event');
      await fetchEvents(); showSuccess("Work package sent to mechanic"); setView('list');
    } catch (err: any) { alert("Failed to create service event: " + err.message); }
    setIsSubmitting(false);
  };

  const handleOwnerConfirm = async () => {
    if (!selectedEvent) return; setIsSubmitting(true);
    try {
      await authFetch('/api/mx-events/owner-action', { method: 'POST', body: JSON.stringify({ eventId: selectedEvent.id, action: 'confirm', message: ownerMessage || `Confirmed for ${selectedEvent.proposed_date}.` }) });
      setOwnerMessage(""); await fetchEventDetail(selectedEvent.id); showSuccess("Date confirmed");
    } catch (err) { alert("Failed to confirm date."); }
    setIsSubmitting(false);
  };

  const handleOwnerCounter = async () => {
    if (!selectedEvent || !proposedDate) return alert("Please select a date."); setIsSubmitting(true);
    try {
      await authFetch('/api/mx-events/owner-action', { method: 'POST', body: JSON.stringify({ eventId: selectedEvent.id, action: 'counter', proposedDate, message: ownerMessage || `How about ${proposedDate} instead?` }) });
      setOwnerMessage(""); setProposedDate(""); await fetchEventDetail(selectedEvent.id); showSuccess("Counter proposal sent");
    } catch (err) { alert("Failed to send counter proposal."); }
    setIsSubmitting(false);
  };

  const handleOwnerComment = async () => {
    if (!selectedEvent || !ownerMessage.trim()) return; setIsSubmitting(true);
    try {
      await authFetch('/api/mx-events/owner-action', { method: 'POST', body: JSON.stringify({ eventId: selectedEvent.id, action: 'comment', message: ownerMessage }) });
      setOwnerMessage(""); await fetchEventDetail(selectedEvent.id); showSuccess("Message sent");
    } catch (err) { alert("Failed to send message."); }
    setIsSubmitting(false);
  };

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const handleCancelEvent = async () => {
    if (!selectedEvent) return; setIsSubmitting(true);
    try {
      await authFetch('/api/mx-events/owner-action', { method: 'POST', body: JSON.stringify({ eventId: selectedEvent.id, action: 'cancel', message: cancelReason || 'Service event cancelled.' }) });
      setShowCancelConfirm(false); setCancelReason(""); await fetchEvents(); showSuccess("Service event cancelled"); setView('list');
    } catch (err) { alert("Failed to cancel event."); }
    setIsSubmitting(false);
  };

  const handleSendDraft = async () => {
    if (!selectedEvent) return; setIsSubmitting(true);
    try {
      const res = await authFetch('/api/mx-events/send-workpackage', { method: 'POST', body: JSON.stringify({ eventId: selectedEvent.id, additionalMxItemIds: selectedMxIds, additionalSquawkIds: selectedSquawkIds, addonServices: selectedAddons, proposedDate: proposedDate || null }) });
      if (!res.ok) throw new Error('Failed to send');
      await fetchEvents(); showSuccess("Work package sent to mechanic"); setView('list');
    } catch (err: any) { alert("Failed to send work package: " + err.message); }
    setIsSubmitting(false);
  };

  const openDraftReview = async (ev: any) => {
    setSelectedEvent(ev); await fetchEventDetail(ev.id);
    const { data: mx } = await supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraft.id).order('due_time').order('due_date');
    const { data: sq } = await supabase.from('aft_squawks').select('*').eq('aircraft_id', aircraft.id).eq('status', 'open').order('created_at', { ascending: false });
    setMxItems(mx || []); setSquawks(sq || []);
    setSelectedMxIds([]); setSelectedSquawkIds([]); setSelectedAddons([]); setProposedDate("");
    setView('review_draft');
  };

  const openCompleteFlow = () => {
    const today = new Date().toISOString().split('T')[0];
    const currentTime = aircraft?.total_engine_time?.toFixed(1) || "";
    const items = eventLineItems.filter(li => li.item_type === 'maintenance' || li.item_type === 'squawk').map(li => ({ ...li, completionDate: today, completionTime: currentTime, completedByName: "", completedByCert: "", workDescription: "" }));
    setCompletionItems(items); setView('complete');
  };

  const handleCompleteEvent = async () => {
    const mxCompletions = completionItems.filter(c => c.item_type === 'maintenance');
    for (const c of mxCompletions) { if (!c.completionDate && !c.completionTime) return alert(`Please enter logbook completion data for: ${c.item_name}`); }
    setIsSubmitting(true);
    try {
      const lineCompletions = completionItems.map(c => ({ lineItemId: c.id, completionDate: c.completionDate || null, completionTime: c.completionTime || null, completedByName: c.completedByName || null, completedByCert: c.completedByCert || null, workDescription: c.workDescription || null }));
      const res = await authFetch('/api/mx-events/complete', { method: 'POST', body: JSON.stringify({ eventId: selectedEvent.id, lineCompletions }) });
      if (!res.ok) throw new Error('Failed to complete event');
      await fetchEvents(); onRefresh(); showSuccess("Service complete — tracking reset"); setView('list');
    } catch (err: any) { alert("Failed to complete event: " + err.message); }
    setIsSubmitting(false);
  };

  const updateCompletionItem = (index: number, field: string, value: string) => {
    setCompletionItems(prev => { const updated = [...prev]; updated[index] = { ...updated[index], [field]: value }; return updated; });
  };

  const renderMessageAttachments = (attachments: any[]) => {
    if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return null;
    return (
      <div className="mt-3 pt-3 border-t border-gray-200">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-1"><Paperclip size={10} /> {attachments.length} Attachment{attachments.length > 1 ? 's' : ''}</p>
        <div className="flex gap-2 flex-wrap">
          {attachments.map((att: any, idx: number) => {
            const isImg = att.type && att.type.startsWith('image/');
            if (isImg) return (<button key={idx} onClick={() => setViewingAttachment(att.url)} className="w-16 h-16 rounded border-2 border-gray-200 overflow-hidden hover:border-[#3AB0FF] transition-colors active:scale-95"><img src={att.url} alt={att.filename} className="w-full h-full object-cover" /></button>);
            return (<a key={idx} href={att.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-2 bg-white border border-gray-200 rounded hover:border-[#3AB0FF] transition-colors"><FileText size={14} className="text-gray-500 shrink-0" /><div className="min-w-0"><p className="text-[10px] font-bold text-navy truncate max-w-[100px]">{att.filename}</p></div></a>);
          })}
        </div>
      </div>
    );
  };

  if (!show) return null;

  const isTurbine = aircraft?.engine_type === 'Turbine';
  const activeEvents = events.filter(e => e.status !== 'complete' && e.status !== 'cancelled');
  const completedEvents = events.filter(e => e.status === 'complete');
  const cancelledEvents = events.filter(e => e.status === 'cancelled');

  const renderEmailPreview = (existingLines?: any[]) => {
    const mxPreviewItems = mxItems.filter(mx => selectedMxIds.includes(mx.id));
    const sqPreviewItems = squawks.filter(sq => selectedSquawkIds.includes(sq.id));
    const existingMx = (existingLines || []).filter(li => li.item_type === 'maintenance');
    const existingSq = (existingLines || []).filter(li => li.item_type === 'squawk');
    const existingAddon = (existingLines || []).filter(li => li.item_type === 'addon');
    const allMx = [...existingMx.map(li => ({ name: li.item_name, desc: li.item_description })), ...mxPreviewItems.map(mx => ({ name: mx.item_name, desc: mx.tracking_type === 'time' ? `Due at ${mx.due_time} hrs` : `Due on ${mx.due_date}` }))];
    const allSq = [...existingSq.map(li => ({ name: li.item_name, desc: li.item_description })), ...sqPreviewItems.map(sq => ({ name: sq.description || 'No description', desc: sq.affects_airworthiness && sq.location ? `Grounded at ${sq.location}` : null }))];
    const allAddons = [...existingAddon.map(li => li.item_name), ...selectedAddons];
    return (
      <div className="bg-gray-50 border border-gray-200 rounded p-4 space-y-4 text-sm animate-fade-in">
        <div className="flex justify-between items-center border-b border-gray-200 pb-2"><span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Email Preview</span><button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-red-500"><X size={16}/></button></div>
        <div className="space-y-1 text-[10px] text-gray-500"><p><strong>To:</strong> {aircraft.mx_contact_email || 'No MX contact set'}</p><p><strong>CC:</strong> {aircraft.main_contact_email || 'None'}</p><p><strong>Subject:</strong> Service Request: {aircraft.tail_number} — Work Package</p></div>
        <div className="border-t border-gray-200 pt-3 space-y-3">
          <p className="text-navy">Hello {aircraft.mx_contact || ''},</p>
          <p className="text-gray-600">We'd like to schedule service for <strong>{aircraft.tail_number}</strong> ({aircraft.aircraft_type}).</p>
          {proposedDate && <p className="text-navy font-bold">Requested Service Date: {proposedDate}</p>}
          {!proposedDate && <p className="text-gray-500 italic">No preferred date — mechanic will be asked to propose one.</p>}
          {allMx.length > 0 && <div><p className="text-[10px] font-bold uppercase tracking-widest text-[#F08B46] mb-1">Maintenance Items Due</p>{allMx.map((m, i) => <p key={i} className="text-navy ml-3">• <strong>{m.name}</strong>{m.desc ? ` — ${m.desc}` : ''}</p>)}</div>}
          {allSq.length > 0 && <div><p className="text-[10px] font-bold uppercase tracking-widest text-[#CE3732] mb-1">Squawks</p>{allSq.map((s, i) => <p key={i} className="text-navy ml-3">• <strong>{s.name}</strong>{s.desc ? ` — ${s.desc}` : ''}</p>)}</div>}
          {allAddons.length > 0 && <div><p className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] mb-1">Additional Services</p>{allAddons.map((a, i) => <p key={i} className="text-navy ml-3">• {a}</p>)}</div>}
        </div>
      </div>
    );
  };

  return (
    <>
      {viewingAttachment && (
        <div className="fixed inset-0 z-[10002] bg-black/90 flex items-center justify-center p-4 animate-fade-in" onClick={() => setViewingAttachment(null)}>
          <button onClick={() => setViewingAttachment(null)} className="absolute top-4 right-4 text-white hover:text-gray-300 z-10"><X size={32}/></button>
          <img src={viewingAttachment} alt="Attachment" className="max-w-full max-h-[90vh] rounded-lg shadow-2xl" />
        </div>
      )}

      <Toast message={toastMessage} show={showToast} onDismiss={() => setShowToast(false)} />

      <div className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center animate-fade-in" style={{ overscrollBehavior: 'contain', paddingTop: 'calc(3.5rem + env(safe-area-inset-top, 0px) + 8px)', paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px) + 8px)', paddingLeft: '0.75rem', paddingRight: '0.75rem' }} onClick={onClose}>
        <div className="bg-white rounded shadow-2xl w-full max-w-lg p-5 border-t-4 border-[#F08B46] max-h-full overflow-y-auto animate-slide-up" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }} onClick={e => e.stopPropagation()}>

          <div className="flex justify-between items-center mb-6">
            <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2">
              <Wrench size={20} className="text-[#F08B46]" />
              {view === 'create' ? 'Schedule Service' : view === 'detail' ? 'Service Event' : view === 'complete' ? 'Enter Logbook Data' : view === 'review_draft' ? 'Review Draft' : 'Maintenance Events'}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-red-500 p-2 -mr-2"><X size={24}/></button>
          </div>

          {/* ===================== LIST VIEW ===================== */}
          {view === 'list' && (
            <div className="space-y-4">
              {canManageService && <PrimaryButton onClick={openCreateFlow}><Calendar size={18} /> Schedule New Service</PrimaryButton>}
              {canManageService && activeEvents.filter(e => e.status === 'draft').length > 0 && (
                <div className="bg-orange-50 border-2 border-orange-200 rounded p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#F08B46] mb-3 flex items-center gap-1"><AlertTriangle size={12} /> Drafts Awaiting Your Review</p>
                  {activeEvents.filter(e => e.status === 'draft').map(ev => (
                    <button key={ev.id} onClick={() => openDraftReview(ev)} className="w-full bg-white border-2 border-[#F08B46] p-4 rounded mb-2 text-left flex justify-between items-center hover:bg-orange-50 transition-colors active:scale-[0.98]">
                      <div><span className="text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white bg-[#F08B46]">draft — review & send</span><p className="text-[10px] text-gray-500 mt-1">Auto-created {new Date(ev.created_at).toLocaleDateString()}</p></div>
                      <ChevronRight size={18} className="text-[#F08B46]" />
                    </button>
                  ))}
                </div>
              )}
              {activeEvents.filter(e => e.status !== 'draft').length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Active</p>
                  {activeEvents.filter(e => e.status !== 'draft').map(ev => (
                    <button key={ev.id} onClick={() => { setSelectedEvent(ev); fetchEventDetail(ev.id); setView('detail'); }} className="w-full bg-gray-50 border border-gray-200 p-4 rounded mb-2 text-left flex justify-between items-center hover:border-[#F08B46] transition-colors active:scale-[0.98]">
                      <div><span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white ${ev.status === 'confirmed' ? 'bg-[#3AB0FF]' : ev.status === 'in_progress' ? 'bg-[#56B94A]' : ev.status === 'ready_for_pickup' ? 'bg-[#56B94A]' : 'bg-gray-500'}`}>{ev.status === 'ready_for_pickup' ? 'Ready' : ev.status}</span><p className="font-bold text-navy text-sm mt-1">{ev.confirmed_date || ev.proposed_date || 'Pending'}</p><p className="text-[10px] text-gray-500">Created {new Date(ev.created_at).toLocaleDateString()}</p></div>
                      <ChevronRight size={18} className="text-gray-400" />
                    </button>
                  ))}
                </div>
              )}
              {completedEvents.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Completed</p>
                  {completedEvents.slice(0, 5).map(ev => (
                    <button key={ev.id} onClick={() => { setSelectedEvent(ev); fetchEventDetail(ev.id); setView('detail'); }} className="w-full bg-green-50 border border-green-200 p-3 rounded mb-2 text-left flex justify-between items-center opacity-70 hover:opacity-100 transition-opacity active:scale-[0.98]">
                      <div><span className="text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white bg-[#56B94A]">complete</span><p className="text-[10px] text-gray-500 mt-1">Completed {ev.completed_at ? new Date(ev.completed_at).toLocaleDateString() : ''}</p></div>
                      <ChevronRight size={18} className="text-gray-400" />
                    </button>
                  ))}
                </div>
              )}
              {cancelledEvents.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Cancelled</p>
                  {cancelledEvents.slice(0, 3).map(ev => (
                    <button key={ev.id} onClick={() => { setSelectedEvent(ev); fetchEventDetail(ev.id); setView('detail'); }} className="w-full bg-red-50 border border-red-200 p-3 rounded mb-2 text-left flex justify-between items-center opacity-50 hover:opacity-80 transition-opacity active:scale-[0.98]">
                      <div><span className="text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white bg-[#CE3732]">cancelled</span><p className="text-[10px] text-gray-500 mt-1">Created {new Date(ev.created_at).toLocaleDateString()}</p></div>
                      <ChevronRight size={18} className="text-gray-400" />
                    </button>
                  ))}
                </div>
              )}
              {events.length === 0 && <p className="text-center text-sm text-gray-400 italic py-4">No maintenance events yet.</p>}
            </div>
          )}

          {/* ===================== CREATE VIEW ===================== */}
          {view === 'create' && (
            <div className="space-y-6">
              <button onClick={() => setView('list')} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#F08B46] bg-orange-50 border border-orange-200 rounded px-3 py-1.5 hover:bg-orange-100 active:scale-95 transition-all mb-2"><ChevronDown size={12} className="rotate-90" /> Back to Events</button>
              {mxItems.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Wrench size={14} className="text-[#F08B46]" /> Maintenance Items Due</p>
                  <div className="space-y-3 max-h-[200px] overflow-y-auto pb-1">{mxItems.map(mx => (<label key={mx.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50"><input type="checkbox" checked={selectedMxIds.includes(mx.id)} onChange={() => setSelectedMxIds(prev => prev.includes(mx.id) ? prev.filter(id => id !== mx.id) : [...prev, mx.id])} className="mt-1 w-4 h-4 text-[#F08B46] border-gray-300 rounded" /><div><span className="font-bold text-sm text-navy">{mx.item_name}</span><span className="block text-[10px] text-gray-500">{mx.tracking_type === 'time' ? `Due @ ${mx.due_time} hrs` : `Due ${mx.due_date}`}</span></div></label>))}</div>
                </div>
              )}
              {squawks.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><AlertTriangle size={14} className="text-[#CE3732]" /> Open Squawks</p>
                  <div className="space-y-3 max-h-[200px] overflow-y-auto pb-1">{squawks.map(sq => (<label key={sq.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50"><input type="checkbox" checked={selectedSquawkIds.includes(sq.id)} onChange={() => setSelectedSquawkIds(prev => prev.includes(sq.id) ? prev.filter(id => id !== sq.id) : [...prev, sq.id])} className="mt-1 w-4 h-4 text-[#CE3732] border-gray-300 rounded" /><div><span className="font-bold text-sm text-navy">{sq.description || 'No description'}</span>{sq.affects_airworthiness && sq.location && <span className="block text-[10px] font-bold text-[#CE3732]">⚠ Grounded at {sq.location}</span>}<span className="block text-[10px] text-gray-500">Reported {new Date(sq.created_at).toLocaleDateString()}</span></div></label>))}</div>
                </div>
              )}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Sparkles size={14} className="text-[#3AB0FF]" /> Additional Services</p>
                <div className="grid grid-cols-2 gap-2">{ADDON_OPTIONS.map(addon => (<label key={addon} className="flex items-center gap-2 p-2 border border-gray-200 rounded cursor-pointer hover:bg-blue-50 text-xs"><input type="checkbox" checked={selectedAddons.includes(addon)} onChange={() => setSelectedAddons(prev => prev.includes(addon) ? prev.filter(a => a !== addon) : [...prev, addon])} className="w-3.5 h-3.5 text-[#3AB0FF] border-gray-300 rounded" /><span className="text-navy font-bold">{addon}</span></label>))}</div>
              </div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Preferred Service Date (Optional)</label><input type="date" value={proposedDate} onChange={e => setProposedDate(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
              {!showPreview ? (<button onClick={() => setShowPreview(true)} className="w-full text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] hover:underline py-2">Preview Email Before Sending</button>) : renderEmailPreview()}
              <PrimaryButton onClick={handleCreateEvent} disabled={isSubmitting}>{isSubmitting ? "Creating..." : "Send Work Package to Mechanic"}</PrimaryButton>
            </div>
          )}

          {/* ===================== REVIEW DRAFT VIEW ===================== */}
          {view === 'review_draft' && selectedEvent && (
            <div className="space-y-6">
              <button onClick={() => { setSelectedEvent(null); setView('list'); }} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#F08B46] bg-orange-50 border border-orange-200 rounded px-3 py-1.5 hover:bg-orange-100 active:scale-95 transition-all"><ChevronDown size={12} className="rotate-90" /> Back to Events</button>
              <div className="bg-orange-50 border border-orange-200 rounded p-4"><p className="text-sm text-navy font-bold mb-1">System-Generated Draft</p><p className="text-xs text-gray-600">Review the items below, add anything else you need, and send it to your mechanic.</p></div>
              {eventLineItems.length > 0 && (<div><p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2">Already Included</p><div className="space-y-2">{eventLineItems.map(li => (<div key={li.id} className="p-3 bg-white border border-gray-200 rounded"><span className="font-bold text-sm text-navy">{li.item_name}</span>{li.item_description && <span className="block text-[10px] text-gray-500">{li.item_description}</span>}</div>))}</div></div>)}
              {mxItems.filter(mx => !eventLineItems.some(li => li.maintenance_item_id === mx.id)).length > 0 && (
                <div><p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Wrench size={14} className="text-[#F08B46]" /> Add More Maintenance Items</p><div className="space-y-3 max-h-[160px] overflow-y-auto pb-1">{mxItems.filter(mx => !eventLineItems.some(li => li.maintenance_item_id === mx.id)).map(mx => (<label key={mx.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50"><input type="checkbox" checked={selectedMxIds.includes(mx.id)} onChange={() => setSelectedMxIds(prev => prev.includes(mx.id) ? prev.filter(id => id !== mx.id) : [...prev, mx.id])} className="mt-1 w-4 h-4 text-[#F08B46] border-gray-300 rounded" /><div><span className="font-bold text-sm text-navy">{mx.item_name}</span><span className="block text-[10px] text-gray-500">{mx.tracking_type === 'time' ? `Due @ ${mx.due_time} hrs` : `Due ${mx.due_date}`}</span></div></label>))}</div></div>
              )}
              {squawks.filter(sq => !eventLineItems.some(li => li.squawk_id === sq.id)).length > 0 && (
                <div><p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><AlertTriangle size={14} className="text-[#CE3732]" /> Add Squawks</p><div className="space-y-3 max-h-[160px] overflow-y-auto pb-1">{squawks.filter(sq => !eventLineItems.some(li => li.squawk_id === sq.id)).map(sq => (<label key={sq.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50"><input type="checkbox" checked={selectedSquawkIds.includes(sq.id)} onChange={() => setSelectedSquawkIds(prev => prev.includes(sq.id) ? prev.filter(id => id !== sq.id) : [...prev, sq.id])} className="mt-1 w-4 h-4 text-[#CE3732] border-gray-300 rounded" /><div><span className="font-bold text-sm text-navy">{sq.description || 'No description'}</span>{sq.affects_airworthiness && sq.location && <span className="block text-[10px] font-bold text-[#CE3732]">⚠ Grounded at {sq.location}</span>}<span className="block text-[10px] text-gray-500">Reported {new Date(sq.created_at).toLocaleDateString()}</span></div></label>))}</div></div>
              )}
              <div><p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Sparkles size={14} className="text-[#3AB0FF]" /> Additional Services</p><div className="grid grid-cols-2 gap-2">{ADDON_OPTIONS.map(addon => (<label key={addon} className="flex items-center gap-2 p-2 border border-gray-200 rounded cursor-pointer hover:bg-blue-50 text-xs"><input type="checkbox" checked={selectedAddons.includes(addon)} onChange={() => setSelectedAddons(prev => prev.includes(addon) ? prev.filter(a => a !== addon) : [...prev, addon])} className="w-3.5 h-3.5 text-[#3AB0FF] border-gray-300 rounded" /><span className="text-navy font-bold">{addon}</span></label>))}</div></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Preferred Service Date (Optional)</label><input type="date" value={proposedDate} onChange={e => setProposedDate(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
              {!showPreview ? (<button onClick={() => setShowPreview(true)} className="w-full text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] hover:underline py-2">Preview Email Before Sending</button>) : renderEmailPreview(eventLineItems)}
              <PrimaryButton onClick={handleSendDraft} disabled={isSubmitting}>{isSubmitting ? "Sending..." : "Send Work Package to Mechanic"}</PrimaryButton>
            </div>
          )}

          {/* ===================== DETAIL VIEW ===================== */}
          {view === 'detail' && selectedEvent && (
            <div className="space-y-5">
              <button onClick={() => { setSelectedEvent(null); setView('list'); }} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#F08B46] bg-orange-50 border border-orange-200 rounded px-3 py-1.5 hover:bg-orange-100 active:scale-95 transition-all"><ChevronDown size={12} className="rotate-90" /> Back to Events</button>
              <div className="bg-gray-50 rounded p-4 border border-gray-200">
                <div className="flex justify-between items-center mb-3">
                  <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded text-white ${selectedEvent.status === 'confirmed' ? 'bg-[#3AB0FF]' : selectedEvent.status === 'complete' ? 'bg-[#56B94A]' : selectedEvent.status === 'ready_for_pickup' ? 'bg-[#56B94A]' : selectedEvent.status === 'cancelled' ? 'bg-[#CE3732]' : 'bg-[#F08B46]'}`}>{selectedEvent.status === 'ready_for_pickup' ? 'Ready for Pickup' : selectedEvent.status}</span>
                  {selectedEvent.access_token && selectedEvent.status !== 'complete' && (<a href={`/service/${selectedEvent.access_token}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] bg-blue-50 border border-blue-200 rounded px-3 py-1.5 hover:bg-blue-100 active:scale-95 transition-all"><ExternalLink size={12} /> Portal</a>)}
                </div>
                {selectedEvent.confirmed_date && <p className="text-sm"><strong className="text-navy">Confirmed:</strong> {selectedEvent.confirmed_date}</p>}
                {selectedEvent.proposed_date && !selectedEvent.confirmed_date && <p className="text-sm"><strong className="text-navy">Proposed:</strong> {selectedEvent.proposed_date} <span className="text-gray-400">(by {selectedEvent.proposed_by})</span></p>}
                {selectedEvent.estimated_completion && <p className="text-sm mt-1"><strong className="text-navy">Est. Completion:</strong> {selectedEvent.estimated_completion}</p>}
                {selectedEvent.mechanic_notes && <p className="text-xs text-gray-500 mt-2 italic">{selectedEvent.mechanic_notes}</p>}
              </div>
              {canManageService && selectedEvent.status === 'scheduling' && selectedEvent.proposed_by === 'mechanic' && (
                <div className="bg-orange-50 border border-orange-200 rounded p-4 space-y-3">
                  <p className="text-sm font-bold text-navy">{selectedEvent.mx_contact_name || 'Mechanic'} proposed <strong>{selectedEvent.proposed_date}</strong></p>
                  <div className="flex gap-2">
                    <button onClick={handleOwnerConfirm} disabled={isSubmitting} className="flex-1 bg-[#56B94A] text-white font-oswald font-bold uppercase tracking-widest py-2 rounded text-xs active:scale-95 disabled:opacity-50">Confirm</button>
                    <button onClick={() => setView('counter')} className="flex-1 bg-[#F08B46] text-white font-oswald font-bold uppercase tracking-widest py-2 rounded text-xs active:scale-95">Counter</button>
                  </div>
                  <div className="space-y-2 pt-2">
                    <input type="date" value={proposedDate} onChange={e => setProposedDate(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm focus:border-[#F08B46] outline-none" />
                    <textarea value={ownerMessage} onChange={e => setOwnerMessage(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm focus:border-[#F08B46] outline-none min-h-[50px]" placeholder="Message (optional)" />
                    <button onClick={handleOwnerCounter} disabled={isSubmitting || !proposedDate} className="w-full bg-[#F08B46] text-white font-oswald font-bold uppercase tracking-widest py-2 rounded text-xs active:scale-95 disabled:opacity-50">Send Counter Proposal</button>
                  </div>
                </div>
              )}
              {eventLineItems.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Work Package</p>
                  <div className="space-y-2">
                    {eventLineItems.map(li => (
                      <div key={li.id} className={`p-3 border rounded text-sm ${li.line_status === 'complete' ? 'bg-green-50 border-green-200' : li.line_status === 'in_progress' ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
                        <div className="flex justify-between items-start"><div><span className="font-bold text-navy">{li.item_name}</span>{li.item_description && <p className="text-[10px] text-gray-500 mt-0.5">{li.item_description}</p>}</div><span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded shrink-0 ml-2 ${li.line_status === 'complete' ? 'bg-green-100 text-green-700' : li.line_status === 'in_progress' ? 'bg-blue-100 text-blue-700' : li.line_status === 'deferred' ? 'bg-gray-100 text-gray-600' : 'bg-orange-100 text-orange-700'}`}>{li.line_status}</span></div>
                        {li.mechanic_comment && <p className="text-[10px] text-[#3AB0FF] mt-1 italic">{li.mechanic_comment}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {eventMessages.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Messages</p>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {eventMessages.map(msg => (
                      <div key={msg.id} className={`p-2 rounded text-xs ${msg.sender === 'mechanic' ? 'bg-blue-50 border-l-4 border-[#3AB0FF]' : msg.sender === 'owner' ? 'bg-orange-50 border-l-4 border-[#F08B46]' : 'bg-gray-50 border-l-4 border-gray-300'}`}>
                        <span className="text-[8px] font-bold uppercase text-gray-400">{msg.sender} • {new Date(msg.created_at).toLocaleString()}</span>
                        <p className="text-navy mt-1">{msg.message}</p>
                        {renderMessageAttachments(msg.attachments)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {canManageService && selectedEvent.status !== 'complete' && (
                <div className="flex gap-2">
                  <textarea value={ownerMessage} onChange={e => setOwnerMessage(e.target.value)} style={whiteBg} className="flex-1 border border-gray-300 rounded p-2 text-sm focus:border-[#3AB0FF] outline-none min-h-[50px]" placeholder="Send a message..." />
                  <button onClick={handleOwnerComment} disabled={isSubmitting || !ownerMessage.trim()} className="bg-[#3AB0FF] text-white px-4 py-3 rounded active:scale-95 disabled:opacity-50"><Send size={18}/></button>
                </div>
              )}
              {canManageService && selectedEvent.status !== 'complete' && selectedEvent.status !== 'cancelled' && (
                <button onClick={openCompleteFlow} className="w-full bg-[#56B94A] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 transition-transform flex items-center justify-center gap-2"><CheckCircle size={18} /> Enter Logbook Data & Complete</button>
              )}
              {selectedEvent.status === 'ready_for_pickup' && (
                <div className="bg-green-50 border-2 border-green-200 rounded p-4 text-center"><Plane size={32} className="mx-auto text-[#56B94A] mb-2" /><p className="font-oswald text-lg font-bold uppercase tracking-widest text-navy">Aircraft Ready</p><p className="text-sm text-gray-600 mt-1">Your mechanic has marked all work as complete. Enter logbook data above to finalize.</p></div>
              )}
              {selectedEvent.status === 'cancelled' && (
                <div className="bg-red-50 border-2 border-red-200 rounded p-4 text-center"><XCircle size={32} className="mx-auto text-[#CE3732] mb-2" /><p className="font-oswald text-lg font-bold uppercase tracking-widest text-navy">Event Cancelled</p></div>
              )}
              {canManageService && selectedEvent.status !== 'complete' && selectedEvent.status !== 'cancelled' && !showCancelConfirm && (
                <button onClick={() => setShowCancelConfirm(true)} className="w-full text-[10px] font-bold uppercase tracking-widest text-[#CE3732] border border-red-200 bg-red-50 rounded py-2 hover:bg-red-100 active:scale-95 transition-all flex items-center justify-center gap-1.5 mt-2"><XCircle size={12} /> Cancel Service Event</button>
              )}
              {showCancelConfirm && (
                <div className="bg-red-50 border-2 border-red-200 rounded p-4 space-y-3 animate-fade-in">
                  <p className="text-sm font-bold text-navy">Are you sure you want to cancel this service event?</p>
                  <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm focus:border-[#CE3732] outline-none min-h-[50px]" placeholder="Reason for cancellation (optional)..." />
                  <div className="flex gap-2">
                    <button onClick={() => { setShowCancelConfirm(false); setCancelReason(""); }} className="flex-1 border border-gray-300 text-gray-600 font-oswald font-bold uppercase tracking-widest py-2 rounded text-xs active:scale-95">Keep Event</button>
                    <button onClick={handleCancelEvent} disabled={isSubmitting} className="flex-1 bg-[#CE3732] text-white font-oswald font-bold uppercase tracking-widest py-2 rounded text-xs active:scale-95 disabled:opacity-50">{isSubmitting ? "Cancelling..." : "Cancel Event"}</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===================== COMPLETION VIEW ===================== */}
          {view === 'complete' && selectedEvent && (
            <div className="space-y-5">
              <button onClick={() => setView('detail')} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#F08B46] bg-orange-50 border border-orange-200 rounded px-3 py-1.5 hover:bg-orange-100 active:scale-95 transition-all"><ChevronDown size={12} className="rotate-90" /> Back to Event</button>
              <p className="text-sm text-gray-600">Enter the logbook data from your mechanic's sign-off. These times and dates will reset the tracking for each item.</p>
              {completionItems.map((item, idx) => (
                <div key={item.id} className="bg-gray-50 border border-gray-200 rounded p-4 space-y-3">
                  <div className="flex items-center gap-2">{item.item_type === 'maintenance' ? <Wrench size={14} className="text-[#F08B46]" /> : <AlertTriangle size={14} className="text-[#CE3732]" />}<h4 className="font-oswald font-bold uppercase text-sm text-navy">{item.item_name}</h4></div>
                  <div className="space-y-3">
                    <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Completion Date</label><input type="date" value={item.completionDate} onChange={e => updateCompletionItem(idx, 'completionDate', e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Completion {isTurbine ? 'FTT' : 'Tach'}</label><input type="number" step="0.1" value={item.completionTime} onChange={e => updateCompletionItem(idx, 'completionTime', e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="Engine time at completion" /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Signed By</label><input type="text" value={item.completedByName} onChange={e => updateCompletionItem(idx, 'completedByName', e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="IA / A&P" /></div>
                      <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Certificate #</label><input type="text" value={item.completedByCert} onChange={e => updateCompletionItem(idx, 'completedByCert', e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" /></div>
                    </div>
                    <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Work Performed</label><textarea value={item.workDescription} onChange={e => updateCompletionItem(idx, 'workDescription', e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none min-h-[60px]" placeholder="Description of work from logbook entry..." /></div>
                  </div>
                </div>
              ))}
              <PrimaryButton onClick={handleCompleteEvent} disabled={isSubmitting}>{isSubmitting ? "Completing..." : "Complete Event & Reset Tracking"}</PrimaryButton>
            </div>
          )}

        </div>
      </div>
    </>
  );
}

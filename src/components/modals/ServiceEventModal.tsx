"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { PrimaryButton } from "@/components/AppButtons";
import { 
  X, Calendar, Wrench, AlertTriangle, Sparkles, CheckCircle, 
  Send, MessageSquare, Clock, ChevronRight, ChevronDown, ExternalLink
} from "lucide-react";

// Common add-on services that owners can request
const ADDON_OPTIONS = [
  "Aircraft Wash & Detail",
  "Engine Oil Change & Top-Off",
  "Hydraulic Fluid Check & Top-Off",
  "Nav Database Update",
  "Tire Inspection & Pressure Check",
  "Interior Cleaning",
  "Pitot-Static System Check",
  "Battery Condition Check",
];

interface ServiceEventModalProps {
  aircraft: any;
  show: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

export default function ServiceEventModal({ aircraft, show, onClose, onRefresh }: ServiceEventModalProps) {
  const [view, setView] = useState<'list' | 'create' | 'detail' | 'complete' | 'review_draft' | 'counter'>('list');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Active events
  const [events, setEvents] = useState<any[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [eventLineItems, setEventLineItems] = useState<any[]>([]);
  const [eventMessages, setEventMessages] = useState<any[]>([]);

  // Create form state
  const [mxItems, setMxItems] = useState<any[]>([]);
  const [squawks, setSquawks] = useState<any[]>([]);
  const [selectedMxIds, setSelectedMxIds] = useState<string[]>([]);
  const [selectedSquawkIds, setSelectedSquawkIds] = useState<string[]>([]);
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  const [proposedDate, setProposedDate] = useState("");

  // Owner scheduling response
  const [ownerMessage, setOwnerMessage] = useState("");

  // Completion form
  const [completionItems, setCompletionItems] = useState<any[]>([]);

  useEffect(() => {
    if (show && aircraft) {
      fetchEvents();
    }
  }, [show, aircraft]);

  const fetchEvents = async () => {
    const { data } = await supabase
      .from('aft_maintenance_events')
      .select('*')
      .eq('aircraft_id', aircraft.id)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });
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
    // Fetch all MX items and open squawks for this aircraft
    const { data: mx } = await supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraft.id).order('due_time').order('due_date');
    const { data: sq } = await supabase.from('aft_squawks').select('*').eq('aircraft_id', aircraft.id).eq('status', 'open').order('created_at', { ascending: false });
    setMxItems(mx || []);
    setSquawks(sq || []);
    setSelectedMxIds([]);
    setSelectedSquawkIds([]);
    setSelectedAddons([]);
    setProposedDate("");
    setView('create');
  };

  const handleCreateEvent = async () => {
    if (selectedMxIds.length === 0 && selectedSquawkIds.length === 0 && selectedAddons.length === 0) {
      return alert("Please select at least one item for the work package.");
    }
    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/mx-events/create', {
        method: 'POST',
        body: JSON.stringify({
          aircraftId: aircraft.id,
          mxItemIds: selectedMxIds,
          squawkIds: selectedSquawkIds,
          addonServices: selectedAddons,
          proposedDate: proposedDate || null,
        })
      });
      if (!res.ok) throw new Error('Failed to create event');
      await fetchEvents();
      setView('list');
    } catch (err: any) {
      alert("Failed to create service event: " + err.message);
    }
    setIsSubmitting(false);
  };

  const handleOwnerConfirm = async () => {
    if (!selectedEvent) return;
    setIsSubmitting(true);
    // Owner confirms the mechanic's proposed date
    await supabase.from('aft_maintenance_events').update({
      status: 'confirmed',
      confirmed_date: selectedEvent.proposed_date,
      confirmed_at: new Date().toISOString(),
    }).eq('id', selectedEvent.id);

    await supabase.from('aft_event_messages').insert({
      event_id: selectedEvent.id,
      sender: 'owner',
      message_type: 'confirm',
      proposed_date: selectedEvent.proposed_date,
      message: ownerMessage || `Confirmed for ${selectedEvent.proposed_date}.`,
    });

    setOwnerMessage("");
    await fetchEventDetail(selectedEvent.id);
    setIsSubmitting(false);
  };

  const handleOwnerCounter = async () => {
    if (!selectedEvent || !proposedDate) return alert("Please select a date.");
    setIsSubmitting(true);

    await supabase.from('aft_maintenance_events').update({
      proposed_date: proposedDate,
      proposed_by: 'owner',
    }).eq('id', selectedEvent.id);

    await supabase.from('aft_event_messages').insert({
      event_id: selectedEvent.id,
      sender: 'owner',
      message_type: 'counter',
      proposed_date: proposedDate,
      message: ownerMessage || `How about ${proposedDate} instead?`,
    });

    setOwnerMessage("");
    setProposedDate("");
    await fetchEventDetail(selectedEvent.id);
    setIsSubmitting(false);
  };

  const handleOwnerComment = async () => {
    if (!selectedEvent || !ownerMessage.trim()) return;
    setIsSubmitting(true);
    await supabase.from('aft_event_messages').insert({
      event_id: selectedEvent.id,
      sender: 'owner',
      message_type: 'comment',
      message: ownerMessage,
    });
    setOwnerMessage("");
    await fetchEventDetail(selectedEvent.id);
    setIsSubmitting(false);
  };

  const handleSendDraft = async () => {
    if (!selectedEvent) return;
    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/mx-events/send-workpackage', {
        method: 'POST',
        body: JSON.stringify({
          eventId: selectedEvent.id,
          additionalMxItemIds: selectedMxIds,
          additionalSquawkIds: selectedSquawkIds,
          addonServices: selectedAddons,
          proposedDate: proposedDate || null,
        })
      });
      if (!res.ok) throw new Error('Failed to send');
      await fetchEvents();
      setView('list');
    } catch (err: any) {
      alert("Failed to send work package: " + err.message);
    }
    setIsSubmitting(false);
  };

  const openDraftReview = async (ev: any) => {
    setSelectedEvent(ev);
    await fetchEventDetail(ev.id);
    // Load MX items and squawks for the add-more flow
    const { data: mx } = await supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraft.id).order('due_time').order('due_date');
    const { data: sq } = await supabase.from('aft_squawks').select('*').eq('aircraft_id', aircraft.id).eq('status', 'open').order('created_at', { ascending: false });
    setMxItems(mx || []);
    setSquawks(sq || []);
    setSelectedMxIds([]);
    setSelectedSquawkIds([]);
    setSelectedAddons([]);
    setProposedDate("");
    setView('review_draft');
  };

  const openCompleteFlow = () => {
    // Pre-populate completion form with line items that need logbook data
    const items = eventLineItems
      .filter(li => li.item_type === 'maintenance' || li.item_type === 'squawk')
      .map(li => ({
        ...li,
        completionDate: "",
        completionTime: "",
        completedByName: "",
        completedByCert: "",
        workDescription: "",
      }));
    setCompletionItems(items);
    setView('complete');
  };

  const handleCompleteEvent = async () => {
    // Validate that at least maintenance items have completion data
    const mxCompletions = completionItems.filter(c => c.item_type === 'maintenance');
    for (const c of mxCompletions) {
      if (!c.completionDate && !c.completionTime) {
        return alert(`Please enter logbook completion data for: ${c.item_name}`);
      }
    }

    setIsSubmitting(true);
    try {
      const lineCompletions = completionItems.map(c => ({
        lineItemId: c.id,
        completionDate: c.completionDate || null,
        completionTime: c.completionTime || null,
        completedByName: c.completedByName || null,
        completedByCert: c.completedByCert || null,
        workDescription: c.workDescription || null,
      }));

      const res = await authFetch('/api/mx-events/complete', {
        method: 'POST',
        body: JSON.stringify({ eventId: selectedEvent.id, lineCompletions })
      });

      if (!res.ok) throw new Error('Failed to complete event');
      await fetchEvents();
      onRefresh(); // Refresh parent MX tab to show reset tracking
      setView('list');
    } catch (err: any) {
      alert("Failed to complete event: " + err.message);
    }
    setIsSubmitting(false);
  };

  const updateCompletionItem = (index: number, field: string, value: string) => {
    setCompletionItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  if (!show) return null;

  const isTurbine = aircraft?.engine_type === 'Turbine';
  const activeEvents = events.filter(e => e.status !== 'complete');
  const completedEvents = events.filter(e => e.status === 'complete');

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded shadow-2xl w-full max-w-lg p-6 border-t-4 border-[#F08B46] max-h-[90vh] overflow-y-auto animate-slide-up" onClick={e => e.stopPropagation()}>

        <div className="flex justify-between items-center mb-6">
          <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2">
            <Wrench size={20} className="text-[#F08B46]" />
            {view === 'create' ? 'Schedule Service' : view === 'detail' ? 'Service Event' : view === 'complete' ? 'Enter Logbook Data' : view === 'review_draft' ? 'Review Draft' : 'Maintenance Events'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500"><X size={24}/></button>
        </div>

        {/* ===================== LIST VIEW ===================== */}
        {view === 'list' && (
          <div className="space-y-4">
            <PrimaryButton onClick={openCreateFlow}>
              <Calendar size={18} /> Schedule New Service
            </PrimaryButton>

            {/* DRAFT EVENTS — prominently displayed with action required */}
            {activeEvents.filter(e => e.status === 'draft').length > 0 && (
              <div className="bg-orange-50 border-2 border-orange-200 rounded p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#F08B46] mb-3 flex items-center gap-1">
                  <AlertTriangle size={12} /> Drafts Awaiting Your Review
                </p>
                {activeEvents.filter(e => e.status === 'draft').map(ev => (
                  <button key={ev.id} onClick={() => openDraftReview(ev)} className="w-full bg-white border-2 border-[#F08B46] p-4 rounded mb-2 text-left flex justify-between items-center hover:bg-orange-50 transition-colors active:scale-[0.98]">
                    <div>
                      <span className="text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white bg-[#F08B46]">draft — review & send</span>
                      <p className="text-[10px] text-gray-500 mt-1">Auto-created {new Date(ev.created_at).toLocaleDateString()}</p>
                    </div>
                    <ChevronRight size={18} className="text-[#F08B46]" />
                  </button>
                ))}
              </div>
            )}

            {/* ACTIVE EVENTS (non-draft) */}
            {activeEvents.filter(e => e.status !== 'draft').length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Active</p>
                {activeEvents.filter(e => e.status !== 'draft').map(ev => (
                  <button key={ev.id} onClick={() => { setSelectedEvent(ev); fetchEventDetail(ev.id); setView('detail'); }} className="w-full bg-gray-50 border border-gray-200 p-4 rounded mb-2 text-left flex justify-between items-center hover:border-[#F08B46] transition-colors active:scale-[0.98]">
                    <div>
                      <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white ${ev.status === 'confirmed' ? 'bg-[#3AB0FF]' : ev.status === 'in_progress' ? 'bg-[#56B94A]' : 'bg-gray-500'}`}>{ev.status}</span>
                      <p className="font-bold text-navy text-sm mt-1">{ev.confirmed_date || ev.proposed_date || 'Pending'}</p>
                      <p className="text-[10px] text-gray-500">Created {new Date(ev.created_at).toLocaleDateString()}</p>
                    </div>
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
                    <div>
                      <span className="text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white bg-[#56B94A]">complete</span>
                      <p className="text-[10px] text-gray-500 mt-1">Completed {ev.completed_at ? new Date(ev.completed_at).toLocaleDateString() : ''}</p>
                    </div>
                    <ChevronRight size={18} className="text-gray-400" />
                  </button>
                ))}
              </div>
            )}

            {events.length === 0 && (
              <p className="text-center text-sm text-gray-400 italic py-4">No maintenance events yet. Schedule your first service above.</p>
            )}
          </div>
        )}

        {/* ===================== CREATE VIEW ===================== */}
        {view === 'create' && (
          <div className="space-y-6">
            <button onClick={() => setView('list')} className="text-[10px] font-bold uppercase tracking-widest text-[#F08B46] hover:text-orange-600 mb-2">← Back to Events</button>

            {/* MX Items */}
            {mxItems.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Wrench size={14} className="text-[#F08B46]" /> Maintenance Items Due</p>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {mxItems.map(mx => (
                    <label key={mx.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={selectedMxIds.includes(mx.id)} onChange={() => setSelectedMxIds(prev => prev.includes(mx.id) ? prev.filter(id => id !== mx.id) : [...prev, mx.id])} className="mt-1 w-4 h-4 text-[#F08B46] border-gray-300 rounded" />
                      <div>
                        <span className="font-bold text-sm text-navy">{mx.item_name}</span>
                        <span className="block text-[10px] text-gray-500">{mx.tracking_type === 'time' ? `Due @ ${mx.due_time} hrs` : `Due ${mx.due_date}`}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Squawks */}
            {squawks.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><AlertTriangle size={14} className="text-[#CE3732]" /> Open Squawks</p>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {squawks.map(sq => (
                    <label key={sq.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={selectedSquawkIds.includes(sq.id)} onChange={() => setSelectedSquawkIds(prev => prev.includes(sq.id) ? prev.filter(id => id !== sq.id) : [...prev, sq.id])} className="mt-1 w-4 h-4 text-[#CE3732] border-gray-300 rounded" />
                      <div>
                        <span className="font-bold text-sm text-navy">{sq.location}</span>
                        <span className="block text-[10px] text-gray-500 line-clamp-1">{sq.description}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Add-On Services */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Sparkles size={14} className="text-[#3AB0FF]" /> Additional Services</p>
              <div className="grid grid-cols-2 gap-2">
                {ADDON_OPTIONS.map(addon => (
                  <label key={addon} className="flex items-center gap-2 p-2 border border-gray-200 rounded cursor-pointer hover:bg-blue-50 text-xs">
                    <input type="checkbox" checked={selectedAddons.includes(addon)} onChange={() => setSelectedAddons(prev => prev.includes(addon) ? prev.filter(a => a !== addon) : [...prev, addon])} className="w-3.5 h-3.5 text-[#3AB0FF] border-gray-300 rounded" />
                    <span className="text-navy font-bold">{addon}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Proposed Date */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Preferred Service Date (Optional)</label>
              <input type="date" value={proposedDate} onChange={e => setProposedDate(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
            </div>

            <PrimaryButton onClick={handleCreateEvent} disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Send Work Package to Mechanic"}
            </PrimaryButton>
          </div>
        )}

        {/* ===================== REVIEW DRAFT VIEW ===================== */}
        {view === 'review_draft' && selectedEvent && (
          <div className="space-y-6">
            <button onClick={() => { setSelectedEvent(null); setView('list'); }} className="text-[10px] font-bold uppercase tracking-widest text-[#F08B46] hover:text-orange-600">← Back to Events</button>

            <div className="bg-orange-50 border border-orange-200 rounded p-4">
              <p className="text-sm text-navy font-bold mb-1">System-Generated Draft</p>
              <p className="text-xs text-gray-600">This work package was created automatically because maintenance is approaching. Review the items below, add anything else you need, and send it to your mechanic.</p>
            </div>

            {/* Existing line items already in the draft */}
            {eventLineItems.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2">Already Included</p>
                <div className="space-y-2">
                  {eventLineItems.map(li => (
                    <div key={li.id} className="p-3 bg-white border border-gray-200 rounded">
                      <span className="font-bold text-sm text-navy">{li.item_name}</span>
                      {li.item_description && <span className="block text-[10px] text-gray-500">{li.item_description}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Additional MX items the owner can add */}
            {mxItems.filter(mx => !eventLineItems.some(li => li.maintenance_item_id === mx.id)).length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Wrench size={14} className="text-[#F08B46]" /> Add More Maintenance Items</p>
                <div className="space-y-2 max-h-[160px] overflow-y-auto">
                  {mxItems.filter(mx => !eventLineItems.some(li => li.maintenance_item_id === mx.id)).map(mx => (
                    <label key={mx.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={selectedMxIds.includes(mx.id)} onChange={() => setSelectedMxIds(prev => prev.includes(mx.id) ? prev.filter(id => id !== mx.id) : [...prev, mx.id])} className="mt-1 w-4 h-4 text-[#F08B46] border-gray-300 rounded" />
                      <div>
                        <span className="font-bold text-sm text-navy">{mx.item_name}</span>
                        <span className="block text-[10px] text-gray-500">{mx.tracking_type === 'time' ? `Due @ ${mx.due_time} hrs` : `Due ${mx.due_date}`}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Squawks */}
            {squawks.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><AlertTriangle size={14} className="text-[#CE3732]" /> Add Open Squawks</p>
                <div className="space-y-2 max-h-[160px] overflow-y-auto">
                  {squawks.map(sq => (
                    <label key={sq.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={selectedSquawkIds.includes(sq.id)} onChange={() => setSelectedSquawkIds(prev => prev.includes(sq.id) ? prev.filter(id => id !== sq.id) : [...prev, sq.id])} className="mt-1 w-4 h-4 text-[#CE3732] border-gray-300 rounded" />
                      <div>
                        <span className="font-bold text-sm text-navy">{sq.location}</span>
                        <span className="block text-[10px] text-gray-500 line-clamp-1">{sq.description}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Add-on services */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Sparkles size={14} className="text-[#3AB0FF]" /> Additional Services</p>
              <div className="grid grid-cols-2 gap-2">
                {ADDON_OPTIONS.map(addon => (
                  <label key={addon} className="flex items-center gap-2 p-2 border border-gray-200 rounded cursor-pointer hover:bg-blue-50 text-xs">
                    <input type="checkbox" checked={selectedAddons.includes(addon)} onChange={() => setSelectedAddons(prev => prev.includes(addon) ? prev.filter(a => a !== addon) : [...prev, addon])} className="w-3.5 h-3.5 text-[#3AB0FF] border-gray-300 rounded" />
                    <span className="text-navy font-bold">{addon}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Preferred date */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Preferred Service Date (Optional)</label>
              <input type="date" value={proposedDate} onChange={e => setProposedDate(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
            </div>

            <PrimaryButton onClick={handleSendDraft} disabled={isSubmitting}>
              {isSubmitting ? "Sending..." : "Send Work Package to Mechanic"}
            </PrimaryButton>
          </div>
        )}

        {/* ===================== DETAIL VIEW ===================== */}
        {view === 'detail' && selectedEvent && (
          <div className="space-y-5">
            <button onClick={() => { setSelectedEvent(null); setView('list'); }} className="text-[10px] font-bold uppercase tracking-widest text-[#F08B46] hover:text-orange-600">← Back to Events</button>

            {/* Status & Dates */}
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <div className="flex justify-between items-center mb-3">
                <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded text-white ${selectedEvent.status === 'confirmed' ? 'bg-[#3AB0FF]' : selectedEvent.status === 'complete' ? 'bg-[#56B94A]' : 'bg-[#F08B46]'}`}>{selectedEvent.status}</span>
                {selectedEvent.access_token && selectedEvent.status !== 'complete' && (
                  <a href={`/service/${selectedEvent.access_token}`} target="_blank" rel="noreferrer" className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] flex items-center gap-1 hover:underline">
                    <ExternalLink size={12} /> Mechanic Portal
                  </a>
                )}
              </div>
              {selectedEvent.confirmed_date && <p className="text-sm"><strong className="text-navy">Confirmed:</strong> {selectedEvent.confirmed_date}</p>}
              {selectedEvent.proposed_date && !selectedEvent.confirmed_date && <p className="text-sm"><strong className="text-navy">Proposed:</strong> {selectedEvent.proposed_date} <span className="text-gray-400">(by {selectedEvent.proposed_by})</span></p>}
              {selectedEvent.estimated_completion && <p className="text-sm mt-1"><strong className="text-navy">Est. Completion:</strong> {selectedEvent.estimated_completion}</p>}
              {selectedEvent.mechanic_notes && <p className="text-xs text-gray-500 mt-2 italic">{selectedEvent.mechanic_notes}</p>}
            </div>

            {/* Scheduling Actions (owner side of the ping-pong) */}
            {selectedEvent.status === 'scheduling' && selectedEvent.proposed_by === 'mechanic' && (
              <div className="bg-orange-50 border border-orange-200 rounded p-4 space-y-3">
                <p className="text-sm font-bold text-navy">{selectedEvent.mx_contact_name || 'Mechanic'} proposed <strong>{selectedEvent.proposed_date}</strong></p>
                <div className="flex gap-2">
                  <button onClick={handleOwnerConfirm} disabled={isSubmitting} className="flex-1 bg-[#56B94A] text-white font-oswald font-bold uppercase tracking-widest py-2 rounded text-xs active:scale-95 disabled:opacity-50">Confirm</button>
                  <button onClick={() => setView('counter')} className="flex-1 bg-[#F08B46] text-white font-oswald font-bold uppercase tracking-widest py-2 rounded text-xs active:scale-95">Counter</button>
                </div>
                {/* Inline counter */}
                <div className="space-y-2 pt-2">
                  <input type="date" value={proposedDate} onChange={e => setProposedDate(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm focus:border-[#F08B46] outline-none" />
                  <textarea value={ownerMessage} onChange={e => setOwnerMessage(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm focus:border-[#F08B46] outline-none min-h-[50px]" placeholder="Message (optional)" />
                  <button onClick={handleOwnerCounter} disabled={isSubmitting || !proposedDate} className="w-full bg-[#F08B46] text-white font-oswald font-bold uppercase tracking-widest py-2 rounded text-xs active:scale-95 disabled:opacity-50">Send Counter Proposal</button>
                </div>
              </div>
            )}

            {/* Line Items Summary */}
            {eventLineItems.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Work Package</p>
                <div className="space-y-2">
                  {eventLineItems.map(li => (
                    <div key={li.id} className={`p-3 border rounded text-sm ${li.line_status === 'complete' ? 'bg-green-50 border-green-200' : li.line_status === 'in_progress' ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-navy">{li.item_name}</span>
                        <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${li.line_status === 'complete' ? 'bg-green-100 text-green-700' : li.line_status === 'in_progress' ? 'bg-blue-100 text-blue-700' : li.line_status === 'deferred' ? 'bg-gray-100 text-gray-600' : 'bg-orange-100 text-orange-700'}`}>{li.line_status}</span>
                      </div>
                      {li.mechanic_comment && <p className="text-[10px] text-[#3AB0FF] mt-1 italic">{li.mechanic_comment}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Message Thread */}
            {eventMessages.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Messages</p>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {eventMessages.map(msg => (
                    <div key={msg.id} className={`p-2 rounded text-xs ${msg.sender === 'mechanic' ? 'bg-blue-50 border-l-4 border-[#3AB0FF]' : msg.sender === 'owner' ? 'bg-orange-50 border-l-4 border-[#F08B46]' : 'bg-gray-50 border-l-4 border-gray-300'}`}>
                      <span className="text-[8px] font-bold uppercase text-gray-400">{msg.sender} • {new Date(msg.created_at).toLocaleString()}</span>
                      <p className="text-navy mt-1">{msg.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Owner comment box */}
            {selectedEvent.status !== 'complete' && (
              <div className="flex gap-2">
                <textarea value={ownerMessage} onChange={e => setOwnerMessage(e.target.value)} className="flex-1 border border-gray-300 rounded p-2 text-sm focus:border-[#3AB0FF] outline-none min-h-[50px]" placeholder="Send a message..." />
                <button onClick={handleOwnerComment} disabled={isSubmitting || !ownerMessage.trim()} className="bg-[#3AB0FF] text-white px-3 rounded active:scale-95 disabled:opacity-50"><Send size={16}/></button>
              </div>
            )}

            {/* Complete Event Button — available from any active status */}
            {selectedEvent.status !== 'complete' && selectedEvent.status !== 'cancelled' && (
              <button onClick={openCompleteFlow} className="w-full bg-[#56B94A] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 transition-transform flex items-center justify-center gap-2">
                <CheckCircle size={18} /> Enter Logbook Data & Complete
              </button>
            )}
          </div>
        )}

        {/* ===================== COMPLETION VIEW ===================== */}
        {view === 'complete' && selectedEvent && (
          <div className="space-y-5">
            <button onClick={() => setView('detail')} className="text-[10px] font-bold uppercase tracking-widest text-[#F08B46] hover:text-orange-600">← Back to Event</button>
            
            <p className="text-sm text-gray-600">Enter the logbook data from your mechanic's sign-off. These times and dates will reset the tracking for each item.</p>

            {completionItems.map((item, idx) => (
              <div key={item.id} className="bg-gray-50 border border-gray-200 rounded p-4 space-y-3">
                <div className="flex items-center gap-2">
                  {item.item_type === 'maintenance' ? <Wrench size={14} className="text-[#F08B46]" /> : <AlertTriangle size={14} className="text-[#CE3732]" />}
                  <h4 className="font-oswald font-bold uppercase text-sm text-navy">{item.item_name}</h4>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Completion Date</label>
                    <input type="date" value={item.completionDate} onChange={e => updateCompletionItem(idx, 'completionDate', e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Completion {isTurbine ? 'FTT' : 'Tach'}</label>
                    <input type="number" step="0.1" value={item.completionTime} onChange={e => updateCompletionItem(idx, 'completionTime', e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="Engine time" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Signed By (Name)</label>
                    <input type="text" value={item.completedByName} onChange={e => updateCompletionItem(idx, 'completedByName', e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="IA / A&P" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Certificate #</label>
                    <input type="text" value={item.completedByCert} onChange={e => updateCompletionItem(idx, 'completedByCert', e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Work Performed</label>
                  <textarea value={item.workDescription} onChange={e => updateCompletionItem(idx, 'workDescription', e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none min-h-[60px]" placeholder="Description of work from logbook entry..." />
                </div>
              </div>
            ))}

            <PrimaryButton onClick={handleCompleteEvent} disabled={isSubmitting}>
              {isSubmitting ? "Completing..." : "Complete Event & Reset Tracking"}
            </PrimaryButton>
          </div>
        )}

      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { Wrench, X } from "lucide-react";
import Toast from "@/components/Toast";
import type { ServiceEventView } from "./service-event/shared";

import ServiceEventList from "./service-event/ServiceEventList";
import ServiceEventCreate from "./service-event/ServiceEventCreate";
import ServiceEventDetail from "./service-event/ServiceEventDetail";
import ServiceEventComplete from "./service-event/ServiceEventComplete";
import DateProposalSection from "./service-event/DateProposalSection";
import EmailPreview from "./service-event/EmailPreview";
import { ADDON_OPTIONS, INPUT_WHITE_BG } from "./service-event/shared";
import { ChevronDown, AlertTriangle, Sparkles, CheckSquare } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";

interface ServiceEventModalProps {
  aircraft: any;
  show: boolean;
  onClose: () => void;
  onRefresh: () => void;
  canManageService?: boolean;
}

export default function ServiceEventModal({ aircraft, show, onClose, onRefresh, canManageService = true }: ServiceEventModalProps) {
  const [view, setView] = useState<ServiceEventView>('list');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [events, setEvents] = useState<any[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [eventLineItems, setEventLineItems] = useState<any[]>([]);
  const [eventMessages, setEventMessages] = useState<any[]>([]);

  const [mxItems, setMxItems] = useState<any[]>([]);
  const [squawks, setSquawks] = useState<any[]>([]);

  // Draft review state
  const [selectedMxIds, setSelectedMxIds] = useState<string[]>([]);
  const [selectedSquawkIds, setSelectedSquawkIds] = useState<string[]>([]);
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  const [proposedDate, setProposedDate] = useState("");
  const [wantsToPropose, setWantsToPropose] = useState<boolean | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const [viewingAttachment, setViewingAttachment] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);
  const showSuccess = useCallback((msg: string) => { setToastMessage(msg); setShowToast(true); }, []);

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
    const [{ data: ev }, { data: lines }, { data: msgs }] = await Promise.all([
      supabase.from('aft_maintenance_events').select('*').eq('id', eventId).single(),
      supabase.from('aft_event_line_items').select('*').eq('event_id', eventId).order('created_at'),
      supabase.from('aft_event_messages').select('*').eq('event_id', eventId).order('created_at'),
    ]);
    if (ev) setSelectedEvent(ev);
    setEventLineItems(lines || []);
    setEventMessages(msgs || []);
  };

  const loadMxAndSquawks = async () => {
    const [{ data: mx }, { data: sq }] = await Promise.all([
      supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraft.id).order('due_time').order('due_date'),
      supabase.from('aft_squawks').select('*').eq('aircraft_id', aircraft.id).eq('status', 'open').order('created_at', { ascending: false }),
    ]);
    setMxItems(mx || []);
    setSquawks(sq || []);
  };

  const handleNavigate = async (newView: ServiceEventView, event?: any) => {
    if (newView === 'detail' && event) {
      setSelectedEvent(event);
      await fetchEventDetail(event.id);
    }
    if (newView === 'complete' && event) {
      setSelectedEvent(event);
      if (eventLineItems.length === 0 || eventLineItems[0]?.event_id !== event.id) {
        await fetchEventDetail(event.id);
      }
    }
    if (newView === 'list') {
      await fetchEvents();
    }
    setView(newView);
  };

  const openCreateFlow = async () => {
    await loadMxAndSquawks();
    setView('create');
  };

  const openDraftReview = async (ev: any) => {
    setSelectedEvent(ev);
    await fetchEventDetail(ev.id);
    await loadMxAndSquawks();
    setSelectedMxIds([]);
    setSelectedSquawkIds([]);
    setSelectedAddons([]);
    setProposedDate("");
    setWantsToPropose(null);
    setShowPreview(false);
    setView('review_draft');
  };

  const handleSendDraft = async () => {
    if (!selectedEvent) return;
    if (wantsToPropose === null) return alert("Please choose whether you'd like to propose a date or request availability.");
    if (wantsToPropose && !proposedDate) return alert("Please select a preferred service date or choose 'Request Availability' instead.");
    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/mx-events/send-workpackage', { method: 'POST', body: JSON.stringify({ eventId: selectedEvent.id, additionalMxItemIds: selectedMxIds, additionalSquawkIds: selectedSquawkIds, addonServices: selectedAddons, proposedDate: wantsToPropose ? proposedDate : null }) });
      if (!res.ok) throw new Error('Failed to send');
      await fetchEvents();
      showSuccess("Work package sent to mechanic");
      setView('list');
    } catch (err: any) { alert("Failed to send work package: " + err.message); }
    setIsSubmitting(false);
  };

  const handleRefresh = () => {
    fetchEvents();
    onRefresh();
  };

  const childProps = {
    aircraft,
    isSubmitting,
    setIsSubmitting,
    onNavigate: handleNavigate,
    onRefresh: handleRefresh,
    showSuccess,
    canManageService,
  };

  if (!show) return null;

  const viewTitle = {
    list: 'Maintenance Events',
    create: 'Schedule Service',
    detail: 'Service Event',
    complete: 'Enter Logbook Data',
    review_draft: 'Review Draft',
    counter: 'Counter Proposal',
  }[view];

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
              <Wrench size={20} className="text-[#F08B46]" /> {viewTitle}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-red-500 p-2 -mr-2"><X size={24}/></button>
          </div>

          {view === 'list' && (
            <ServiceEventList {...childProps} events={events} onOpenCreateFlow={openCreateFlow} onOpenDraftReview={openDraftReview} onOpenDetail={(ev) => handleNavigate('detail', ev)} />
          )}

          {view === 'create' && (
            <ServiceEventCreate {...childProps} mxItems={mxItems} squawks={squawks} />
          )}

          {view === 'detail' && selectedEvent && (
            <ServiceEventDetail {...childProps} selectedEvent={selectedEvent} eventLineItems={eventLineItems} eventMessages={eventMessages} fetchEventDetail={fetchEventDetail} setViewingAttachment={setViewingAttachment} />
          )}

          {view === 'complete' && selectedEvent && (
            <ServiceEventComplete {...childProps} selectedEvent={selectedEvent} eventLineItems={eventLineItems} />
          )}

          {/* Draft review — inline since it reuses pieces from Create but with existing line items */}
          {view === 'review_draft' && selectedEvent && (
            <div className="space-y-6">
              <button onClick={() => handleNavigate('list')} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#F08B46] bg-orange-50 border border-orange-200 rounded px-3 py-1.5 hover:bg-orange-100 active:scale-95 transition-all"><ChevronDown size={12} className="rotate-90" /> Back to Events</button>
              <div className="bg-orange-50 border border-orange-200 rounded p-4"><p className="text-sm text-navy font-bold mb-1">System-Generated Draft</p><p className="text-xs text-gray-600">Review the items below, add anything else you need, and send it to your mechanic.</p></div>

              {eventLineItems.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2">Already Included</p>
                  <div className="space-y-2">{eventLineItems.map(li => (<div key={li.id} className="p-3 bg-white border border-gray-200 rounded"><span className="font-bold text-sm text-navy">{li.item_name}</span>{li.item_description && <span className="block text-[10px] text-gray-500">{li.item_description}</span>}</div>))}</div>
                </div>
              )}

              {/* Additional MX items */}
              {(() => {
                const availableMx = mxItems.filter(mx => !eventLineItems.some(li => li.maintenance_item_id === mx.id));
                if (availableMx.length === 0) return null;
                const allSelected = availableMx.every(mx => selectedMxIds.includes(mx.id));
                return (
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-navy flex items-center gap-2"><Wrench size={14} className="text-[#F08B46]" /> Add More Maintenance Items</p>
                      <button type="button" onClick={() => { const ids = availableMx.map(mx => mx.id); if (allSelected) setSelectedMxIds(prev => prev.filter(id => !ids.includes(id))); else setSelectedMxIds(prev => Array.from(new Set([...prev, ...ids]))); }} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#F08B46] hover:opacity-80 active:scale-95"><CheckSquare size={12} /> {allSelected ? 'Deselect All' : 'Select All'}</button>
                    </div>
                    <div className="space-y-3 pb-1">{availableMx.map(mx => (<label key={mx.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50"><input type="checkbox" checked={selectedMxIds.includes(mx.id)} onChange={() => setSelectedMxIds(prev => prev.includes(mx.id) ? prev.filter(id => id !== mx.id) : [...prev, mx.id])} className="mt-1 w-4 h-4 text-[#F08B46] border-gray-300 rounded" /><div><span className="font-bold text-sm text-navy">{mx.item_name}</span><span className="block text-[10px] text-gray-500">{mx.tracking_type === 'time' ? `Due @ ${mx.due_time} hrs` : `Due ${mx.due_date}`}</span></div></label>))}</div>
                  </div>
                );
              })()}

              {/* Additional squawks */}
              {(() => {
                const availableSquawks = squawks.filter(sq => !eventLineItems.some(li => li.squawk_id === sq.id));
                if (availableSquawks.length === 0) return null;
                const allSelected = availableSquawks.every(sq => selectedSquawkIds.includes(sq.id));
                return (
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-navy flex items-center gap-2"><AlertTriangle size={14} className="text-[#CE3732]" /> Add Squawks</p>
                      <button type="button" onClick={() => { const ids = availableSquawks.map(sq => sq.id); if (allSelected) setSelectedSquawkIds(prev => prev.filter(id => !ids.includes(id))); else setSelectedSquawkIds(prev => Array.from(new Set([...prev, ...ids]))); }} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#CE3732] hover:opacity-80 active:scale-95"><CheckSquare size={12} /> {allSelected ? 'Deselect All' : 'Select All'}</button>
                    </div>
                    <div className="space-y-3 pb-1">{availableSquawks.map(sq => (<label key={sq.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50"><input type="checkbox" checked={selectedSquawkIds.includes(sq.id)} onChange={() => setSelectedSquawkIds(prev => prev.includes(sq.id) ? prev.filter(id => id !== sq.id) : [...prev, sq.id])} className="mt-1 w-4 h-4 text-[#CE3732] border-gray-300 rounded" /><div><span className="font-bold text-sm text-navy">{sq.description || 'No description'}</span>{sq.affects_airworthiness && sq.location && <span className="block text-[10px] font-bold text-[#CE3732]">⚠ Grounded at {sq.location}</span>}<span className="block text-[10px] text-gray-500">Reported {new Date(sq.created_at).toLocaleDateString()}</span></div></label>))}</div>
                  </div>
                );
              })()}

              {/* Addons */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Sparkles size={14} className="text-[#3AB0FF]" /> Additional Services</p>
                <div className="grid grid-cols-2 gap-2">{ADDON_OPTIONS.map(addon => (<label key={addon} className="flex items-center gap-2 p-2 border border-gray-200 rounded cursor-pointer hover:bg-blue-50 text-xs"><input type="checkbox" checked={selectedAddons.includes(addon)} onChange={() => setSelectedAddons(prev => prev.includes(addon) ? prev.filter(a => a !== addon) : [...prev, addon])} className="w-3.5 h-3.5 text-[#3AB0FF] border-gray-300 rounded" /><span className="text-navy font-bold">{addon}</span></label>))}</div>
              </div>

              <DateProposalSection wantsToPropose={wantsToPropose} setWantsToPropose={setWantsToPropose} proposedDate={proposedDate} setProposedDate={setProposedDate} />
              {!showPreview ? (<button onClick={() => setShowPreview(true)} className="w-full text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] hover:underline py-2">Preview Email Before Sending</button>) : (<EmailPreview aircraft={aircraft} mxItems={mxItems.filter(mx => selectedMxIds.includes(mx.id))} squawks={squawks.filter(sq => selectedSquawkIds.includes(sq.id))} selectedAddons={selectedAddons} proposedDate={wantsToPropose ? proposedDate : null} existingLines={eventLineItems} onClose={() => setShowPreview(false)} />)}
              <PrimaryButton onClick={handleSendDraft} disabled={isSubmitting}>{isSubmitting ? "Sending..." : "Send Work Package to Mechanic"}</PrimaryButton>
            </div>
          )}

        </div>
      </div>
    </>
  );
}

"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { authFetch, UPLOAD_TIMEOUT_MS } from "@/lib/authFetch";
import { idempotencyHeader } from "@/lib/idempotencyClient";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { Wrench, X, Trash2 } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import type { ServiceEventView } from "./service-event/shared";

import ServiceEventList from "./service-event/ServiceEventList";
import ServiceEventCreate from "./service-event/ServiceEventCreate";
import ServiceEventDetail from "./service-event/ServiceEventDetail";
import ServiceEventComplete from "./service-event/ServiceEventComplete";
import DateProposalSection from "./service-event/DateProposalSection";
import EmailPreview from "./service-event/EmailPreview";
import { ADDON_OPTIONS } from "./service-event/shared";
import { ChevronDown, AlertTriangle, Sparkles, CheckSquare } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";

interface ServiceEventModalProps {
  aircraft: any;
  show: boolean;
  onClose: () => void;
  onRefresh: () => void;
  canManageService?: boolean;
  /** When set, opening the modal jumps directly to the create view with
   * this maintenance item pre-selected. Used by the MX projected-due
   * banner so the pilot still sees the review/send flow. */
  preSelectMxItemId?: string | null;
}

export default function ServiceEventModal({ aircraft, show, onClose, onRefresh, canManageService = true, preSelectMxItemId }: ServiceEventModalProps) {
  useModalScrollLock(show);
  useEscapeKey(onClose, show);
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
  const [removedLineItemIds, setRemovedLineItemIds] = useState<string[]>([]);

  const [viewingAttachment, setViewingAttachment] = useState<string | null>(null);
  const { showSuccess, showError, showWarning } = useToast();

  // Body scroll lock comes from useModalScrollLock(show) above; the
  // earlier imperative block here was a duplicate that fought the hook
  // for the cleanup value.

  useEffect(() => {
    if (show && aircraft) {
      if (preSelectMxItemId) {
        // Jump into the create flow with this item pre-selected so
        // the pilot still reviews/sends rather than firing an email
        // on a single tap.
        openCreateFlow();
      } else {
        fetchEvents();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, aircraft, preSelectMxItemId]);

  const fetchEvents = async () => {
    const { data, error } = await supabase
      .from('aft_maintenance_events').select('*').eq('aircraft_id', aircraft.id).is('deleted_at', null)
      .neq('status', 'cancelled').order('created_at', { ascending: false });
    if (error) {
      showError("Couldn't load service events. Pull to refresh.");
      setView('list');
      return;
    }
    setEvents(data || []);
    setView('list');
  };

  const fetchEventDetail = async (eventId: string) => {
    const [evRes, linesRes, msgsRes] = await Promise.all([
      supabase.from('aft_maintenance_events').select('*').eq('id', eventId).is('deleted_at', null).maybeSingle(),
      supabase.from('aft_event_line_items').select('*').eq('event_id', eventId).is('deleted_at', null).order('created_at'),
      supabase.from('aft_event_messages').select('*').eq('event_id', eventId).order('created_at'),
    ]);
    // Surface partial-load failures — silent missing line items would
    // otherwise look like the event has no work scope.
    if (evRes.error || linesRes.error || msgsRes.error) {
      showError("Couldn't load the full service event. Pull to refresh.");
      return;
    }
    if (evRes.data) setSelectedEvent(evRes.data);
    setEventLineItems(linesRes.data || []);
    setEventMessages(msgsRes.data || []);
  };

  const loadMxAndSquawks = async () => {
    const [mxRes, sqRes] = await Promise.all([
      supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraft.id).is('deleted_at', null).order('due_time').order('due_date'),
      supabase.from('aft_squawks').select('*').eq('aircraft_id', aircraft.id).eq('status', 'open').is('deleted_at', null).order('occurred_at', { ascending: false }).order('created_at', { ascending: false }),
    ]);
    if (mxRes.error || sqRes.error) {
      showError("Couldn't load MX items / squawks for this event.");
      return;
    }
    setMxItems(mxRes.data || []);
    setSquawks(sqRes.data || []);
  };

  /** Collect IDs of MX items and squawks already in draft/active events */
  const getDraftedItemIds = () => {
    const draftedMxIds: string[] = [];
    const draftedSquawkIds: string[] = [];
    // We'd need line items from all active events to know this.
    // For now, fetch them when opening the create flow.
    return { draftedMxIds, draftedSquawkIds };
  };

  // Store line items from all active events to filter in create flow
  const [allActiveLineItems, setAllActiveLineItems] = useState<any[]>([]);

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
      return;
    }
    setView(newView);
  };

  const openCreateFlow = async () => {
    await loadMxAndSquawks();
    // Fetch line items from all active events to know which items are already drafted
    const activeEventIds = events
      .filter(e => ['draft', 'scheduling', 'confirmed', 'in_progress'].includes(e.status))
      .map(e => e.id);
    if (activeEventIds.length > 0) {
      const { data: allLines, error: linesErr } = await supabase
        .from('aft_event_line_items').select('maintenance_item_id, squawk_id')
        .in('event_id', activeEventIds);
      if (linesErr) {
        // Without these the create flow would let the user re-add an
        // item that's already on a draft — surface so they can retry.
        showError("Couldn't load drafted items. Some items may show as available even if already drafted.");
        setAllActiveLineItems([]);
      } else {
        setAllActiveLineItems(allLines || []);
      }
    } else {
      setAllActiveLineItems([]);
    }
    setView('create');
  };

  const openDraftReview = async (ev: any) => {
    setSelectedEvent(ev);
    await fetchEventDetail(ev.id);
    await loadMxAndSquawks();
    setSelectedMxIds([]);
    setSelectedSquawkIds([]);
    setSelectedAddons([]);
    setRemovedLineItemIds([]);
    setShowPreview(false);
    // Restore date preference from the event if it was saved during draft creation
    if (ev.proposed_date) {
      setWantsToPropose(true);
      setProposedDate(ev.proposed_date);
    } else {
      // If no proposed date but event exists, check if it was explicitly "request availability"
      // For now default to null so user must choose
      setWantsToPropose(null);
      setProposedDate("");
    }
    setView('review_draft');
  };

  const handleRemoveLineItem = async (lineItemId: string) => {
    setRemovedLineItemIds(prev => [...prev, lineItemId]);
  };

  const handleSendDraft = async () => {
    if (!selectedEvent) return;
    if (isSubmitting) return;
    if (wantsToPropose === null) return showWarning("Pick a preferred date, or choose 'Request Availability' to let your mechanic propose.");
    if (wantsToPropose && !proposedDate) return showWarning("Enter a date, or switch to 'Request Availability'.");
    setIsSubmitting(true);
    try {
      // Remove any line items the user unchecked from the draft
      if (removedLineItemIds.length > 0) {
        await supabase.from('aft_event_line_items').delete().in('id', removedLineItemIds);
      }

      const idemKey = crypto.randomUUID();
      const res = await authFetch('/api/mx-events/send-workpackage', {
        method: 'POST',
        timeoutMs: UPLOAD_TIMEOUT_MS,
        headers: idempotencyHeader(idemKey),
        body: JSON.stringify({
          eventId: selectedEvent.id,
          additionalMxItemIds: selectedMxIds,
          additionalSquawkIds: selectedSquawkIds,
          addonServices: selectedAddons,
          proposedDate: wantsToPropose ? proposedDate : null,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Couldn't send the work package");
      }
      showSuccess("Work package sent to mechanic");
      fetchEvents();
      onRefresh();
    } catch (err: any) {
      showError("Couldn't send the work package: " + err.message);
    }
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
    showError,
    showWarning,
    canManageService,
  };

  if (!show) return null;
  if (typeof document === 'undefined') return null;

  // Compute drafted item IDs for the create flow
  const draftedMxIds = allActiveLineItems.filter(li => li.maintenance_item_id).map(li => li.maintenance_item_id);
  const draftedSquawkIds = allActiveLineItems.filter(li => li.squawk_id).map(li => li.squawk_id);

  // For the draft review, filter out removed items from the visible list
  const visibleLineItems = eventLineItems.filter(li => !removedLineItemIds.includes(li.id));

  const viewTitle = {
    list: 'Service Events',
    create: 'Schedule Service',
    detail: 'Service Event',
    complete: 'Enter Logbook Data',
    review_draft: 'Review & Send Draft',
    counter: 'Counter Proposal',
  }[view];

  return createPortal(
    <>
      {viewingAttachment && (
        <div className="fixed inset-0 z-[10002] bg-black/90 flex items-center justify-center p-4 animate-fade-in" onClick={() => setViewingAttachment(null)}>
          <button onClick={() => setViewingAttachment(null)} className="absolute top-4 right-4 text-white hover:text-gray-300 z-10"><X size={32}/></button>
          <img src={viewingAttachment} alt="Attachment" className="max-w-full max-h-[90vh] rounded-lg shadow-2xl" />
        </div>
      )}

      <div className="fixed inset-0 bg-black/60 z-[10000] animate-fade-in" onClick={onClose}>
        <div
          className="absolute left-0 right-0 overflow-y-auto modal-scroll"
          style={{
            /* Actual chrome heights — header is 60px (min-h-[60px]),
               nav is 52px (pt-1 + h-12). Safe-area insets add to each. */
            top: 'calc(60px + env(safe-area-inset-top, 0px))',
            bottom: 'calc(52px + env(safe-area-inset-bottom, 0px))',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
          }}
        >
        <div className="flex min-h-full items-center justify-center p-4">
        <div className="bg-white rounded shadow-2xl w-full max-w-lg p-5 border-t-4 border-mxOrange animate-slide-up" onClick={e => e.stopPropagation()}>

          <div className="flex justify-between items-center mb-6">
            <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2">
              <Wrench size={20} className="text-mxOrange" /> {viewTitle}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-danger p-2 -mr-2"><X size={24}/></button>
          </div>

          {view === 'list' && (
            <ServiceEventList {...childProps} events={events} onOpenCreateFlow={openCreateFlow} onOpenDraftReview={openDraftReview} onOpenDetail={(ev) => handleNavigate('detail', ev)} />
          )}

          {view === 'create' && (
            <ServiceEventCreate {...childProps} mxItems={mxItems} squawks={squawks} draftedMxIds={draftedMxIds} draftedSquawkIds={draftedSquawkIds} preSelectedMxIds={preSelectMxItemId ? [preSelectMxItemId] : undefined} />
          )}

          {view === 'detail' && selectedEvent && (
            <ServiceEventDetail {...childProps} selectedEvent={selectedEvent} eventLineItems={eventLineItems} eventMessages={eventMessages} fetchEventDetail={fetchEventDetail} setViewingAttachment={setViewingAttachment} />
          )}

          {view === 'complete' && selectedEvent && (
            <ServiceEventComplete {...childProps} selectedEvent={selectedEvent} eventLineItems={eventLineItems} />
          )}

          {/* Draft review — allows removing existing items, adding new ones, and setting date preference */}
          {view === 'review_draft' && selectedEvent && (
            <div className="space-y-6">
              <button onClick={() => handleNavigate('list')} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mxOrange bg-orange-50 border border-orange-200 rounded px-3 py-1.5 hover:bg-orange-100 active:scale-95 transition-all"><ChevronDown size={12} className="rotate-90" /> Back to Events</button>
              <div className="bg-orange-50 border border-orange-200 rounded p-4"><p className="text-sm text-navy font-bold mb-1">Draft Work Package</p><p className="text-xs text-gray-600">Review what's bundled, add or remove items, then send. Nothing goes out to your mechanic until you tap send.</p></div>

              {/* Existing line items — removable */}
              {visibleLineItems.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2">Included Items</p>
                  <div className="space-y-2">
                    {visibleLineItems.map(li => (
                      <div key={li.id} className="p-3 bg-white border border-gray-200 rounded flex justify-between items-start">
                        <div>
                          <span className="font-bold text-sm text-navy">{li.item_name}</span>
                          {li.item_description && <span className="block text-[10px] text-gray-500">{li.item_description}</span>}
                        </div>
                        <button onClick={() => handleRemoveLineItem(li.id)} className="text-gray-300 hover:text-danger transition-colors active:scale-95 shrink-0 ml-3 p-1" title="Remove from draft">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {visibleLineItems.length === 0 && eventLineItems.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded p-3">
                  <p className="text-xs text-danger font-bold text-center">Every item has been removed. Add at least one below, or go back.</p>
                </div>
              )}

              {/* Additional MX items */}
              {(() => {
                const availableMx = mxItems.filter(mx => !visibleLineItems.some(li => li.maintenance_item_id === mx.id));
                if (availableMx.length === 0) return null;
                const allSelected = availableMx.every(mx => selectedMxIds.includes(mx.id));
                return (
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-navy flex items-center gap-2"><Wrench size={14} className="text-mxOrange" /> Add More Maintenance Items</p>
                      <button type="button" onClick={() => { const ids = availableMx.map(mx => mx.id); if (allSelected) setSelectedMxIds(prev => prev.filter(id => !ids.includes(id))); else setSelectedMxIds(prev => Array.from(new Set([...prev, ...ids]))); }} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-mxOrange hover:opacity-80 active:scale-95"><CheckSquare size={12} /> {allSelected ? 'Deselect All' : 'Select All'}</button>
                    </div>
                    <div className="space-y-3 pb-1">{availableMx.map(mx => (<label key={mx.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50"><input type="checkbox" checked={selectedMxIds.includes(mx.id)} onChange={() => setSelectedMxIds(prev => prev.includes(mx.id) ? prev.filter(id => id !== mx.id) : [...prev, mx.id])} className="mt-1 w-4 h-4 text-mxOrange border-gray-300 rounded" /><div><span className="font-bold text-sm text-navy">{mx.item_name}</span><span className="block text-[10px] text-gray-500">{mx.tracking_type === 'time' ? `Due @ ${mx.due_time} hrs` : `Due ${mx.due_date}`}</span></div></label>))}</div>
                  </div>
                );
              })()}

              {/* Additional squawks */}
              {(() => {
                const availableSquawks = squawks.filter(sq => !visibleLineItems.some(li => li.squawk_id === sq.id));
                if (availableSquawks.length === 0) return null;
                const allSelected = availableSquawks.every(sq => selectedSquawkIds.includes(sq.id));
                return (
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-navy flex items-center gap-2"><AlertTriangle size={14} className="text-danger" /> Add Squawks</p>
                      <button type="button" onClick={() => { const ids = availableSquawks.map(sq => sq.id); if (allSelected) setSelectedSquawkIds(prev => prev.filter(id => !ids.includes(id))); else setSelectedSquawkIds(prev => Array.from(new Set([...prev, ...ids]))); }} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-danger hover:opacity-80 active:scale-95"><CheckSquare size={12} /> {allSelected ? 'Deselect All' : 'Select All'}</button>
                    </div>
                    <div className="space-y-3 pb-1">{availableSquawks.map(sq => (<label key={sq.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50"><input type="checkbox" checked={selectedSquawkIds.includes(sq.id)} onChange={() => setSelectedSquawkIds(prev => prev.includes(sq.id) ? prev.filter(id => id !== sq.id) : [...prev, sq.id])} className="mt-1 w-4 h-4 text-danger border-gray-300 rounded" /><div><span className="font-bold text-sm text-navy">{sq.description || 'No description'}</span>{sq.affects_airworthiness && sq.location && <span className="block text-[10px] font-bold text-danger">⚠ Grounded at {sq.location}</span>}<span className="block text-[10px] text-gray-500">Reported {new Date(sq.created_at).toLocaleDateString()}</span></div></label>))}</div>
                  </div>
                );
              })()}

              {/* Addons */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Sparkles size={14} className="text-info" /> Additional Services</p>
                <div className="grid grid-cols-2 gap-2">{ADDON_OPTIONS.map(addon => (<label key={addon} className="flex items-center gap-2 p-2 border border-gray-200 rounded cursor-pointer hover:bg-blue-50 text-xs"><input type="checkbox" checked={selectedAddons.includes(addon)} onChange={() => setSelectedAddons(prev => prev.includes(addon) ? prev.filter(a => a !== addon) : [...prev, addon])} className="w-3.5 h-3.5 text-info border-gray-300 rounded" /><span className="text-navy font-bold">{addon}</span></label>))}</div>
              </div>

              <DateProposalSection wantsToPropose={wantsToPropose} setWantsToPropose={setWantsToPropose} proposedDate={proposedDate} setProposedDate={setProposedDate} />
              {!showPreview ? (<button onClick={() => setShowPreview(true)} className="w-full text-[10px] font-bold uppercase tracking-widest text-info hover:underline py-2">Preview Email Before Sending</button>) : (<EmailPreview aircraft={aircraft} mxItems={mxItems.filter(mx => selectedMxIds.includes(mx.id))} squawks={squawks.filter(sq => selectedSquawkIds.includes(sq.id))} selectedAddons={selectedAddons} proposedDate={wantsToPropose ? proposedDate : null} existingLines={visibleLineItems} onClose={() => setShowPreview(false)} />)}
              <PrimaryButton onClick={handleSendDraft} disabled={isSubmitting}>{isSubmitting ? "Sending to Mechanic..." : "Send Work Package to Mechanic"}</PrimaryButton>
            </div>
          )}

        </div>
        </div>
        </div>
      </div>
    </>,
    document.body
  );
}

"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { Wrench, X } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import type { ServiceEventView } from "./service-event/shared";

import ServiceEventList from "./service-event/ServiceEventList";
import ServiceEventCreate from "./service-event/ServiceEventCreate";
import ServiceEventDetail from "./service-event/ServiceEventDetail";
import ServiceEventDraftDetail from "./service-event/ServiceEventDraftDetail";
import ServiceEventComplete from "./service-event/ServiceEventComplete";

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
  // squawk_id -> pictures[]. Populated in fetchEventDetail for squawk
  // line items; lets the in-app detail view render the same photo
  // thumbnails the mechanic sees on the portal.
  const [squawkPhotos, setSquawkPhotos] = useState<Record<string, string[]>>({});

  const [mxItems, setMxItems] = useState<any[]>([]);
  const [squawks, setSquawks] = useState<any[]>([]);

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

    // Side-fetch squawk pictures for any squawk line items. The portal
    // RPC bundles these inline; the in-app fetch path historically
    // didn't, leaving admins to dig through the original squawk record.
    const squawkIds = (linesRes.data || []).filter((l: any) => l.squawk_id).map((l: any) => l.squawk_id);
    if (squawkIds.length > 0) {
      const { data: sqs } = await supabase
        .from('aft_squawks')
        .select('id, pictures')
        .in('id', squawkIds);
      const map: Record<string, string[]> = {};
      for (const sq of (sqs || []) as any[]) {
        if (Array.isArray(sq.pictures) && sq.pictures.length > 0) map[sq.id] = sq.pictures;
      }
      setSquawkPhotos(map);
    } else {
      setSquawkPhotos({});
    }
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
      // Drafts share the detail route now — the editing surface needs
      // mx items + open squawks to render the "Add More" sections. Skip
      // this load for non-draft events to keep the click cheap.
      if (event.status === 'draft') await loadMxAndSquawks();
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
      // Filter to live line items — if a line item was soft-deleted
      // between drafts the create flow would otherwise suppress it
      // from selection (the drafted-ids set would include the ghost
      // entry), and the pilot couldn't re-add the underlying mx item.
      const { data: allLines, error: linesErr } = await supabase
        .from('aft_event_line_items').select('maintenance_item_id, squawk_id, event_id')
        .in('event_id', activeEventIds)
        .is('deleted_at', null);
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

  // Drafted-item -> parent-event map. Lets the create flow surface
  // "Already in draft X" links instead of dead grayed labels.
  const draftedItemEvents: Record<string, any> = {};
  for (const li of allActiveLineItems) {
    const evt = events.find(e => e.id === li.event_id);
    if (!evt) continue;
    if (li.maintenance_item_id) draftedItemEvents[li.maintenance_item_id] = evt;
    if (li.squawk_id) draftedItemEvents[li.squawk_id] = evt;
  }
  const draftedMxIds = Object.keys(draftedItemEvents);
  const draftedSquawkIds = Object.keys(draftedItemEvents);

  const isDraftDetail = view === 'detail' && selectedEvent?.status === 'draft';
  const viewTitle = isDraftDetail
    ? 'Review & Send Draft'
    : ({
        list: 'Service Events',
        create: 'Schedule Service',
        detail: 'Service Event',
        complete: 'Record Completion',
        counter: 'Counter Proposal',
      } as Record<ServiceEventView, string>)[view];

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
        <div className="bg-white rounded shadow-2xl w-full max-w-lg md:max-w-2xl p-5 border-t-4 border-mxOrange animate-slide-up" onClick={e => e.stopPropagation()}>

          <div className="flex justify-between items-center mb-6">
            <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2">
              <Wrench size={20} className="text-mxOrange" /> {viewTitle}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-danger p-2 -mr-2"><X size={24}/></button>
          </div>

          {view === 'list' && (
            <ServiceEventList {...childProps} events={events} onOpenCreateFlow={openCreateFlow} onOpenDetail={(ev) => handleNavigate('detail', ev)} />
          )}

          {view === 'create' && (
            <ServiceEventCreate {...childProps} mxItems={mxItems} squawks={squawks} draftedItemEvents={draftedItemEvents} preSelectedMxIds={preSelectMxItemId ? [preSelectMxItemId] : undefined} />
          )}

          {/* Detail view branches on status: drafts get the editing
              surface (add/remove items, propose date, send); everything
              else gets the read-mostly detail with message thread and
              owner actions. */}
          {view === 'detail' && selectedEvent && isDraftDetail && (
            <ServiceEventDraftDetail {...childProps} selectedEvent={selectedEvent} eventLineItems={eventLineItems} mxItems={mxItems} squawks={squawks} />
          )}
          {view === 'detail' && selectedEvent && !isDraftDetail && (
            <ServiceEventDetail {...childProps} selectedEvent={selectedEvent} eventLineItems={eventLineItems} eventMessages={eventMessages} squawkPhotos={squawkPhotos} fetchEventDetail={fetchEventDetail} setViewingAttachment={setViewingAttachment} />
          )}

          {view === 'complete' && selectedEvent && (
            <ServiceEventComplete {...childProps} selectedEvent={selectedEvent} eventLineItems={eventLineItems} />
          )}

        </div>
        </div>
        </div>
      </div>
    </>,
    document.body
  );
}

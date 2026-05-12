"use client";

import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { newIdempotencyKey, idempotencyHeader } from "@/lib/idempotencyClient";
import { useSignedUrls } from "@/hooks/useSignedUrls";
import {
  ChevronDown, ChevronRight, ExternalLink, Send, CheckCircle,
  XCircle, Plane, Paperclip, FileText, Link2, X, Image as ImageIcon,
  Calendar, ArrowRightLeft, Activity as ActivityIcon, AlertCircle
} from "lucide-react";
import { PrimaryButton, SecondaryButton } from "@/components/AppButtons";
import { INPUT_WHITE_BG, statusLabel, ADDON_OPTIONS } from "./shared";
import type { ServiceEventChildProps } from "./shared";
import { Plus, Wrench, AlertTriangle, Sparkles } from "lucide-react";

interface ServiceEventDetailProps extends ServiceEventChildProps {
  selectedEvent: any;
  eventLineItems: any[];
  eventMessages: any[];
  /** squawk_id -> pictures[] (raw URLs). Signed at render time. */
  squawkPhotos?: Record<string, string[]>;
  fetchEventDetail: (eventId: string) => Promise<void>;
  setViewingAttachment: (url: string | null) => void;
}

export default function ServiceEventDetail({
  aircraft, selectedEvent, eventLineItems, eventMessages, squawkPhotos = {},
  isSubmitting, setIsSubmitting, onNavigate, onRefresh, showSuccess, showError,
  canManageService, fetchEventDetail, setViewingAttachment,
}: ServiceEventDetailProps) {
  const [ownerMessage, setOwnerMessage] = useState("");
  const [proposedDate, setProposedDate] = useState("");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // Add-items inline panel. Lazily loads available mx items + open
  // squawks on first open so the panel doesn't taxes every detail
  // load. Idempotency key sticky-per-attempt; cleared on success.
  const [showAddItems, setShowAddItems] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [availableMxItems, setAvailableMxItems] = useState<any[]>([]);
  const [availableSquawks, setAvailableSquawks] = useState<any[]>([]);
  const [addMxIds, setAddMxIds] = useState<string[]>([]);
  const [addSquawkIds, setAddSquawkIds] = useState<string[]>([]);
  const [addAddons, setAddAddons] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const addItemsKeyRef = useRef<string | null>(null);
  // Sign attachment URLs — aft_event_attachments is now a private
  // bucket so the stored public URL form 400s if rendered directly.
  const resolveSigned = useSignedUrls();

  // Sticky idempotency keys per action — generating a fresh UUID
  // inside the try block lets a network blip plus user-tap re-fire
  // create a duplicate confirm/counter/comment/cancel and resend the
  // owner-action email twice. Seed lazily on first attempt; clear on
  // success so a legitimate later re-action gets a fresh key.
  const confirmKeyRef = useRef<string | null>(null);
  const counterKeyRef = useRef<string | null>(null);
  const commentKeyRef = useRef<string | null>(null);
  const cancelKeyRef = useRef<string | null>(null);
  const closeKeyRef = useRef<string | null>(null);

  const hasCompletedItems = eventLineItems.some(li => li.line_status === 'complete');
  const hasPendingItems = eventLineItems.some(li => li.line_status !== 'complete' && li.line_status !== 'deferred');
  const allResolved = eventLineItems.length > 0 && eventLineItems.every(li => li.line_status === 'complete' || li.line_status === 'deferred');

  // Add-items affordance is only relevant when the event is in-flight.
  // ready_for_pickup means the mechanic is done — adding work then is
  // a new service event, not a tack-on. Matches server-side guard.
  const canAddItems = canManageService &&
    (selectedEvent.status === 'scheduling' || selectedEvent.status === 'confirmed' || selectedEvent.status === 'in_progress');

  const openAddItems = async () => {
    if (addLoading) return;
    setAddLoading(true);
    setShowAddItems(true);
    try {
      const [mxRes, sqRes] = await Promise.all([
        supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', selectedEvent.aircraft_id).is('deleted_at', null).order('due_time').order('due_date'),
        supabase.from('aft_squawks').select('*').eq('aircraft_id', selectedEvent.aircraft_id).eq('status', 'open').is('deleted_at', null).order('occurred_at', { ascending: false }).order('created_at', { ascending: false }),
      ]);
      if (mxRes.error || sqRes.error) {
        showError("Couldn't load items to add.");
        setShowAddItems(false);
      } else {
        // Filter out items already on this event so the picker doesn't
        // tempt a duplicate-add. Cross-event drafts aren't filtered
        // here — the server would silently dedupe by line_items row.
        const linkedMx = new Set(eventLineItems.filter(li => li.maintenance_item_id).map(li => li.maintenance_item_id));
        const linkedSq = new Set(eventLineItems.filter(li => li.squawk_id).map(li => li.squawk_id));
        setAvailableMxItems((mxRes.data || []).filter((m: any) => !linkedMx.has(m.id)));
        setAvailableSquawks((sqRes.data || []).filter((s: any) => !linkedSq.has(s.id)));
      }
    } finally {
      setAddLoading(false);
    }
  };

  const closeAddItems = () => {
    setShowAddItems(false);
    setAddMxIds([]);
    setAddSquawkIds([]);
    setAddAddons([]);
  };

  const handleAddItems = async () => {
    if (isAdding) return;
    if (addMxIds.length === 0 && addSquawkIds.length === 0 && addAddons.length === 0) {
      return showError("Pick at least one item to add.");
    }
    setIsAdding(true);
    try {
      if (!addItemsKeyRef.current) addItemsKeyRef.current = newIdempotencyKey();
      const res = await authFetch('/api/mx-events/add-items', {
        method: 'POST',
        headers: idempotencyHeader(addItemsKeyRef.current),
        body: JSON.stringify({
          eventId: selectedEvent.id,
          mxItemIds: addMxIds,
          squawkIds: addSquawkIds,
          addonServices: addAddons,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Couldn't add items.");
      }
      const body = await res.json().catch(() => ({} as any));
      addItemsKeyRef.current = null;
      await fetchEventDetail(selectedEvent.id);
      if (body.emailSent) {
        showSuccess(`Added ${body.addedCount} item${body.addedCount === 1 ? '' : 's'} — mechanic notified.`);
      } else if (body.emailSkippedReason === 'throttled') {
        showSuccess(`Added ${body.addedCount} item${body.addedCount === 1 ? '' : 's'}. Mechanic email skipped (sent recently); they'll see the additions on next portal load.`);
      } else if (body.emailSkippedReason === 'no_email') {
        showSuccess(`Added ${body.addedCount} item${body.addedCount === 1 ? '' : 's'}. Mechanic email not on file.`);
      } else if (body.emailSkippedReason === 'rate_limited') {
        showSuccess(`Added ${body.addedCount} item${body.addedCount === 1 ? '' : 's'}. Mechanic email skipped (quota); they'll see the additions on next portal load.`);
      } else {
        showSuccess(`Added ${body.addedCount} item${body.addedCount === 1 ? '' : 's'}.`);
      }
      closeAddItems();
    } catch (err: any) {
      showError(err?.message || "Couldn't add items.");
    } finally {
      setIsAdding(false);
    }
  };

  const handleOwnerConfirm = async () => {
    setIsSubmitting(true);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!confirmKeyRef.current) confirmKeyRef.current = newIdempotencyKey();
      await authFetch('/api/mx-events/owner-action', { method: 'POST', headers: idempotencyHeader(confirmKeyRef.current), body: JSON.stringify({ eventId: selectedEvent.id, action: 'confirm', message: ownerMessage || `Confirmed for ${selectedEvent.proposed_date}.`, timeZone }) });
      confirmKeyRef.current = null;
      setOwnerMessage("");
      await fetchEventDetail(selectedEvent.id);
      showSuccess("Date confirmed");
    } catch (err) {
      showError("Couldn't confirm the date.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOwnerCounter = async () => {
    if (!proposedDate) return showError("Pick a date first.");
    setIsSubmitting(true);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!counterKeyRef.current) counterKeyRef.current = newIdempotencyKey();
      await authFetch('/api/mx-events/owner-action', { method: 'POST', headers: idempotencyHeader(counterKeyRef.current), body: JSON.stringify({ eventId: selectedEvent.id, action: 'counter', proposedDate, message: ownerMessage || `How about ${proposedDate} instead?`, timeZone }) });
      counterKeyRef.current = null;
      setOwnerMessage(""); setProposedDate("");
      await fetchEventDetail(selectedEvent.id);
      showSuccess("Counter proposal sent");
    } catch (err) {
      showError("Couldn't send the counter proposal.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOwnerComment = async () => {
    if (!ownerMessage.trim()) return;
    setIsSubmitting(true);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!commentKeyRef.current) commentKeyRef.current = newIdempotencyKey();
      await authFetch('/api/mx-events/owner-action', { method: 'POST', headers: idempotencyHeader(commentKeyRef.current), body: JSON.stringify({ eventId: selectedEvent.id, action: 'comment', message: ownerMessage, timeZone }) });
      commentKeyRef.current = null;
      setOwnerMessage("");
      await fetchEventDetail(selectedEvent.id);
      showSuccess("Message sent");
    } catch (err) {
      showError("Couldn't send the message.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelEvent = async () => {
    setIsSubmitting(true);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!cancelKeyRef.current) cancelKeyRef.current = newIdempotencyKey();
      await authFetch('/api/mx-events/owner-action', { method: 'POST', headers: idempotencyHeader(cancelKeyRef.current), body: JSON.stringify({ eventId: selectedEvent.id, action: 'cancel', message: cancelReason || 'Service event cancelled.', timeZone }) });
      cancelKeyRef.current = null;
      setShowCancelConfirm(false); setCancelReason("");
      onRefresh();
      showSuccess("Service event cancelled");
      onNavigate('list');
    } catch (err) {
      showError("Couldn't cancel the event.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseEvent = async () => {
    setIsSubmitting(true);
    if (!closeKeyRef.current) closeKeyRef.current = newIdempotencyKey();
    try {
      const res = await authFetch('/api/mx-events/close', {
        method: 'POST',
        headers: idempotencyHeader(closeKeyRef.current),
        body: JSON.stringify({ eventId: selectedEvent.id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Couldn't close the event.");
      }
      closeKeyRef.current = null;
      onRefresh();
      showSuccess("Service event closed");
      onNavigate('list');
    } catch (err: any) {
      showError(err?.message || "Couldn't close the event.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderMessageAttachments = (attachments: any[]) => {
    if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return null;
    return (
      <div className="mt-3 pt-3 border-t border-gray-200">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-1"><Paperclip size={10} /> {attachments.length} Attachment{attachments.length > 1 ? 's' : ''}</p>
        <div className="flex gap-2 flex-wrap">
          {attachments.map((att: any, idx: number) => {
            const isImg = att.type && att.type.startsWith('image/');
            const signed = resolveSigned(att.url) || att.url;
            if (isImg) return (<button key={idx} onClick={() => setViewingAttachment(signed)} className="w-16 h-16 rounded border-2 border-gray-200 overflow-hidden hover:border-info transition-colors active:scale-95"><img src={signed} alt={att.filename} className="w-full h-full object-cover" /></button>);
            return (<a key={idx} href={signed} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-2 bg-white border border-gray-200 rounded hover:border-info transition-colors"><FileText size={14} className="text-gray-500 shrink-0" /><div className="min-w-0"><p className="text-[10px] font-bold text-navy truncate max-w-[100px]">{att.filename}</p></div></a>);
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <button onClick={() => onNavigate('list')} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mxOrange bg-orange-50 border border-orange-200 rounded px-3 py-1.5 hover:bg-orange-100 active:scale-95 transition-all">
        <ChevronDown size={12} className="rotate-90" /> Back to Events
      </button>

      {/* Status card */}
      <div className="bg-gray-50 rounded p-4 border border-gray-200">
        <div className="flex justify-between items-center mb-3">
          <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded text-white ${selectedEvent.status === 'confirmed' ? 'bg-info' : selectedEvent.status === 'complete' ? 'bg-[#56B94A]' : selectedEvent.status === 'ready_for_pickup' ? 'bg-[#56B94A]' : selectedEvent.status === 'cancelled' ? 'bg-danger' : 'bg-mxOrange'}`}>
            {statusLabel(selectedEvent.status)}
          </span>
          {selectedEvent.access_token && selectedEvent.status !== 'complete' && (
            <a href={`/service/${selectedEvent.access_token}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-info bg-blue-50 border border-blue-200 rounded px-3 py-1.5 hover:bg-blue-100 active:scale-95 transition-all">
              <ExternalLink size={12} /> Portal
            </a>
          )}
        </div>
        {selectedEvent.confirmed_date && <p className="text-sm"><strong className="text-navy">Confirmed:</strong> {selectedEvent.confirmed_date}</p>}
        {selectedEvent.proposed_date && !selectedEvent.confirmed_date && <p className="text-sm"><strong className="text-navy">Proposed:</strong> {selectedEvent.proposed_date} <span className="text-gray-400">(by {selectedEvent.proposed_by})</span></p>}
        {selectedEvent.estimated_completion && <p className="text-sm mt-1"><strong className="text-navy">Est. Completion:</strong> {selectedEvent.estimated_completion}</p>}
        {selectedEvent.service_duration_days && <p className="text-sm mt-1"><strong className="text-navy">Duration:</strong> {selectedEvent.service_duration_days} day{selectedEvent.service_duration_days > 1 ? 's' : ''}</p>}
        {selectedEvent.mechanic_notes && <p className="text-xs text-gray-500 mt-2">{selectedEvent.mechanic_notes}</p>}
      </div>

      {/* Owner scheduling actions (scheduling + mechanic proposed) */}
      {canManageService && selectedEvent.status === 'scheduling' && selectedEvent.proposed_by === 'mechanic' && (
        <div className="bg-orange-50 border border-orange-200 rounded p-4 space-y-3">
          <p className="text-sm font-bold text-navy">{selectedEvent.mx_contact_name || 'Mechanic'} proposed <strong>{selectedEvent.proposed_date}</strong>{selectedEvent.service_duration_days ? ` (${selectedEvent.service_duration_days} day${selectedEvent.service_duration_days > 1 ? 's' : ''})` : ''}</p>
          <button onClick={handleOwnerConfirm} disabled={isSubmitting} className="w-full bg-[#56B94A] text-white font-oswald font-bold uppercase tracking-widest py-2 rounded text-xs active:scale-95 disabled:opacity-50">Confirm This Date</button>
          <div className="space-y-2 pt-2 border-t border-orange-200">
            <p className="text-[10px] font-bold uppercase tracking-widest text-navy pt-2">Or Propose a Different Date</p>
            <input type="date" value={proposedDate} onChange={e => setProposedDate(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm focus:border-mxOrange outline-none" />
            <textarea value={ownerMessage} onChange={e => setOwnerMessage(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm focus:border-mxOrange outline-none min-h-[50px]" placeholder="Message (optional)" />
            <button onClick={handleOwnerCounter} disabled={isSubmitting || !proposedDate} className="w-full bg-mxOrange text-white font-oswald font-bold uppercase tracking-widest py-2 rounded text-xs active:scale-95 disabled:opacity-50">Send Counter Proposal</button>
          </div>
        </div>
      )}

      {/* Owner waiting state (scheduling + owner proposed) */}
      {canManageService && selectedEvent.status === 'scheduling' && selectedEvent.proposed_by === 'owner' && (
        <div className="bg-blue-50 border border-blue-200 rounded p-4 space-y-3">
          {selectedEvent.proposed_date ? (
            <>
              <p className="text-sm text-navy"><strong>Your proposed date:</strong> {selectedEvent.proposed_date}</p>
              <p className="text-xs text-gray-500">Waiting for {selectedEvent.mx_contact_name || 'the mechanic'} to respond.</p>
              <div className="border-t border-blue-200 pt-3 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-navy">Change Proposed Date</p>
                <input type="date" value={proposedDate} onChange={e => setProposedDate(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm focus:border-mxOrange outline-none" />
                <textarea value={ownerMessage} onChange={e => setOwnerMessage(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm focus:border-mxOrange outline-none min-h-[50px]" placeholder="Message to mechanic (optional)" />
                <button onClick={handleOwnerCounter} disabled={isSubmitting || !proposedDate} className="w-full bg-mxOrange text-white font-oswald font-bold uppercase tracking-widest py-2 rounded text-xs active:scale-95 disabled:opacity-50">Update Proposed Date</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-navy">Requesting availability from {selectedEvent.mx_contact_name || 'the mechanic'}.</p>
              <p className="text-xs text-gray-500">No preferred date was specified. Waiting for the mechanic to propose dates.</p>
              <div className="border-t border-blue-200 pt-3 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-navy">Propose a Date Instead</p>
                <input type="date" value={proposedDate} onChange={e => setProposedDate(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm focus:border-mxOrange outline-none" />
                <textarea value={ownerMessage} onChange={e => setOwnerMessage(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm focus:border-mxOrange outline-none min-h-[50px]" placeholder="Message to mechanic (optional)" />
                <button onClick={handleOwnerCounter} disabled={isSubmitting || !proposedDate} className="w-full bg-mxOrange text-white font-oswald font-bold uppercase tracking-widest py-2 rounded text-xs active:scale-95 disabled:opacity-50">Send Date Proposal</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Work package line items */}
      {eventLineItems.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Work Package</p>
          <div className="space-y-2">
            {eventLineItems.map(li => {
              const photos = (li.squawk_id && squawkPhotos[li.squawk_id]) || [];
              return (
                <div key={li.id} className={`p-3 border rounded text-sm ${li.line_status === 'complete' ? 'bg-green-50 border-green-200' : li.line_status === 'in_progress' ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-bold text-navy">{li.item_name}</span>
                      {li.item_description && <p className="text-[10px] text-gray-500 mt-0.5">{li.item_description}</p>}
                    </div>
                    <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded shrink-0 ml-2 ${li.line_status === 'complete' ? 'bg-green-100 text-green-700' : li.line_status === 'in_progress' ? 'bg-blue-100 text-blue-700' : li.line_status === 'deferred' ? 'bg-gray-100 text-gray-600' : 'bg-orange-100 text-orange-700'}`}>
                      {li.line_status}
                    </span>
                  </div>
                  {li.mechanic_comment && <p className="text-[10px] text-info mt-1">{li.mechanic_comment}</p>}
                  {photos.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 flex items-center gap-1"><ImageIcon size={10} /> {photos.length} Photo{photos.length > 1 ? 's' : ''}</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {photos.map((url: string, idx: number) => {
                          const signed = resolveSigned(url) || url;
                          return (
                            <button key={idx} onClick={() => setViewingAttachment(signed)} className="w-14 h-14 rounded border border-gray-200 overflow-hidden hover:border-danger active:scale-95 transition-all">
                              <img src={signed} alt={`Squawk photo ${idx + 1}`} className="w-full h-full object-cover" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {li.line_status === 'complete' && li.completion_date && (
                    <p className="text-[10px] text-[#56B94A] mt-1 flex items-center gap-1"><Link2 size={10} /> Completed {li.completion_date}{li.completed_by_name ? ` by ${li.completed_by_name}` : ''}{li.completion_time ? ` @ ${li.completion_time} hrs` : ''}</p>
                  )}
                </div>
              );
            })}
          </div>
          {canAddItems && !showAddItems && (
            <button onClick={openAddItems} disabled={addLoading} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mxOrange border border-dashed border-mxOrange/40 bg-orange-50/40 rounded py-2 hover:bg-orange-50 active:scale-95 transition-all disabled:opacity-50">
              <Plus size={12} /> {addLoading ? "Loading..." : "Add Items to Work Package"}
            </button>
          )}
          {showAddItems && (
            <div className="mt-3 p-4 border border-mxOrange/40 rounded bg-orange-50/30 space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest text-navy">Add to Work Package</p>
                <button onClick={closeAddItems} className="text-gray-400 hover:text-danger active:scale-95"><X size={14} /></button>
              </div>
              <p className="text-[10px] text-gray-500">Mechanic gets one email per ~5 min window. Items appear on the portal as soon as they save.</p>

              {availableMxItems.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Wrench size={12} className="text-mxOrange" /> Maintenance Items</p>
                  <div className="space-y-2">
                    {availableMxItems.map((mx: any) => (
                      <label key={mx.id} className="flex items-start gap-2 p-2 border border-gray-200 rounded cursor-pointer hover:bg-white text-xs">
                        <input type="checkbox" checked={addMxIds.includes(mx.id)} onChange={() => setAddMxIds(prev => prev.includes(mx.id) ? prev.filter(id => id !== mx.id) : [...prev, mx.id])} className="mt-0.5 w-4 h-4 text-mxOrange border-gray-300 rounded" />
                        <span className="text-navy"><span className="font-bold">{mx.item_name}</span> <span className="text-gray-400">— {mx.tracking_type === 'time' ? `Due @ ${mx.due_time} hrs` : `Due ${mx.due_date}`}</span></span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {availableSquawks.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><AlertTriangle size={12} className="text-danger" /> Open Squawks</p>
                  <div className="space-y-2">
                    {availableSquawks.map((sq: any) => (
                      <label key={sq.id} className="flex items-start gap-2 p-2 border border-gray-200 rounded cursor-pointer hover:bg-white text-xs">
                        <input type="checkbox" checked={addSquawkIds.includes(sq.id)} onChange={() => setAddSquawkIds(prev => prev.includes(sq.id) ? prev.filter(id => id !== sq.id) : [...prev, sq.id])} className="mt-0.5 w-4 h-4 text-danger border-gray-300 rounded" />
                        <span className="text-navy font-bold">{sq.description || 'No description'}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Sparkles size={12} className="text-info" /> Additional Services</p>
                <div className="grid grid-cols-2 gap-2">
                  {ADDON_OPTIONS.map(addon => (
                    <label key={addon} className="flex items-center gap-1.5 p-2 border border-gray-200 rounded cursor-pointer hover:bg-white text-[11px]">
                      <input type="checkbox" checked={addAddons.includes(addon)} onChange={() => setAddAddons(prev => prev.includes(addon) ? prev.filter(a => a !== addon) : [...prev, addon])} className="w-3.5 h-3.5 text-info border-gray-300 rounded" />
                      <span className="text-navy font-bold">{addon}</span>
                    </label>
                  ))}
                </div>
              </div>

              {availableMxItems.length === 0 && availableSquawks.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-2">No remaining maintenance items or open squawks. You can still add services above.</p>
              )}

              <div className="flex gap-2">
                <SecondaryButton onClick={closeAddItems} disabled={isAdding} className="flex-1">Cancel</SecondaryButton>
                <button onClick={handleAddItems} disabled={isAdding} className="flex-[2] bg-mxOrange text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 transition-transform disabled:opacity-50 text-sm">
                  {isAdding ? "Adding..." : `Add ${addMxIds.length + addSquawkIds.length + addAddons.length || ''} Item${(addMxIds.length + addSquawkIds.length + addAddons.length) === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Activity rail — milestone view of everything that happened on
          this event (creation, date proposals, confirmations, mark-ready,
          decline, owner cancel). Replaces the prior single thread that
          mixed comments and state changes. */}
      {(() => {
        type Activity = { id: string; icon: any; iconClass: string; label: string; body?: string | null; createdAt: string };
        const items: Activity[] = [];
        items.push({
          id: 'created',
          icon: Calendar,
          iconClass: 'text-gray-400',
          label: 'Service event drafted',
          createdAt: selectedEvent.created_at,
        });
        for (const m of eventMessages) {
          if (!m.message_type || m.message_type === 'comment') continue;
          const senderLabel = m.sender === 'mechanic' ? 'Mechanic' : m.sender === 'owner' ? 'Owner' : 'System';
          let icon = ActivityIcon;
          let iconClass = 'text-gray-400';
          let label = `${senderLabel} update`;
          if (m.message_type === 'propose_date') {
            icon = Calendar; iconClass = 'text-mxOrange';
            label = `${senderLabel} proposed a date`;
          } else if (m.message_type === 'counter') {
            icon = ArrowRightLeft; iconClass = 'text-mxOrange';
            label = `${senderLabel} countered`;
          } else if (m.message_type === 'confirm') {
            icon = CheckCircle; iconClass = 'text-[#56B94A]';
            label = `${senderLabel} confirmed the date`;
          } else if (m.message_type === 'status_update') {
            icon = AlertCircle; iconClass = 'text-info';
            label = `${senderLabel} status update`;
          }
          items.push({ id: m.id, icon, iconClass, label, body: m.message, createdAt: m.created_at });
        }
        if (items.length <= 1) return null;
        return (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Activity</p>
            <ol className="space-y-2.5 border-l border-gray-200 pl-4">
              {items.map(it => {
                const Icon = it.icon;
                return (
                  <li key={it.id} className="relative">
                    <span className="absolute -left-[1.4rem] top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white border border-gray-200">
                      <Icon size={10} className={it.iconClass} />
                    </span>
                    <div className="flex justify-between items-baseline gap-3">
                      <span className="text-xs font-bold text-navy">{it.label}</span>
                      <span className="text-[9px] text-gray-400 shrink-0">{new Date(it.createdAt).toLocaleDateString()}</span>
                    </div>
                    {it.body && <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{it.body}</p>}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })()}

      {/* Comment thread — only human-to-human messages, with the
          milestone events lifted into the Activity rail above. */}
      {(() => {
        const comments = eventMessages.filter(m => !m.message_type || m.message_type === 'comment');
        if (comments.length === 0) return null;
        return (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Messages</p>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {comments.map(msg => (
                <div key={msg.id} className={`p-2 rounded text-xs ${msg.sender === 'mechanic' ? 'bg-blue-50 border-l-4 border-info' : msg.sender === 'owner' ? 'bg-orange-50 border-l-4 border-mxOrange' : 'bg-gray-50 border-l-4 border-gray-300'}`}>
                  <span className="text-[8px] font-bold uppercase text-gray-400">{msg.sender} • {new Date(msg.created_at).toLocaleString()}</span>
                  <p className="text-navy mt-1">{msg.message}</p>
                  {renderMessageAttachments(msg.attachments)}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Comment box */}
      {canManageService && selectedEvent.status !== 'complete' && (
        <div className="flex gap-2">
          <textarea value={ownerMessage} onChange={e => setOwnerMessage(e.target.value)} style={INPUT_WHITE_BG} className="flex-1 border border-gray-300 rounded p-2 text-sm focus:border-info outline-none min-h-[50px]" placeholder="Send a message..." />
          <button onClick={handleOwnerComment} disabled={isSubmitting || !ownerMessage.trim()} className="bg-info text-white px-4 py-3 rounded active:scale-95 disabled:opacity-50"><Send size={18}/></button>
        </div>
      )}

      {/* Completion actions */}
      {canManageService && selectedEvent.status !== 'complete' && selectedEvent.status !== 'cancelled' && hasPendingItems && (
        <button onClick={() => onNavigate('complete', selectedEvent)} className="w-full bg-[#56B94A] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 transition-transform flex items-center justify-center gap-2">
          <CheckCircle size={18} /> Record Completion{hasCompletedItems ? ' (Remaining Items)' : ''}
        </button>
      )}

      {/* Close event when all resolved */}
      {canManageService && selectedEvent.status !== 'complete' && selectedEvent.status !== 'cancelled' && allResolved && eventLineItems.length > 0 && (
        <div className="bg-green-50 border-2 border-green-200 rounded p-4 text-center">
          <CheckCircle size={32} className="mx-auto text-[#56B94A] mb-2" />
          <p className="font-oswald text-lg font-bold uppercase tracking-widest text-navy mb-2">All Items Resolved</p>
          <p className="text-xs text-gray-600 mb-4">Every item is either completed or deferred. Finalize the event to wrap it up.</p>
          <button onClick={handleCloseEvent} disabled={isSubmitting} className="w-full bg-[#56B94A] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 disabled:opacity-50">{isSubmitting ? "Finalizing..." : "Finalize Event"}</button>
        </div>
      )}

      {/* Ready for pickup banner */}
      {selectedEvent.status === 'ready_for_pickup' && (
        <div className="bg-green-50 border-2 border-green-200 rounded p-4 text-center"><Plane size={32} className="mx-auto text-[#56B94A] mb-2" /><p className="font-oswald text-lg font-bold uppercase tracking-widest text-navy">Aircraft Ready</p><p className="text-sm text-gray-600 mt-1">Your mechanic marked every item complete. Record the completion above to finish out the event.</p></div>
      )}
      {selectedEvent.status === 'cancelled' && (
        <div className="bg-red-50 border-2 border-red-200 rounded p-4 text-center"><XCircle size={32} className="mx-auto text-danger mb-2" /><p className="font-oswald text-lg font-bold uppercase tracking-widest text-navy">Event Cancelled</p></div>
      )}

      {/* Cancel button */}
      {canManageService && selectedEvent.status !== 'complete' && selectedEvent.status !== 'cancelled' && !showCancelConfirm && (
        <button onClick={() => setShowCancelConfirm(true)} className="w-full text-[10px] font-bold uppercase tracking-widest text-danger border border-red-200 bg-red-50 rounded py-2 hover:bg-red-100 active:scale-95 transition-all flex items-center justify-center gap-1.5 mt-2"><XCircle size={12} /> Cancel Event</button>
      )}
      {showCancelConfirm && (
        <div className="bg-red-50 border-2 border-red-200 rounded p-4 space-y-3 animate-fade-in">
          <p className="text-sm font-bold text-navy">Cancel this event?</p>
          <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm focus:border-danger outline-none min-h-[50px]" placeholder="Reason for the cancellation (optional) — your mechanic will see this." />
          <div className="flex gap-2">
            <button onClick={() => { setShowCancelConfirm(false); setCancelReason(""); }} className="flex-1 border border-gray-300 text-gray-600 font-oswald font-bold uppercase tracking-widest py-2 rounded text-xs active:scale-95">Keep Event</button>
            <button onClick={handleCancelEvent} disabled={isSubmitting} className="flex-1 bg-danger text-white font-oswald font-bold uppercase tracking-widest py-2 rounded text-xs active:scale-95 disabled:opacity-50">{isSubmitting ? "Cancelling..." : "Cancel Event"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

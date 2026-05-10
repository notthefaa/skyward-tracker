"use client";

import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { newIdempotencyKey, idempotencyHeader } from "@/lib/idempotencyClient";
import { useSignedUrls } from "@/hooks/useSignedUrls";
import { 
  ChevronDown, ChevronRight, ExternalLink, Send, CheckCircle, 
  XCircle, Plane, Paperclip, FileText, Link2, X
} from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { INPUT_WHITE_BG } from "./shared";
import type { ServiceEventChildProps } from "./shared";

interface ServiceEventDetailProps extends ServiceEventChildProps {
  selectedEvent: any;
  eventLineItems: any[];
  eventMessages: any[];
  fetchEventDetail: (eventId: string) => Promise<void>;
  setViewingAttachment: (url: string | null) => void;
}

export default function ServiceEventDetail({
  aircraft, selectedEvent, eventLineItems, eventMessages,
  isSubmitting, setIsSubmitting, onNavigate, onRefresh, showSuccess, showError,
  canManageService, fetchEventDetail, setViewingAttachment,
}: ServiceEventDetailProps) {
  const [ownerMessage, setOwnerMessage] = useState("");
  const [proposedDate, setProposedDate] = useState("");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
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

  const hasCompletedItems = eventLineItems.some(li => li.line_status === 'complete');
  const hasPendingItems = eventLineItems.some(li => li.line_status !== 'complete' && li.line_status !== 'deferred');
  const allResolved = eventLineItems.length > 0 && eventLineItems.every(li => li.line_status === 'complete' || li.line_status === 'deferred');

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
    try {
      await supabase.from('aft_maintenance_events').update({ status: 'complete', completed_at: new Date().toISOString() }).eq('id', selectedEvent.id);
      await supabase.from('aft_event_messages').insert({ event_id: selectedEvent.id, sender: 'system', message_type: 'status_update', message: 'Service event closed. Completed items have been reset. Deferred items remain open.' } as any);
      onRefresh();
      showSuccess("Service event closed");
      onNavigate('list');
    } catch (err) {
      showError("Couldn't close the event.");
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
            {selectedEvent.status === 'ready_for_pickup' ? 'Ready for Pickup' : selectedEvent.status}
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
            {eventLineItems.map(li => (
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
                {li.line_status === 'complete' && li.completion_date && (
                  <p className="text-[10px] text-[#56B94A] mt-1 flex items-center gap-1"><Link2 size={10} /> Completed {li.completion_date}{li.completed_by_name ? ` by ${li.completed_by_name}` : ''}{li.completion_time ? ` @ ${li.completion_time} hrs` : ''}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      {eventMessages.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Messages</p>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {eventMessages.map(msg => (
              <div key={msg.id} className={`p-2 rounded text-xs ${msg.sender === 'mechanic' ? 'bg-blue-50 border-l-4 border-info' : msg.sender === 'owner' ? 'bg-orange-50 border-l-4 border-mxOrange' : 'bg-gray-50 border-l-4 border-gray-300'}`}>
                <span className="text-[8px] font-bold uppercase text-gray-400">{msg.sender} • {new Date(msg.created_at).toLocaleString()}</span>
                <p className="text-navy mt-1">{msg.message}</p>
                {renderMessageAttachments(msg.attachments)}
              </div>
            ))}
          </div>
        </div>
      )}

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
          <CheckCircle size={18} /> Enter Logbook Data{hasCompletedItems ? ' (Remaining Items)' : ''}
        </button>
      )}

      {/* Close event when all resolved */}
      {canManageService && selectedEvent.status !== 'complete' && selectedEvent.status !== 'cancelled' && allResolved && eventLineItems.length > 0 && (
        <div className="bg-green-50 border-2 border-green-200 rounded p-4 text-center">
          <CheckCircle size={32} className="mx-auto text-[#56B94A] mb-2" />
          <p className="font-oswald text-lg font-bold uppercase tracking-widest text-navy mb-2">All Items Resolved</p>
          <p className="text-xs text-gray-600 mb-4">Every item is either completed or deferred. Close the event to wrap it up.</p>
          <button onClick={handleCloseEvent} disabled={isSubmitting} className="w-full bg-[#56B94A] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 disabled:opacity-50">{isSubmitting ? "Closing..." : "Close Service Event"}</button>
        </div>
      )}

      {/* Ready for pickup banner */}
      {selectedEvent.status === 'ready_for_pickup' && (
        <div className="bg-green-50 border-2 border-green-200 rounded p-4 text-center"><Plane size={32} className="mx-auto text-[#56B94A] mb-2" /><p className="font-oswald text-lg font-bold uppercase tracking-widest text-navy">Aircraft Ready</p><p className="text-sm text-gray-600 mt-1">Your mechanic marked every item complete. Enter logbook data above to finish out the event.</p></div>
      )}
      {selectedEvent.status === 'cancelled' && (
        <div className="bg-red-50 border-2 border-red-200 rounded p-4 text-center"><XCircle size={32} className="mx-auto text-danger mb-2" /><p className="font-oswald text-lg font-bold uppercase tracking-widest text-navy">Event Cancelled</p></div>
      )}

      {/* Cancel button */}
      {canManageService && selectedEvent.status !== 'complete' && selectedEvent.status !== 'cancelled' && !showCancelConfirm && (
        <button onClick={() => setShowCancelConfirm(true)} className="w-full text-[10px] font-bold uppercase tracking-widest text-danger border border-red-200 bg-red-50 rounded py-2 hover:bg-red-100 active:scale-95 transition-all flex items-center justify-center gap-1.5 mt-2"><XCircle size={12} /> Cancel Service Event</button>
      )}
      {showCancelConfirm && (
        <div className="bg-red-50 border-2 border-red-200 rounded p-4 space-y-3 animate-fade-in">
          <p className="text-sm font-bold text-navy">Cancel this service event?</p>
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

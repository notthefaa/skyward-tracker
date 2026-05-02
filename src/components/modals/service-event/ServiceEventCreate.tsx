"use client";

import { useState, useRef } from "react";
import { authFetch, UPLOAD_TIMEOUT_MS } from "@/lib/authFetch";
import { newIdempotencyKey, idempotencyHeader } from "@/lib/idempotencyClient";
import { Wrench, AlertTriangle, Sparkles, ChevronDown, CheckSquare } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { ADDON_OPTIONS } from "./shared";
import type { ServiceEventChildProps } from "./shared";
import DateProposalSection from "./DateProposalSection";
import EmailPreview from "./EmailPreview";

interface ServiceEventCreateProps extends ServiceEventChildProps {
  mxItems: any[];
  squawks: any[];
  /** IDs of MX items already included in an existing draft/active event */
  draftedMxIds?: string[];
  /** IDs of squawks already included in an existing draft/active event */
  draftedSquawkIds?: string[];
  /** MX items to pre-select when this view opens (e.g. from the
   * "projected due" banner in MaintenanceTab). */
  preSelectedMxIds?: string[];
}

export default function ServiceEventCreate({
  aircraft, mxItems, squawks, isSubmitting, setIsSubmitting, onNavigate, onRefresh, showSuccess, showError, showWarning, canManageService,
  draftedMxIds = [], draftedSquawkIds = [], preSelectedMxIds,
}: ServiceEventCreateProps) {
  const [selectedMxIds, setSelectedMxIds] = useState<string[]>(preSelectedMxIds || []);
  const [selectedSquawkIds, setSelectedSquawkIds] = useState<string[]>([]);
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  const [proposedDate, setProposedDate] = useState("");
  const [wantsToPropose, setWantsToPropose] = useState<boolean | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  // Sticky idempotency key for /api/mx-events/create. The component
  // remounts when the user navigates back into the create view, so
  // initializing to null at mount is enough — no manual reset
  // needed. Both the "Save as Draft" and "Create + Send" buttons
  // POST to the same route; if the user retries either after a
  // timeout, the same key dedups the create call server-side and
  // the second attempt picks up where the first left off (event
  // exists with the cached row → send-workpackage / confirm-list
  // flow runs against it).
  const submitIdemKeyRef = useRef<string | null>(null);

  // Filter out items that are already in a draft/active event
  const availableMx = mxItems.filter(mx => !draftedMxIds.includes(mx.id));
  const availableSquawks = squawks.filter(sq => !draftedSquawkIds.includes(sq.id));

  const toggleSelectAllMx = () => {
    const allIds = availableMx.map(mx => mx.id);
    const allSelected = allIds.every(id => selectedMxIds.includes(id));
    if (allSelected) setSelectedMxIds(prev => prev.filter(id => !allIds.includes(id)));
    else setSelectedMxIds(prev => Array.from(new Set([...prev, ...allIds])));
  };

  const toggleSelectAllSquawks = () => {
    const allIds = availableSquawks.map(sq => sq.id);
    const allSelected = allIds.every(id => selectedSquawkIds.includes(id));
    if (allSelected) setSelectedSquawkIds(prev => prev.filter(id => !allIds.includes(id)));
    else setSelectedSquawkIds(prev => Array.from(new Set([...prev, ...allIds])));
  };

  const handleCreateAndSend = async () => {
    if (isSubmitting || isSavingDraft) return;
    if (selectedMxIds.length === 0 && selectedSquawkIds.length === 0 && selectedAddons.length === 0) return showWarning("Pick at least one item for the work package.");
    if (wantsToPropose === null) return showWarning("Pick a preferred date, or choose 'Request Availability' to let your mechanic propose.");
    if (wantsToPropose && !proposedDate) return showWarning("Enter a date, or switch to 'Request Availability'.");
    setIsSubmitting(true);
    // Two-step call. The create step returns an event row; only the
    // send step actually emails the mechanic. If send fails *after*
    // create succeeded, the event is already in the list as a draft
    // — we tell the user where to resume rather than hiding the fact
    // that the event exists (which looked like an orphan to them).
    let createdEventId: string | null = null;
    try {
      if (!submitIdemKeyRef.current) submitIdemKeyRef.current = newIdempotencyKey();
      const createRes = await authFetch('/api/mx-events/create', { method: 'POST', headers: idempotencyHeader(submitIdemKeyRef.current), body: JSON.stringify({ aircraftId: aircraft.id, mxItemIds: selectedMxIds, squawkIds: selectedSquawkIds, addonServices: selectedAddons, proposedDate: (wantsToPropose && proposedDate) ? proposedDate : null }) });
      if (!createRes.ok) {
        const d = await createRes.json().catch(() => ({}));
        throw new Error(d.error || "Couldn't create the event");
      }
      const createData = await createRes.json();
      createdEventId = createData.eventId;

      const sendRes = await authFetch('/api/mx-events/send-workpackage', { method: 'POST', body: JSON.stringify({ eventId: createdEventId, proposedDate: (wantsToPropose && proposedDate) ? proposedDate : null }), timeoutMs: UPLOAD_TIMEOUT_MS });
      if (!sendRes.ok) {
        const d = await sendRes.json().catch(() => ({}));
        throw new Error(d.error || "Couldn't send the work package");
      }

      onRefresh();
      showSuccess("Work package sent to mechanic");
      onNavigate('list');
    } catch (err: any) {
      if (createdEventId) {
        // The draft landed; only the email failed. Point the user at
        // the draft so they don't re-create a duplicate on retry.
        showError(`Draft saved, but we couldn't send it: ${err.message}. Open the draft from the Events list to retry.`);
        onRefresh();
        onNavigate('list');
      } else {
        showError("Couldn't send the work package: " + err.message);
      }
    }
    setIsSubmitting(false);
  };

  const handleSaveAsDraft = async () => {
    if (isSubmitting || isSavingDraft) return;
    if (selectedMxIds.length === 0 && selectedSquawkIds.length === 0 && selectedAddons.length === 0) return showWarning("Pick at least one item for the work package.");
    setIsSavingDraft(true);
    try {
      if (!submitIdemKeyRef.current) submitIdemKeyRef.current = newIdempotencyKey();
      const res = await authFetch('/api/mx-events/create', { method: 'POST', headers: idempotencyHeader(submitIdemKeyRef.current), body: JSON.stringify({ aircraftId: aircraft.id, mxItemIds: selectedMxIds, squawkIds: selectedSquawkIds, addonServices: selectedAddons, proposedDate: (wantsToPropose && proposedDate) ? proposedDate : null }) });
      if (!res.ok) throw new Error("Couldn't create the draft");
      onRefresh();
      showSuccess("Draft saved");
      onNavigate('list');
    } catch (err: any) { showError("Couldn't save the draft: " + err.message); }
    setIsSavingDraft(false);
  };

  const anyBusy = isSubmitting || isSavingDraft;

  return (
    <div className="space-y-6">
      <button onClick={() => onNavigate('list')} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mxOrange bg-orange-50 border border-orange-200 rounded px-3 py-1.5 hover:bg-orange-100 active:scale-95 transition-all mb-2">
        <ChevronDown size={12} className="rotate-90" /> Back to Events
      </button>

      {/* MX Items */}
      {availableMx.length > 0 && (
        <div>
          <div className="flex justify-between items-center mb-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-navy flex items-center gap-2"><Wrench size={14} className="text-mxOrange" /> Maintenance Items Due</p>
            <button type="button" onClick={toggleSelectAllMx} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-mxOrange hover:opacity-80 active:scale-95 transition-all">
              <CheckSquare size={12} /> {availableMx.every(mx => selectedMxIds.includes(mx.id)) ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div className="space-y-3 pb-1">
            {availableMx.map(mx => (
              <label key={mx.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={selectedMxIds.includes(mx.id)} onChange={() => setSelectedMxIds(prev => prev.includes(mx.id) ? prev.filter(id => id !== mx.id) : [...prev, mx.id])} className="mt-1 w-4 h-4 text-mxOrange border-gray-300 rounded" />
                <div>
                  <span className="font-bold text-sm text-navy">{mx.item_name}</span>
                  <span className="block text-[10px] text-gray-500">{mx.tracking_type === 'time' ? `Due @ ${mx.due_time} hrs` : `Due ${mx.due_date}`}</span>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Items already in a draft — shown as non-selectable for awareness */}
      {draftedMxIds.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Already included in another draft</p>
          <div className="space-y-2">
            {mxItems.filter(mx => draftedMxIds.includes(mx.id)).map(mx => (
              <div key={mx.id} className="p-3 border border-gray-100 rounded bg-gray-50 opacity-50">
                <span className="font-bold text-sm text-gray-400">{mx.item_name}</span>
                <span className="block text-[10px] text-gray-400">{mx.tracking_type === 'time' ? `Due @ ${mx.due_time} hrs` : `Due ${mx.due_date}`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Squawks */}
      {availableSquawks.length > 0 && (
        <div>
          <div className="flex justify-between items-center mb-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-navy flex items-center gap-2"><AlertTriangle size={14} className="text-danger" /> Open Squawks</p>
            <button type="button" onClick={toggleSelectAllSquawks} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-danger hover:opacity-80 active:scale-95 transition-all">
              <CheckSquare size={12} /> {availableSquawks.every(sq => selectedSquawkIds.includes(sq.id)) ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div className="space-y-3 pb-1">
            {availableSquawks.map(sq => (
              <label key={sq.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={selectedSquawkIds.includes(sq.id)} onChange={() => setSelectedSquawkIds(prev => prev.includes(sq.id) ? prev.filter(id => id !== sq.id) : [...prev, sq.id])} className="mt-1 w-4 h-4 text-danger border-gray-300 rounded" />
                <div>
                  <span className="font-bold text-sm text-navy">{sq.description || 'No description'}</span>
                  {sq.affects_airworthiness && sq.location && <span className="block text-[10px] font-bold text-danger">⚠ Grounded at {sq.location}</span>}
                  <span className="block text-[10px] text-gray-500">Reported {new Date(sq.created_at).toLocaleDateString()}</span>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {draftedSquawkIds.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Squawks already in another draft</p>
          <div className="space-y-2">
            {squawks.filter(sq => draftedSquawkIds.includes(sq.id)).map(sq => (
              <div key={sq.id} className="p-3 border border-gray-100 rounded bg-gray-50 opacity-50">
                <span className="font-bold text-sm text-gray-400">{sq.description || 'No description'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add-on Services */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Sparkles size={14} className="text-info" /> Additional Services</p>
        <div className="grid grid-cols-2 gap-2">
          {ADDON_OPTIONS.map(addon => (
            <label key={addon} className="flex items-center gap-2 p-2 border border-gray-200 rounded cursor-pointer hover:bg-blue-50 text-xs">
              <input type="checkbox" checked={selectedAddons.includes(addon)} onChange={() => setSelectedAddons(prev => prev.includes(addon) ? prev.filter(a => a !== addon) : [...prev, addon])} className="w-3.5 h-3.5 text-info border-gray-300 rounded" />
              <span className="text-navy font-bold">{addon}</span>
            </label>
          ))}
        </div>
      </div>

      <DateProposalSection wantsToPropose={wantsToPropose} setWantsToPropose={setWantsToPropose} proposedDate={proposedDate} setProposedDate={setProposedDate} />

      {!showPreview ? (
        <button onClick={() => setShowPreview(true)} className="w-full text-[10px] font-bold uppercase tracking-widest text-info hover:underline py-2">Preview Email Before Sending</button>
      ) : (
        <EmailPreview aircraft={aircraft} mxItems={mxItems.filter(mx => selectedMxIds.includes(mx.id))} squawks={squawks.filter(sq => selectedSquawkIds.includes(sq.id))} selectedAddons={selectedAddons} proposedDate={wantsToPropose ? proposedDate : null} onClose={() => setShowPreview(false)} />
      )}

      <PrimaryButton onClick={handleCreateAndSend} disabled={anyBusy}>
        {isSubmitting ? "Sending..." : "Send Work Package to Mechanic"}
      </PrimaryButton>
      <button onClick={handleSaveAsDraft} disabled={anyBusy} className="w-full text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-navy py-2 active:scale-95 transition-all disabled:opacity-50">
        {isSavingDraft ? "Saving Draft..." : "Save as Draft (Don\u0027t Send Yet)"}
      </button>
    </div>
  );
}

"use client";

import { useState, useRef } from "react";
import { authFetch, UPLOAD_TIMEOUT_MS } from "@/lib/authFetch";
import { newIdempotencyKey, idempotencyHeader } from "@/lib/idempotencyClient";
import { ChevronDown, Wrench, AlertTriangle, Sparkles, CheckSquare, Trash2 } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { ADDON_OPTIONS } from "./shared";
import type { ServiceEventChildProps } from "./shared";
import DateProposalSection from "./DateProposalSection";
import EmailPreview from "./EmailPreview";

interface ServiceEventDraftDetailProps extends ServiceEventChildProps {
  selectedEvent: any;
  eventLineItems: any[];
  mxItems: any[];
  squawks: any[];
}

/**
 * The "review a draft before sending" surface, rendered as a flavor of
 * the detail view when status === 'draft'. Replaces the prior
 * `review_draft` modal mode so navigation always lands the user on the
 * same screen regardless of event status.
 */
export default function ServiceEventDraftDetail({
  aircraft, selectedEvent, eventLineItems, mxItems, squawks,
  isSubmitting, setIsSubmitting, onNavigate, onRefresh,
  showSuccess, showError, showWarning,
}: ServiceEventDraftDetailProps) {
  const [selectedMxIds, setSelectedMxIds] = useState<string[]>([]);
  const [selectedSquawkIds, setSelectedSquawkIds] = useState<string[]>([]);
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  const [proposedDate, setProposedDate] = useState<string>(
    selectedEvent?.proposed_date || ""
  );
  const [wantsToPropose, setWantsToPropose] = useState<boolean | null>(
    selectedEvent?.proposed_date ? true : null
  );
  const [showPreview, setShowPreview] = useState(false);
  const [removedLineItemIds, setRemovedLineItemIds] = useState<string[]>([]);

  // Sticky idempotency for the send-workpackage POST. Cleared after a
  // successful send; on retry-after-fail the same key keeps the
  // server-side dedupe so a network blip + user tap never sends twice.
  const sendIdemKeyRef = useRef<string | null>(null);

  const visibleLineItems = eventLineItems.filter(li => !removedLineItemIds.includes(li.id));

  const handleSend = async () => {
    if (isSubmitting) return;
    if (wantsToPropose === null) return showWarning("Pick a preferred date, or choose 'Request Availability' to let your mechanic propose.");
    if (wantsToPropose && !proposedDate) return showWarning("Enter a date, or switch to 'Request Availability'.");
    if (visibleLineItems.length === 0 && selectedMxIds.length === 0 && selectedSquawkIds.length === 0 && selectedAddons.length === 0) {
      return showWarning("This draft has no items. Add at least one item or cancel the draft.");
    }
    setIsSubmitting(true);
    try {
      if (!sendIdemKeyRef.current) sendIdemKeyRef.current = newIdempotencyKey();
      const res = await authFetch('/api/mx-events/send-workpackage', {
        method: 'POST',
        timeoutMs: UPLOAD_TIMEOUT_MS,
        headers: idempotencyHeader(sendIdemKeyRef.current),
        body: JSON.stringify({
          eventId: selectedEvent.id,
          removedLineItemIds,
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
      sendIdemKeyRef.current = null;
      showSuccess("Work package sent to mechanic");
      onRefresh();
      onNavigate('list');
    } catch (err: any) {
      showError("Couldn't send the work package: " + err.message);
    }
    setIsSubmitting(false);
  };

  const availableMx = mxItems.filter(mx =>
    !visibleLineItems.some(li => li.maintenance_item_id === mx.id)
  );
  const availableSquawks = squawks.filter(sq =>
    !visibleLineItems.some(li => li.squawk_id === sq.id)
  );
  const allMxSelected = availableMx.length > 0 && availableMx.every(mx => selectedMxIds.includes(mx.id));
  const allSquawksSelected = availableSquawks.length > 0 && availableSquawks.every(sq => selectedSquawkIds.includes(sq.id));

  return (
    <div className="space-y-6">
      <button onClick={() => onNavigate('list')} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mxOrange bg-orange-50 border border-orange-200 rounded px-3 py-1.5 hover:bg-orange-100 active:scale-95 transition-all">
        <ChevronDown size={12} className="rotate-90" /> Back to Events
      </button>

      <div className="bg-orange-50 border border-orange-200 rounded p-4">
        <p className="text-sm text-navy font-bold mb-1">Draft Work Package</p>
        <p className="text-xs text-gray-600">Review what's bundled, add or remove items, then send. Nothing goes out to your mechanic until you tap send.</p>
      </div>

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
                <button onClick={() => setRemovedLineItemIds(prev => [...prev, li.id])} className="text-gray-300 hover:text-danger transition-colors active:scale-95 shrink-0 ml-3 p-1" title="Remove from draft">
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

      {availableMx.length > 0 && (
        <div>
          <div className="flex justify-between items-center mb-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-navy flex items-center gap-2"><Wrench size={14} className="text-mxOrange" /> Add More Maintenance Items</p>
            <button type="button" onClick={() => {
              const ids = availableMx.map(mx => mx.id);
              if (allMxSelected) setSelectedMxIds(prev => prev.filter(id => !ids.includes(id)));
              else setSelectedMxIds(prev => Array.from(new Set([...prev, ...ids])));
            }} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-mxOrange hover:opacity-80 active:scale-95">
              <CheckSquare size={12} /> {allMxSelected ? 'Deselect All' : 'Select All'}
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

      {availableSquawks.length > 0 && (
        <div>
          <div className="flex justify-between items-center mb-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-navy flex items-center gap-2"><AlertTriangle size={14} className="text-danger" /> Add Squawks</p>
            <button type="button" onClick={() => {
              const ids = availableSquawks.map(sq => sq.id);
              if (allSquawksSelected) setSelectedSquawkIds(prev => prev.filter(id => !ids.includes(id)));
              else setSelectedSquawkIds(prev => Array.from(new Set([...prev, ...ids])));
            }} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-danger hover:opacity-80 active:scale-95">
              <CheckSquare size={12} /> {allSquawksSelected ? 'Deselect All' : 'Select All'}
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
        <EmailPreview aircraft={aircraft} mxItems={mxItems.filter(mx => selectedMxIds.includes(mx.id))} squawks={squawks.filter(sq => selectedSquawkIds.includes(sq.id))} selectedAddons={selectedAddons} proposedDate={wantsToPropose ? proposedDate : null} existingLines={visibleLineItems} onClose={() => setShowPreview(false)} />
      )}

      <PrimaryButton onClick={handleSend} disabled={isSubmitting}>
        {isSubmitting ? "Sending to Mechanic..." : "Send Work Package to Mechanic"}
      </PrimaryButton>
    </div>
  );
}

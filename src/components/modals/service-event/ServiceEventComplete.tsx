"use client";

import { useState, useRef } from "react";
import { authFetch } from "@/lib/authFetch";
import { supabase } from "@/lib/supabase";
import { Wrench, AlertTriangle, ChevronDown, Camera, Loader2 } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { INPUT_WHITE_BG } from "./shared";
import type { ServiceEventChildProps } from "./shared";

interface ServiceEventCompleteProps extends ServiceEventChildProps {
  selectedEvent: any;
  eventLineItems: any[];
}

export default function ServiceEventComplete({
  aircraft, selectedEvent, eventLineItems,
  isSubmitting, setIsSubmitting, onNavigate, onRefresh, showSuccess, showError, showWarning,
}: ServiceEventCompleteProps) {
  const isTurbine = aircraft?.engine_type === 'Turbine';
  const today = new Date().toISOString().split('T')[0];
  const currentTime = aircraft?.total_engine_time?.toFixed(1) || "";

  const currentHobbs = aircraft?.total_airframe_time?.toFixed(1) || "";

  const [completionItems, setCompletionItems] = useState(() => {
    return eventLineItems
      .filter(li => li.item_type === 'maintenance' || li.item_type === 'squawk')
      .filter(li => li.line_status !== 'complete')
      .map(li => ({
        ...li,
        completionDate: today,
        completionTime: currentTime,
        completedByName: "",
        completedByCert: "",
        workDescription: "",
        // 43.11 fields
        certType: "A&P",
        certNumber: "",
        certExpiry: "",
        tachAtCompletion: currentTime,
        hobbsAtCompletion: currentHobbs,
        logbookRef: "",
        markComplete: true,
      }));
  });

  const updateItem = (index: number, field: string, value: any) => {
    setCompletionItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const [scanningIdx, setScanningIdx] = useState<number | null>(null);
  const scanInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const handleScanLogEntry = async (idx: number, file: File) => {
    if (!aircraft) return;
    setScanningIdx(idx);
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('aircraftId', aircraft.id);
      const res = await authFetch('/api/mx-events/scan-logentry', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Scan failed');
      }
      const { fields, warning } = await res.json();
      if (warning) showWarning(warning);

      // Pre-fill fields from the scan (don't overwrite fields user already filled)
      setCompletionItems(prev => prev.map((item, i) => {
        if (i !== idx) return item;
        return {
          ...item,
          completionDate: fields.completion_date || item.completionDate,
          completionTime: fields.completion_time != null ? String(fields.completion_time) : item.completionTime,
          completedByName: fields.completed_by_name || item.completedByName,
          certType: fields.cert_type || item.certType,
          certNumber: fields.cert_number || item.certNumber,
          certExpiry: fields.cert_expiry || item.certExpiry,
          tachAtCompletion: fields.tach_at_completion != null ? String(fields.tach_at_completion) : item.tachAtCompletion,
          hobbsAtCompletion: fields.hobbs_at_completion != null ? String(fields.hobbs_at_completion) : item.hobbsAtCompletion,
          workDescription: fields.work_description || item.workDescription,
          logbookRef: fields.logbook_ref || item.logbookRef,
        };
      }));
      showSuccess('Logbook entry scanned — review the pre-filled fields below.');
    } catch (err: any) {
      showError("Scan didn't work: " + (err?.message || 'unknown error'));
    } finally {
      setScanningIdx(null);
    }
  };

  const handleCompleteItems = async () => {
    const itemsToComplete = completionItems.filter(c => c.markComplete);
    if (itemsToComplete.length === 0) return showWarning("Check at least one item to mark complete.");

    const mxCompletions = itemsToComplete.filter(c => c.item_type === 'maintenance');
    for (const c of mxCompletions) {
      if (!c.completionDate && !c.completionTime) return showWarning(`Enter logbook completion data for: ${c.item_name}`);
    }

    setIsSubmitting(true);
    try {
      const lineCompletions = itemsToComplete.map(c => ({
        lineItemId: c.id,
        completionDate: c.completionDate || null,
        completionTime: c.completionTime || null,
        completedByName: c.completedByName || null,
        completedByCert: c.completedByCert || null,
        workDescription: c.workDescription || null,
        certType: c.certType || null,
        certNumber: c.certNumber || c.completedByCert || null,
        certExpiry: c.certExpiry || null,
        tachAtCompletion: c.tachAtCompletion || null,
        hobbsAtCompletion: c.hobbsAtCompletion || null,
        logbookRef: c.logbookRef || null,
      }));

      const res = await authFetch('/api/mx-events/complete', {
        method: 'POST',
        body: JSON.stringify({ eventId: selectedEvent.id, lineCompletions, partial: true })
      });
      if (!res.ok) throw new Error("Couldn't complete the items");

      onRefresh();

      // Check if all items are now resolved
      const { data: updatedLines } = await supabase
        .from('aft_event_line_items').select('line_status').eq('event_id', selectedEvent.id);
      const allResolved = updatedLines && updatedLines.every(
        (li: any) => li.line_status === 'complete' || li.line_status === 'deferred'
      );

      if (allResolved) {
        showSuccess("All items resolved — service complete");
        onNavigate('list');
      } else {
        showSuccess(`${itemsToComplete.length} item${itemsToComplete.length > 1 ? 's' : ''} completed — remaining items still open`);
        onNavigate('detail', selectedEvent);
      }
    } catch (err: any) { showError("Couldn't complete the items: " + err.message); }
    setIsSubmitting(false);
  };

  return (
    <div className="space-y-5">
      <button onClick={() => onNavigate('detail', selectedEvent)} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mxOrange bg-orange-50 border border-orange-200 rounded px-3 py-1.5 hover:bg-orange-100 active:scale-95 transition-all">
        <ChevronDown size={12} className="rotate-90" /> Back to Event
      </button>
      <p className="text-sm text-gray-600">Enter the logbook data from your mechanic&apos;s sign-off. Finish items one at a time if you need to — uncheck anything you want to leave open for a later visit.</p>

      {completionItems.map((item, idx) => (
        <div key={item.id} className={`border rounded p-4 space-y-3 transition-all ${item.markComplete ? 'bg-gray-50 border-gray-200' : 'bg-gray-50/50 border-gray-100 opacity-60'}`}>
          <div className="flex items-center gap-3">
            <input type="checkbox" checked={item.markComplete} onChange={e => updateItem(idx, 'markComplete', e.target.checked)} className="w-5 h-5 text-[#56B94A] border-gray-300 rounded cursor-pointer shrink-0" />
            <div className="flex items-center gap-2 flex-1">
              {item.item_type === 'maintenance' ? <Wrench size={14} className="text-mxOrange" /> : <AlertTriangle size={14} className="text-danger" />}
              <h4 className="font-oswald font-bold uppercase text-sm text-navy">{item.item_name}</h4>
            </div>
          </div>
          {item.markComplete && (
            <div className="space-y-3 pl-8 animate-fade-in">
              {/* Scan logbook entry — upload a photo of the mechanic's
                  signoff and Claude extracts the fields. */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => scanInputRefs.current[idx]?.click()}
                  disabled={scanningIdx !== null}
                  className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#7C3AED] bg-purple-50 border border-purple-200 rounded px-3 py-2 hover:bg-purple-100 active:scale-95 disabled:opacity-50 transition-all"
                >
                  {scanningIdx === idx
                    ? <><Loader2 size={12} className="animate-spin" /> Scanning...</>
                    : <><Camera size={12} /> Scan logbook entry</>}
                </button>
                <span className="text-[9px] text-gray-400">Snap the mechanic&apos;s logbook entry — we&apos;ll pre-fill the fields below.</span>
                <input
                  ref={el => { scanInputRefs.current[idx] = el; }}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleScanLogEntry(idx, f);
                    e.target.value = '';
                  }}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Completion Date</label>
                <input type="date" value={item.completionDate} onChange={e => updateItem(idx, 'completionDate', e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Completion {isTurbine ? 'FTT' : 'Tach'}</label>
                <input type="number" min="0" step="0.1" value={item.completionTime} onChange={e => updateItem(idx, 'completionTime', e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="Engine time at completion" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Signed By</label>
                  <input type="text" value={item.completedByName} onChange={e => updateItem(idx, 'completedByName', e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="Name of mechanic" />
                </div>
                <div className="min-w-0">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Cert Type</label>
                  <select value={item.certType} onChange={e => updateItem(idx, 'certType', e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none">
                    <option value="A&P">A&amp;P</option>
                    <option value="IA">IA</option>
                    <option value="Repairman">Repairman</option>
                    <option value="Pilot-Owner">Pilot-Owner (91.411)</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Certificate #</label>
                  <input type="text" value={item.certNumber} onChange={e => updateItem(idx, 'certNumber', e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" />
                </div>
                <div className="min-w-0">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">{item.certType === 'IA' ? 'IA Expiry' : 'Cert Expiry (optional)'}</label>
                  <input type="date" value={item.certExpiry} onChange={e => updateItem(idx, 'certExpiry', e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Tach at Completion</label>
                  <input type="number" min="0" step="0.1" value={item.tachAtCompletion} onChange={e => updateItem(idx, 'tachAtCompletion', e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" />
                </div>
                <div className="min-w-0">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Hobbs at Completion</label>
                  <input type="number" min="0" step="0.1" value={item.hobbsAtCompletion} onChange={e => updateItem(idx, 'hobbsAtCompletion', e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Logbook Reference</label>
                <input type="text" value={item.logbookRef} onChange={e => updateItem(idx, 'logbookRef', e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="e.g. Airframe logbook p.42, Engine logbook p.17" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Work Performed</label>
                <textarea value={item.workDescription} onChange={e => updateItem(idx, 'workDescription', e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none min-h-[60px]" placeholder="Description of work from logbook entry..." />
              </div>
            </div>
          )}
        </div>
      ))}

      {completionItems.length === 0 && (
        <p className="text-center text-sm text-gray-400 py-4">Every item is either completed or deferred.</p>
      )}

      {completionItems.length > 0 && (
        <PrimaryButton onClick={handleCompleteItems} disabled={isSubmitting}>
          {isSubmitting ? "Completing..." : `Complete ${completionItems.filter(c => c.markComplete).length} Item${completionItems.filter(c => c.markComplete).length !== 1 ? 's' : ''} & Reset Tracking`}
        </PrimaryButton>
      )}
    </div>
  );
}

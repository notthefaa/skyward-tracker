"use client";

import { useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { supabase } from "@/lib/supabase";
import { Wrench, AlertTriangle, ChevronDown } from "lucide-react";
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

  const handleCompleteItems = async () => {
    const itemsToComplete = completionItems.filter(c => c.markComplete);
    if (itemsToComplete.length === 0) return showWarning("Please select at least one item to complete.");

    const mxCompletions = itemsToComplete.filter(c => c.item_type === 'maintenance');
    for (const c of mxCompletions) {
      if (!c.completionDate && !c.completionTime) return showWarning(`Please enter logbook completion data for: ${c.item_name}`);
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
      }));

      const res = await authFetch('/api/mx-events/complete', {
        method: 'POST',
        body: JSON.stringify({ eventId: selectedEvent.id, lineCompletions, partial: true })
      });
      if (!res.ok) throw new Error('Failed to complete items');

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
    } catch (err: any) { showError("Failed to complete items: " + err.message); }
    setIsSubmitting(false);
  };

  return (
    <div className="space-y-5">
      <button onClick={() => onNavigate('detail', selectedEvent)} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#F08B46] bg-orange-50 border border-orange-200 rounded px-3 py-1.5 hover:bg-orange-100 active:scale-95 transition-all">
        <ChevronDown size={12} className="rotate-90" /> Back to Event
      </button>
      <p className="text-sm text-gray-600">Enter the logbook data from your mechanic&apos;s sign-off. You can complete items individually — uncheck any items you want to leave open for now.</p>

      {completionItems.map((item, idx) => (
        <div key={item.id} className={`border rounded p-4 space-y-3 transition-all ${item.markComplete ? 'bg-gray-50 border-gray-200' : 'bg-gray-50/50 border-gray-100 opacity-60'}`}>
          <div className="flex items-center gap-3">
            <input type="checkbox" checked={item.markComplete} onChange={e => updateItem(idx, 'markComplete', e.target.checked)} className="w-5 h-5 text-[#56B94A] border-gray-300 rounded cursor-pointer shrink-0" />
            <div className="flex items-center gap-2 flex-1">
              {item.item_type === 'maintenance' ? <Wrench size={14} className="text-[#F08B46]" /> : <AlertTriangle size={14} className="text-[#CE3732]" />}
              <h4 className="font-oswald font-bold uppercase text-sm text-navy">{item.item_name}</h4>
            </div>
          </div>
          {item.markComplete && (
            <div className="space-y-3 pl-8 animate-fade-in">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Completion Date</label>
                <input type="date" value={item.completionDate} onChange={e => updateItem(idx, 'completionDate', e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Completion {isTurbine ? 'FTT' : 'Tach'}</label>
                <input type="number" step="0.1" value={item.completionTime} onChange={e => updateItem(idx, 'completionTime', e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="Engine time at completion" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Signed By</label>
                  <input type="text" value={item.completedByName} onChange={e => updateItem(idx, 'completedByName', e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="IA / A&P" />
                </div>
                <div className="min-w-0">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Certificate #</label>
                  <input type="text" value={item.completedByCert} onChange={e => updateItem(idx, 'completedByCert', e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#56B94A] outline-none" />
                </div>
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
        <p className="text-center text-sm text-gray-400 italic py-4">All items have already been completed or deferred.</p>
      )}

      {completionItems.length > 0 && (
        <PrimaryButton onClick={handleCompleteItems} disabled={isSubmitting}>
          {isSubmitting ? "Completing..." : `Complete ${completionItems.filter(c => c.markComplete).length} Item${completionItems.filter(c => c.markComplete).length !== 1 ? 's' : ''} & Reset Tracking`}
        </PrimaryButton>
      )}
    </div>
  );
}

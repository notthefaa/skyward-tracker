"use client";

import { X } from "lucide-react";

interface EmailPreviewProps {
  aircraft: any;
  mxItems: any[];
  squawks: any[];
  selectedAddons: string[];
  proposedDate: string | null;
  existingLines?: any[];
  onClose: () => void;
}

export default function EmailPreview({ aircraft, mxItems, squawks, selectedAddons, proposedDate, existingLines, onClose }: EmailPreviewProps) {
  const existingMx = (existingLines || []).filter(li => li.item_type === 'maintenance');
  const existingSq = (existingLines || []).filter(li => li.item_type === 'squawk');
  const existingAddon = (existingLines || []).filter(li => li.item_type === 'addon');

  const allMx = [
    ...existingMx.map(li => ({ name: li.item_name, desc: li.item_description })),
    ...mxItems.map(mx => ({ name: mx.item_name, desc: mx.tracking_type === 'time' ? `Due at ${mx.due_time} hrs` : `Due on ${mx.due_date}` }))
  ];
  const allSq = [
    ...existingSq.map(li => ({ name: li.item_name, desc: li.item_description })),
    ...squawks.map(sq => ({ name: sq.description || 'No description', desc: sq.affects_airworthiness && sq.location ? `Grounded at ${sq.location}` : null }))
  ];
  const allAddons = [...existingAddon.map(li => li.item_name), ...selectedAddons];

  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-4 space-y-4 text-sm animate-fade-in">
      <div className="flex justify-between items-center border-b border-gray-200 pb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Email Preview</span>
        <button onClick={onClose} className="text-gray-400 hover:text-danger"><X size={16}/></button>
      </div>
      <div className="space-y-1 text-[10px] text-gray-500">
        <p><strong>To:</strong> {aircraft.mx_contact_email || 'No MX contact set'}</p>
        <p><strong>CC:</strong> {aircraft.main_contact_email || 'None'}</p>
        <p><strong>Subject:</strong> Service Request: {aircraft.tail_number} — Work Package</p>
      </div>
      <div className="border-t border-gray-200 pt-3 space-y-3">
        <p className="text-navy">Hello {aircraft.mx_contact || ''},</p>
        <p className="text-gray-600">We&apos;d like to schedule service for <strong>{aircraft.tail_number}</strong> ({aircraft.aircraft_type}).</p>
        {proposedDate && <p className="text-navy font-bold">Requested Service Date: {proposedDate}</p>}
        {!proposedDate && <p className="text-gray-500 italic">No preferred date on our end — propose dates that work for your shop.</p>}
        {allMx.length > 0 && <div><p className="text-[10px] font-bold uppercase tracking-widest text-mxOrange mb-1">Maintenance Items Due</p>{allMx.map((m, i) => <p key={i} className="text-navy ml-3">• <strong>{m.name}</strong>{m.desc ? ` — ${m.desc}` : ''}</p>)}</div>}
        {allSq.length > 0 && <div><p className="text-[10px] font-bold uppercase tracking-widest text-danger mb-1">Squawks</p>{allSq.map((s, i) => <p key={i} className="text-navy ml-3">• <strong>{s.name}</strong>{s.desc ? ` — ${s.desc}` : ''}</p>)}</div>}
        {allAddons.length > 0 && <div><p className="text-[10px] font-bold uppercase tracking-widest text-info mb-1">Additional Services</p>{allAddons.map((a, i) => <p key={i} className="text-navy ml-3">• {a}</p>)}</div>}
      </div>
    </div>
  );
}

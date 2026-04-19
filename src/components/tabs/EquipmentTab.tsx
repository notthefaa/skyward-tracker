"use client";

import { useState } from "react";
import { authFetch } from "@/lib/authFetch";
import useSWR from "swr";
import { Plus, X, Edit2, Trash2, Power, PowerOff, Plane, Radio, Gauge, Wind, ShieldCheck } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { INPUT_WHITE_BG } from "@/lib/styles";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics, AircraftEquipment, EquipmentCategory, AircraftRole } from "@/lib/types";
import SectionSelector from "@/components/shell/SectionSelector";
import { MORE_SELECTOR_ITEMS, emitMoreNavigate } from "@/components/shell/moreNav";

const CATEGORIES: Array<{ value: EquipmentCategory; label: string }> = [
  { value: 'engine', label: 'Engine' },
  { value: 'propeller', label: 'Propeller' },
  { value: 'avionics', label: 'Avionics' },
  { value: 'transponder', label: 'Transponder' },
  { value: 'altimeter', label: 'Altimeter' },
  { value: 'pitot_static', label: 'Pitot-Static System' },
  { value: 'elt', label: 'ELT' },
  { value: 'adsb', label: 'ADS-B' },
  { value: 'autopilot', label: 'Autopilot' },
  { value: 'gps', label: 'GPS' },
  { value: 'radio', label: 'Radio' },
  { value: 'intercom', label: 'Intercom' },
  { value: 'instrument', label: 'Instrument' },
  { value: 'landing_gear', label: 'Landing Gear' },
  { value: 'lighting', label: 'Lighting' },
  { value: 'accessory', label: 'Accessory' },
  { value: 'other', label: 'Other' },
];

/** Color-code equipment due dates so pilots can tell at a glance
 * whether a transponder / altimeter / pitot-static check is overdue
 * (red), expiring within 30 days (orange), or still good (gray). */
function EquipmentDueTag({ label, date }: { label: string; date: string }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(date + 'T00:00:00');
  const days = Math.floor((due.getTime() - today.getTime()) / 86400000);
  let className = 'text-gray-500';
  if (days < 0) className = 'text-[#CE3732] font-bold';
  else if (days <= 30) className = 'text-[#F08B46] font-bold';
  return (
    <span className={className}>
      {label} {days < 0 ? 'overdue' : 'due'} {date}
      {days < 0 ? ` (${Math.abs(days)}d ago)` : days <= 30 ? ` (${days}d)` : ''}
    </span>
  );
}

function categoryIcon(c: EquipmentCategory) {
  if (c === 'transponder' || c === 'adsb' || c === 'avionics' || c === 'radio' || c === 'autopilot' || c === 'gps' || c === 'intercom') return Radio;
  if (c === 'altimeter' || c === 'pitot_static' || c === 'instrument') return Gauge;
  if (c === 'elt') return ShieldCheck;
  if (c === 'propeller') return Wind;
  return Plane;
}

interface Props {
  aircraft: AircraftWithMetrics | null;
  role: string;
  aircraftRole: AircraftRole | null;
}

export default function EquipmentTab({ aircraft, role, aircraftRole }: Props) {
  const { showSuccess, showError } = useToast();
  const confirm = useConfirm();

  const canEdit = role === 'admin' || aircraftRole === 'admin';

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [includeRemoved, setIncludeRemoved] = useState(false);

  const { data, mutate } = useSWR(
    aircraft ? swrKeys.equipment(aircraft.id, includeRemoved) : null,
    async () => {
      const res = await authFetch(`/api/equipment?aircraftId=${aircraft!.id}${includeRemoved ? '&includeRemoved=true' : ''}`);
      if (!res.ok) throw new Error('Failed to load equipment');
      return await res.json() as { equipment: AircraftEquipment[] };
    }
  );
  const equipment = data?.equipment || [];

  // Form state
  const [fName, setFName] = useState("");
  const [fCategory, setFCategory] = useState<EquipmentCategory>('avionics');
  const [fMake, setFMake] = useState("");
  const [fModel, setFModel] = useState("");
  const [fSerial, setFSerial] = useState("");
  const [fPartNumber, setFPartNumber] = useState("");
  const [fInstalledAt, setFInstalledAt] = useState("");
  const [fInstalledBy, setFInstalledBy] = useState("");
  const [fRemovedAt, setFRemovedAt] = useState("");
  const [fRemovedReason, setFRemovedReason] = useState("");
  const [fIfrCapable, setFIfrCapable] = useState(false);
  const [fAdsbOut, setFAdsbOut] = useState(false);
  const [fAdsbIn, setFAdsbIn] = useState(false);
  const [fTransponderClass, setFTransponderClass] = useState("");
  const [fIsElt, setFIsElt] = useState(false);
  const [fEltBatteryExpires, setFEltBatteryExpires] = useState("");
  const [fPitotStaticDueDate, setFPitotStaticDueDate] = useState("");
  const [fTransponderDueDate, setFTransponderDueDate] = useState("");
  const [fAltimeterDueDate, setFAltimeterDueDate] = useState("");
  const [fNotes, setFNotes] = useState("");

  useModalScrollLock(showForm);

  const resetForm = () => {
    setEditingId(null);
    setFName(""); setFCategory('avionics'); setFMake(""); setFModel(""); setFSerial(""); setFPartNumber("");
    setFInstalledAt(""); setFInstalledBy(""); setFRemovedAt(""); setFRemovedReason("");
    setFIfrCapable(false); setFAdsbOut(false); setFAdsbIn(false); setFTransponderClass("");
    setFIsElt(false); setFEltBatteryExpires("");
    setFPitotStaticDueDate(""); setFTransponderDueDate(""); setFAltimeterDueDate("");
    setFNotes("");
  };

  const openAdd = () => { resetForm(); setShowForm(true); };

  const openEdit = (e: AircraftEquipment) => {
    setEditingId(e.id);
    setFName(e.name);
    setFCategory(e.category);
    setFMake(e.make || ""); setFModel(e.model || ""); setFSerial(e.serial || ""); setFPartNumber(e.part_number || "");
    setFInstalledAt(e.installed_at || ""); setFInstalledBy(e.installed_by || "");
    setFRemovedAt(e.removed_at || ""); setFRemovedReason(e.removed_reason || "");
    setFIfrCapable(!!e.ifr_capable); setFAdsbOut(!!e.adsb_out); setFAdsbIn(!!e.adsb_in);
    setFTransponderClass(e.transponder_class || "");
    setFIsElt(!!e.is_elt); setFEltBatteryExpires(e.elt_battery_expires || "");
    setFPitotStaticDueDate(e.pitot_static_due_date || "");
    setFTransponderDueDate(e.transponder_due_date || "");
    setFAltimeterDueDate(e.altimeter_due_date || "");
    setFNotes(e.notes || "");
    setShowForm(true);
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!aircraft) return;
    setIsSubmitting(true);
    try {
      const payload = {
        name: fName.trim(),
        category: fCategory,
        make: fMake.trim() || null,
        model: fModel.trim() || null,
        serial: fSerial.trim() || null,
        part_number: fPartNumber.trim() || null,
        installed_at: fInstalledAt || null,
        installed_by: fInstalledBy.trim() || null,
        removed_at: fRemovedAt || null,
        removed_reason: fRemovedReason.trim() || null,
        ifr_capable: fIfrCapable,
        adsb_out: fAdsbOut,
        adsb_in: fAdsbIn,
        transponder_class: fTransponderClass.trim() || null,
        is_elt: fIsElt,
        elt_battery_expires: fEltBatteryExpires || null,
        pitot_static_due_date: fPitotStaticDueDate || null,
        transponder_due_date: fTransponderDueDate || null,
        altimeter_due_date: fAltimeterDueDate || null,
        notes: fNotes.trim() || null,
      };
      const method = editingId ? 'PUT' : 'POST';
      const body = editingId
        ? JSON.stringify({ equipmentId: editingId, aircraftId: aircraft.id, equipmentData: payload })
        : JSON.stringify({ aircraftId: aircraft.id, equipmentData: payload });
      const res = await authFetch('/api/equipment', { method, body });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to save'); }
      showSuccess(editingId ? 'Equipment updated.' : 'Equipment added.');
      setShowForm(false);
      await mutate();
    } catch (err: any) { showError(err.message); }
    finally { setIsSubmitting(false); }
  };

  const handleRemove = async (e: AircraftEquipment) => {
    if (!aircraft) return;
    const ok = await confirm({
      title: 'Mark as removed?',
      message: `Mark ${e.name} as removed from the aircraft? The record stays in history.`,
      confirmText: 'Mark removed',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await authFetch('/api/equipment', {
        method: 'PUT',
        body: JSON.stringify({
          equipmentId: e.id,
          aircraftId: aircraft.id,
          equipmentData: { removed_at: new Date().toISOString().split('T')[0] },
        }),
      });
      if (!res.ok) throw new Error('Failed to mark removed');
      showSuccess('Marked as removed.');
      await mutate();
    } catch (err: any) { showError(err.message); }
  };

  const handleDelete = async (e: AircraftEquipment) => {
    if (!aircraft) return;
    const ok = await confirm({
      title: 'Delete equipment record?',
      message: `This is for mistaken entries. For equipment that was removed from the aircraft, use the Mark Removed button instead.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await authFetch('/api/equipment', {
        method: 'DELETE',
        body: JSON.stringify({ equipmentId: e.id, aircraftId: aircraft.id }),
      });
      if (!res.ok) throw new Error('Failed to delete');
      showSuccess('Deleted.');
      await mutate();
    } catch (err: any) { showError(err.message); }
  };

  if (!aircraft) return null;

  const active = equipment.filter(e => !e.removed_at);
  const removed = equipment.filter(e => e.removed_at);

  return (
    <div className="flex flex-col gap-6">
      <SectionSelector
        items={MORE_SELECTOR_ITEMS}
        selectedKey="equipment"
        onSelect={(key) => emitMoreNavigate(key)}
        compact
      />
      {/* Header */}
      <div className="flex items-start justify-between gap-3 -mt-2">
        <div>
          <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Equipment</h2>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#525659]">{active.length} installed on {aircraft.tail_number}</span>
        </div>
        {canEdit && (
          <PrimaryButton onClick={openAdd}><Plus size={14} /> Add</PrimaryButton>
        )}
      </div>

      {/* Active equipment */}
      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#56B94A]">
        <h3 className="font-oswald text-lg font-bold uppercase text-navy mb-4">Currently Installed</h3>
        {active.length === 0 ? (
          <p className="text-sm text-gray-400 italic text-center py-4">No equipment logged yet.</p>
        ) : (
          <div className="space-y-2">
            {active.map(e => {
              const Icon = categoryIcon(e.category);
              return (
                <div key={e.id} className="bg-white border border-gray-200 rounded p-3 flex items-start gap-3">
                  <Icon size={16} className="text-[#525659] shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-oswald font-bold text-sm uppercase text-navy leading-tight">{e.name}</p>
                      {e.ifr_capable && <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#3AB0FF]/10 text-[#3AB0FF] border border-[#3AB0FF]/20">IFR</span>}
                      {e.adsb_out && <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#56B94A]/10 text-[#56B94A] border border-[#56B94A]/20">ADS-B Out</span>}
                      {e.is_elt && <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#F08B46]/10 text-[#F08B46] border border-[#F08B46]/20">ELT</span>}
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-1">
                      {[CATEGORIES.find(c => c.value === e.category)?.label, e.make, e.model, e.serial ? `S/N ${e.serial}` : null].filter(Boolean).join(' · ')}
                    </p>
                    {(e.pitot_static_due_date || e.transponder_due_date || e.altimeter_due_date || e.elt_battery_expires) && (
                      <p className="text-[10px] mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                        {e.pitot_static_due_date && <EquipmentDueTag label="Pitot-static" date={e.pitot_static_due_date} />}
                        {e.transponder_due_date && <EquipmentDueTag label="Xponder" date={e.transponder_due_date} />}
                        {e.altimeter_due_date && <EquipmentDueTag label="Altimeter" date={e.altimeter_due_date} />}
                        {e.elt_battery_expires && <EquipmentDueTag label="ELT battery" date={e.elt_battery_expires} />}
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => openEdit(e)} title="Edit" className="text-gray-400 hover:text-[#F08B46] transition-colors"><Edit2 size={14} /></button>
                      <button onClick={() => handleRemove(e)} title="Mark as removed" className="text-gray-400 hover:text-[#525659] transition-colors"><PowerOff size={14} /></button>
                      <button onClick={() => handleDelete(e)} title="Delete record" className="text-gray-400 hover:text-[#CE3732] transition-colors"><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Removed equipment (history) */}
      <div className="bg-gray-100 shadow-inner rounded-sm p-4 md:p-6">
        <button
          onClick={() => setIncludeRemoved(v => !v)}
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-navy"
        >
          <Power size={12} />
          {includeRemoved ? 'Hide removed history' : `Show removed history${removed.length ? ` (${removed.length})` : ''}`}
        </button>
        {includeRemoved && removed.length > 0 && (
          <div className="space-y-2 mt-3 opacity-70">
            {removed.map(e => (
              <div key={e.id} className="bg-white border border-gray-200 rounded p-3">
                <p className="font-oswald font-bold text-sm uppercase text-gray-600 leading-tight line-through">{e.name}</p>
                <p className="text-[10px] text-gray-500 mt-1">Removed {e.removed_at}{e.removed_reason ? ` — ${e.removed_reason}` : ''}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form modal */}
      {showForm && canEdit && (
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }}>
          <div className="flex min-h-full items-center justify-center p-3">
            <div className="bg-white rounded shadow-2xl w-full max-w-md p-5 border-t-4 border-[#56B94A] animate-slide-up">
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-oswald text-2xl font-bold uppercase text-navy">{editingId ? 'Edit Equipment' : 'Add Equipment'}</h2>
                <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-[#CE3732]"><X size={24} /></button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Name *</label>
                  <input type="text" required value={fName} onChange={e => setFName(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="e.g. Primary Transponder" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Category *</label>
                  <select required value={fCategory} onChange={e => setFCategory(e.target.value as EquipmentCategory)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none">
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Make</label><input type="text" value={fMake} onChange={e => setFMake(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="Garmin" /></div>
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Model</label><input type="text" value={fModel} onChange={e => setFModel(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="GTX 345" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Serial</label><input type="text" value={fSerial} onChange={e => setFSerial(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none" /></div>
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Part #</label><input type="text" value={fPartNumber} onChange={e => setFPartNumber(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Installed</label><input type="date" value={fInstalledAt} onChange={e => setFInstalledAt(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none" /></div>
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Installed By</label><input type="text" value={fInstalledBy} onChange={e => setFInstalledBy(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="A&P name" /></div>
                </div>

                <div className="bg-gray-50 p-3 rounded border border-gray-200 space-y-2">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Capability</p>
                  <label className="flex items-center gap-2 text-xs font-bold text-navy"><input type="checkbox" checked={fIfrCapable} onChange={e => setFIfrCapable(e.target.checked)} /> IFR capable</label>
                  <label className="flex items-center gap-2 text-xs font-bold text-navy"><input type="checkbox" checked={fAdsbOut} onChange={e => setFAdsbOut(e.target.checked)} /> ADS-B Out</label>
                  <label className="flex items-center gap-2 text-xs font-bold text-navy"><input type="checkbox" checked={fAdsbIn} onChange={e => setFAdsbIn(e.target.checked)} /> ADS-B In</label>
                  <label className="flex items-center gap-2 text-xs font-bold text-navy"><input type="checkbox" checked={fIsElt} onChange={e => setFIsElt(e.target.checked)} /> This is the ELT</label>
                </div>

                {fCategory === 'transponder' && (
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Transponder Class</label><input type="text" value={fTransponderClass} onChange={e => setFTransponderClass(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="e.g. Class 1A Mode S/ES" /></div>
                )}

                {fIsElt && (
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">ELT Battery Expires</label><input type="date" value={fEltBatteryExpires} onChange={e => setFEltBatteryExpires(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none" /></div>
                )}

                {(fCategory === 'pitot_static' || fCategory === 'altimeter' || fCategory === 'transponder') && (
                  <div className="grid grid-cols-1 gap-3">
                    {fCategory === 'pitot_static' && <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Pitot-Static Due (91.411)</label><input type="date" value={fPitotStaticDueDate} onChange={e => setFPitotStaticDueDate(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none" /></div>}
                    {fCategory === 'altimeter' && <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Altimeter Due (91.411)</label><input type="date" value={fAltimeterDueDate} onChange={e => setFAltimeterDueDate(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none" /></div>}
                    {fCategory === 'transponder' && <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Transponder Due (91.413)</label><input type="date" value={fTransponderDueDate} onChange={e => setFTransponderDueDate(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none" /></div>}
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Notes</label>
                  <textarea value={fNotes} onChange={e => setFNotes(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none min-h-[60px]" />
                </div>

                <div className="pt-2 flex gap-2">
                  <button type="button" onClick={() => setShowForm(false)} className="flex-1 border border-gray-300 text-gray-600 font-oswald font-bold uppercase tracking-widest py-3 rounded text-xs active:scale-95">Cancel</button>
                  <PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : editingId ? "Update" : "Add Equipment"}</PrimaryButton>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

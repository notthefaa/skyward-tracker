"use client";

import { useState } from "react";
import { authFetch } from "@/lib/authFetch";
import useSWR from "swr";
import { Plus, X, Edit2, Trash2, Download, RefreshCw, ExternalLink, ShieldAlert, CheckCircle, AlertTriangle, Sparkles, Info } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { INPUT_WHITE_BG } from "@/lib/styles";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics, AirworthinessDirective, AircraftRole } from "@/lib/types";
import SectionSelector from "@/components/shell/SectionSelector";
import { MX_ADS_SELECTOR_ITEMS, emitMxAdsNavigate } from "@/components/shell/mxAdsNav";
import { ModalPortal } from "@/components/ModalPortal";
import { mutateWithDeadline } from "@/lib/mutateWithDeadline";

interface Props {
  aircraft: AircraftWithMetrics | null;
  role: string;
  aircraftRole: AircraftRole | null;
}

export default function ADsTab({ aircraft, role, aircraftRole }: Props) {
  const { showSuccess, showError } = useToast();
  const confirm = useConfirm();

  const canEdit = role === 'admin' || aircraftRole === 'admin';
  const et = aircraft?.total_engine_time || 0;
  const today = new Date(new Date().setHours(0, 0, 0, 0));

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncYears, setSyncYears] = useState<5 | 10 | 20 | 'all'>(5);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  // Equipment for missing-info banner. Also drives the engine/prop
  // match path server-side — warning the pilot when it's incomplete.
  type EqRow = { id: string; category: string; make: string | null; model: string | null; serial: string | null };
  const { data: equipmentData } = useSWR(
    aircraft ? ['equipment', aircraft.id] : null,
    async () => {
      const res = await authFetch(`/api/equipment?aircraftId=${aircraft!.id}`);
      if (!res.ok) throw new Error("Couldn't load equipment");
      const d = await res.json();
      return { equipment: (d.equipment || []) as EqRow[] };
    }
  );
  const equipment = equipmentData?.equipment || [];

  const { data, mutate } = useSWR(
    aircraft ? swrKeys.ads(aircraft.id) : null,
    async () => {
      const res = await authFetch(`/api/ads?aircraftId=${aircraft!.id}`);
      if (!res.ok) throw new Error("Couldn't load ADs");
      return await res.json() as { ads: AirworthinessDirective[] };
    }
  );
  const ads = data?.ads || [];

  // Classify each AD's urgency
  const classified = ads.map(a => {
    const timeOverdue = a.next_due_time != null && et >= a.next_due_time;
    const dateOverdue = a.next_due_date != null && new Date(a.next_due_date + 'T00:00:00') < today;
    const daysOut = a.next_due_date
      ? Math.ceil((new Date(a.next_due_date + 'T00:00:00').getTime() - today.getTime()) / 86400000)
      : null;
    const hrsOut = a.next_due_time != null ? a.next_due_time - et : null;
    let status: 'overdue' | 'due_soon' | 'compliant' | 'untracked' = 'compliant';
    if (timeOverdue || dateOverdue) status = 'overdue';
    else if ((daysOut != null && daysOut <= 30) || (hrsOut != null && hrsOut <= 10)) status = 'due_soon';
    else if (a.next_due_time == null && a.next_due_date == null) status = 'untracked';
    return { ad: a, status, daysOut, hrsOut };
  });

  // Form state
  const [fAdNumber, setFAdNumber] = useState("");
  const [fSubject, setFSubject] = useState("");
  const [fEffectiveDate, setFEffectiveDate] = useState("");
  const [fComplianceType, setFComplianceType] = useState<'one_time' | 'recurring'>('one_time');
  const [fLastCompliedDate, setFLastCompliedDate] = useState("");
  const [fLastCompliedTime, setFLastCompliedTime] = useState("");
  const [fLastCompliedBy, setFLastCompliedBy] = useState("");
  const [fRecurringHours, setFRecurringHours] = useState("");
  const [fRecurringMonths, setFRecurringMonths] = useState("");
  const [fNextDueDate, setFNextDueDate] = useState("");
  const [fNextDueTime, setFNextDueTime] = useState("");
  const [fComplianceMethod, setFComplianceMethod] = useState("");
  const [fSourceUrl, setFSourceUrl] = useState("");
  const [fAffectsAirworthiness, setFAffectsAirworthiness] = useState(true);
  const [fNotes, setFNotes] = useState("");

  useModalScrollLock(showForm);

  const resetForm = () => {
    setEditingId(null);
    setFAdNumber(""); setFSubject(""); setFEffectiveDate("");
    setFComplianceType('one_time');
    setFLastCompliedDate(""); setFLastCompliedTime(""); setFLastCompliedBy("");
    setFRecurringHours(""); setFRecurringMonths("");
    setFNextDueDate(""); setFNextDueTime("");
    setFComplianceMethod(""); setFSourceUrl(""); setFAffectsAirworthiness(true); setFNotes("");
  };

  const openAdd = () => { resetForm(); setShowForm(true); };

  const openEdit = (a: AirworthinessDirective) => {
    setEditingId(a.id);
    setFAdNumber(a.ad_number);
    setFSubject(a.subject);
    setFEffectiveDate(a.effective_date || "");
    setFComplianceType(a.compliance_type);
    setFLastCompliedDate(a.last_complied_date || "");
    setFLastCompliedTime(a.last_complied_time != null ? String(a.last_complied_time) : "");
    setFLastCompliedBy(a.last_complied_by || "");
    setFRecurringHours(a.recurring_interval_hours != null ? String(a.recurring_interval_hours) : "");
    setFRecurringMonths(a.recurring_interval_months != null ? String(a.recurring_interval_months) : "");
    setFNextDueDate(a.next_due_date || "");
    setFNextDueTime(a.next_due_time != null ? String(a.next_due_time) : "");
    setFComplianceMethod(a.compliance_method || "");
    setFSourceUrl(a.source_url || "");
    setFAffectsAirworthiness(!!a.affects_airworthiness);
    setFNotes(a.notes || "");
    setShowForm(true);
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!aircraft) return;
    setIsSubmitting(true);
    try {
      const payload: any = {
        ad_number: fAdNumber.trim(),
        subject: fSubject.trim(),
        effective_date: fEffectiveDate || null,
        compliance_type: fComplianceType,
        last_complied_date: fLastCompliedDate || null,
        last_complied_time: fLastCompliedTime ? parseFloat(fLastCompliedTime) : null,
        last_complied_by: fLastCompliedBy.trim() || null,
        recurring_interval_hours: fRecurringHours ? parseFloat(fRecurringHours) : null,
        recurring_interval_months: fRecurringMonths ? parseInt(fRecurringMonths) : null,
        next_due_date: fNextDueDate || null,
        next_due_time: fNextDueTime ? parseFloat(fNextDueTime) : null,
        compliance_method: fComplianceMethod.trim() || null,
        source_url: fSourceUrl.trim() || null,
        affects_airworthiness: fAffectsAirworthiness,
        notes: fNotes.trim() || null,
      };
      const method = editingId ? 'PUT' : 'POST';
      const body = editingId
        ? JSON.stringify({ adId: editingId, aircraftId: aircraft.id, adData: payload })
        : JSON.stringify({ aircraftId: aircraft.id, adData: payload });
      const res = await authFetch('/api/ads', { method, body });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Couldn't save the AD"); }
      showSuccess(editingId ? 'AD updated.' : 'AD added.');
      setShowForm(false);
      await mutateWithDeadline(mutate());
    } catch (err: any) { showError(err.message); }
    finally { setIsSubmitting(false); }
  };

  const handleDelete = async (a: AirworthinessDirective) => {
    if (!aircraft) return;
    const ok = await confirm({
      title: 'Remove AD from tracking?',
      message: `${a.ad_number} will be removed from tracking. The compliance history stays in the record.`,
      confirmText: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await authFetch('/api/ads', {
        method: 'DELETE',
        body: JSON.stringify({ adId: a.id, aircraftId: aircraft.id }),
      });
      if (!res.ok) throw new Error("Couldn't remove the AD");
      showSuccess('Removed.');
      await mutateWithDeadline(mutate());
    } catch (err: any) { showError(err.message); }
  };

  const handleRefresh = async () => {
    if (!aircraft) return;
    setIsSyncing(true);
    try {
      const yearsPayload = syncYears === 'all' ? null : syncYears;
      const res = await authFetch('/api/ads/sync', {
        method: 'POST',
        body: JSON.stringify({ aircraftId: aircraft.id, years: yearsPayload }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Sync failed');
      await mutateWithDeadline(mutate());
      const { inserted = 0, updated = 0, pruned = 0, reviewRequired = 0 } = body;
      if (inserted === 0 && updated === 0 && pruned === 0) {
        showSuccess('Up to date — no new ADs found.');
      } else {
        const parts = [];
        if (inserted) parts.push(`${inserted} new`);
        if (updated) parts.push(`${updated} updated`);
        if (pruned) parts.push(`${pruned} removed (no longer applicable)`);
        if (reviewRequired) parts.push(`${reviewRequired} need review`);
        showSuccess(`Synced: ${parts.join(', ')}.`);
      }
    } catch (err: any) { showError(err.message); }
    finally { setIsSyncing(false); }
  };

  const handleCheckApplicability = async (adId: string) => {
    setCheckingId(adId);
    try {
      const res = await authFetch('/api/ads/check-applicability', {
        method: 'POST',
        body: JSON.stringify({ adId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Couldn't check applicability.");
      await mutateWithDeadline(mutate());
      const label =
        body.status === 'applies' ? 'Applies to this aircraft' :
        body.status === 'does_not_apply' ? 'Does not apply' :
        'Still needs review';
      showSuccess(`${label}: ${body.reason}`);
    } catch (err: any) { showError(err.message); }
    finally { setCheckingId(null); }
  };

  // Missing-info banner: list fields that, if filled, would improve
  // AD matching accuracy for this aircraft.
  const missingFields: string[] = [];
  if (aircraft) {
    if (!aircraft.make) missingFields.push('make');
    if (!aircraft.serial_number) missingFields.push('serial number');
    if (!aircraft.type_certificate) missingFields.push('type certificate');
    const engines = equipment.filter(e => e.category === 'engine');
    if (engines.length === 0) missingFields.push('engine (add via Equipment)');
    else if (engines.some(e => !e.make || !e.model)) missingFields.push('engine make/model');
    else if (engines.some(e => !e.serial)) missingFields.push('engine serial');
    const props = equipment.filter(e => e.category === 'propeller');
    if (props.length === 0) missingFields.push('propeller (add via Equipment)');
    else if (props.some(e => !e.make || !e.model)) missingFields.push('propeller make/model');
    else if (props.some(e => !e.serial)) missingFields.push('propeller serial');
  }

  const handleExport = () => {
    if (!aircraft) return;
    window.open(`/api/ads/export?aircraftId=${aircraft.id}&format=csv`, '_blank');
  };

  if (!aircraft) return null;

  const overdue = classified.filter(c => c.status === 'overdue');
  const dueSoon = classified.filter(c => c.status === 'due_soon');
  const compliant = classified.filter(c => c.status === 'compliant');
  const untracked = classified.filter(c => c.status === 'untracked');

  return (
    <div className="flex flex-col gap-6">
      {/* ─── MX / SQUAWKS / SERVICE / ADS SELECTOR ─── */}
      <div className="-mb-2">
        <SectionSelector
          items={MX_ADS_SELECTOR_ITEMS}
          selectedKey="ads"
          onSelect={(key) => emitMxAdsNavigate(key)}
          compact
        />
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">ADs</h2>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#7C3AED]">{ads.length} tracked on {aircraft.tail_number}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={syncYears}
            onChange={e => setSyncYears(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10) as 5 | 10 | 20)}
            className="text-[10px] font-bold uppercase tracking-widest text-navy bg-white border border-gray-300 rounded px-2 py-1 focus:border-[#7C3AED] outline-none"
            title="How far back to pull ADs"
          >
            <option value={5}>Last 5 yrs</option>
            <option value={10}>Last 10 yrs</option>
            <option value={20}>Last 20 yrs</option>
            <option value="all">All history</option>
          </select>
          <button onClick={handleRefresh} disabled={isSyncing} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#7C3AED] bg-purple-50 border border-purple-200 rounded px-2.5 py-1 hover:bg-purple-100 active:scale-95 disabled:opacity-50">
            <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} /> Sync from DRS
          </button>
          <button onClick={handleExport} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#56B94A] bg-green-50 border border-green-200 rounded px-2.5 py-1 hover:bg-green-100 active:scale-95">
            <Download size={12} /> 91.417(b) CSV
          </button>
          {canEdit && (
            <PrimaryButton onClick={openAdd}><Plus size={14} /> Add AD</PrimaryButton>
          )}
        </div>
      </div>

      {/* Missing-info banner — aircraft fields that would improve AD match accuracy */}
      {missingFields.length > 0 && (
        <div className="bg-info/5 border border-info/20 rounded p-3 flex items-start gap-2">
          <Info size={14} className="text-info shrink-0 mt-0.5" />
          <div className="text-xs text-navy leading-relaxed">
            <p className="font-bold text-[11px] uppercase tracking-widest text-info mb-1">Improve AD match accuracy</p>
            <p>
              Add the following to this aircraft so engine and propeller ADs can be evaluated for your specific
              equipment: <span className="font-bold">{missingFields.join(', ')}</span>.
            </p>
          </div>
        </div>
      )}

      {/* Overdue */}
      {overdue.length > 0 && (
        <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-danger">
          <h3 className="font-oswald text-lg font-bold uppercase text-danger mb-4 flex items-center gap-2"><ShieldAlert size={16} /> Overdue ({overdue.length})</h3>
          <div className="space-y-2">
            {overdue.map(c => renderAdRow(c, canEdit, openEdit, handleDelete, handleCheckApplicability, checkingId))}
          </div>
        </div>
      )}

      {/* Due soon */}
      {dueSoon.length > 0 && (
        <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-mxOrange">
          <h3 className="font-oswald text-lg font-bold uppercase text-mxOrange mb-4 flex items-center gap-2"><AlertTriangle size={16} /> Due Soon ({dueSoon.length})</h3>
          <div className="space-y-2">
            {dueSoon.map(c => renderAdRow(c, canEdit, openEdit, handleDelete, handleCheckApplicability, checkingId))}
          </div>
        </div>
      )}

      {/* Compliant */}
      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#56B94A]">
        <h3 className="font-oswald text-lg font-bold uppercase text-[#56B94A] mb-4 flex items-center gap-2"><CheckCircle size={16} /> In Compliance ({compliant.length})</h3>
        {compliant.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No ADs currently compliant.</p>
        ) : (
          <div className="space-y-2">
            {compliant.map(c => renderAdRow(c, canEdit, openEdit, handleDelete, handleCheckApplicability, checkingId))}
          </div>
        )}
      </div>

      {/* Untracked */}
      {untracked.length > 0 && (
        <div className="bg-gray-100 shadow-inner rounded-sm p-4 md:p-6">
          <h3 className="font-oswald text-sm font-bold uppercase text-gray-500 mb-3">Needs compliance data ({untracked.length})</h3>
          <p className="text-xs text-gray-500 mb-3">These ADs were added but don&apos;t yet have compliance dates logged. Handle the <span className="text-danger font-bold">Grounds aircraft</span> ones first — until their compliance is recorded, the aircraft may not be legal to fly.</p>
          <div className="space-y-2">
            {untracked.map(c => renderAdRow(c, canEdit, openEdit, handleDelete, handleCheckApplicability, checkingId, true))}
          </div>
        </div>
      )}

      {ads.length === 0 && (
        <div className="bg-white shadow-md rounded-sm p-6 text-center">
          <p className="text-sm text-gray-500 mb-3">No ADs tracked yet. Sync from the FAA or add one manually.</p>
          {canEdit && <PrimaryButton onClick={openAdd}><Plus size={14} /> Add First AD</PrimaryButton>}
        </div>
      )}

      {/* Form modal */}
      {showForm && canEdit && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }}>
          <div className="flex min-h-full items-center justify-center p-3">
            <div className="bg-white rounded shadow-2xl w-full max-w-md p-5 border-t-4 border-[#7C3AED] animate-slide-up">
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-oswald text-2xl font-bold uppercase text-navy">{editingId ? 'Edit AD' : 'Add AD'}</h2>
                <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-danger"><X size={24} /></button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">AD Number *</label><input type="text" required value={fAdNumber} onChange={e => setFAdNumber(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#7C3AED] outline-none" placeholder="2020-12-04" /></div>
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Effective Date</label><input type="date" value={fEffectiveDate} onChange={e => setFEffectiveDate(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#7C3AED] outline-none" /></div>
                </div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Subject *</label><input type="text" required value={fSubject} onChange={e => setFSubject(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#7C3AED] outline-none" /></div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Compliance Type</label>
                  <select value={fComplianceType} onChange={e => setFComplianceType(e.target.value as any)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#7C3AED] outline-none">
                    <option value="one_time">One-Time</option>
                    <option value="recurring">Recurring</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Last Complied Date</label><input type="date" value={fLastCompliedDate} onChange={e => setFLastCompliedDate(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#7C3AED] outline-none" /></div>
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">At Aircraft Hours</label><input type="number" inputMode="decimal" step="0.1" value={fLastCompliedTime} onChange={e => setFLastCompliedTime(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#7C3AED] outline-none" /></div>
                </div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Complied By</label><input type="text" value={fLastCompliedBy} onChange={e => setFLastCompliedBy(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#7C3AED] outline-none" placeholder="A&P / IA name + cert #" /></div>
                {fComplianceType === 'recurring' && (
                  <div className="grid grid-cols-2 gap-3 bg-gray-50 p-3 rounded border border-gray-200">
                    <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Every (hrs)</label><input type="number" inputMode="decimal" step="0.1" value={fRecurringHours} onChange={e => setFRecurringHours(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#7C3AED] outline-none" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Or (months)</label><input type="number" value={fRecurringMonths} onChange={e => setFRecurringMonths(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#7C3AED] outline-none" /></div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Next Due Date</label><input type="date" value={fNextDueDate} onChange={e => setFNextDueDate(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#7C3AED] outline-none" /></div>
                  <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Next Due Hours</label><input type="number" inputMode="decimal" step="0.1" value={fNextDueTime} onChange={e => setFNextDueTime(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#7C3AED] outline-none" /></div>
                </div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Method of Compliance</label><input type="text" value={fComplianceMethod} onChange={e => setFComplianceMethod(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#7C3AED] outline-none" placeholder="e.g. Inspected per AD paragraph (g); no cracks found" /></div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Source URL</label><input type="url" value={fSourceUrl} onChange={e => setFSourceUrl(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#7C3AED] outline-none" placeholder="FAA PDF link" /></div>
                <label className="flex items-center gap-2 text-xs font-bold text-navy cursor-pointer"><input type="checkbox" checked={fAffectsAirworthiness} onChange={e => setFAffectsAirworthiness(e.target.checked)} /> Non-compliance grounds the aircraft</label>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy block">Notes</label><textarea value={fNotes} onChange={e => setFNotes(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#7C3AED] outline-none min-h-[60px]" /></div>

                <div className="pt-2 flex gap-2">
                  <button type="button" onClick={() => setShowForm(false)} className="flex-1 border border-gray-300 text-gray-600 font-oswald font-bold uppercase tracking-widest py-3 rounded text-xs active:scale-95">Cancel</button>
                  <PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : editingId ? "Update" : "Add AD"}</PrimaryButton>
                </div>
              </form>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  );
}

function renderAdRow(
  c: { ad: AirworthinessDirective; status: string; daysOut: number | null; hrsOut: number | null },
  canEdit: boolean,
  openEdit: (a: AirworthinessDirective) => void,
  handleDelete: (a: AirworthinessDirective) => void,
  handleCheckApplicability: (adId: string) => void,
  checkingId: string | null,
  showGroundingPill = false,
) {
  const { ad, status, daysOut, hrsOut } = c;
  const appStatus = ad.applicability_status;
  const appPill =
    appStatus === 'applies' ? { label: 'Applies', cls: 'bg-danger/10 text-danger border-danger/30' } :
    appStatus === 'does_not_apply' ? { label: 'N/A to this aircraft', cls: 'bg-gray-100 text-gray-500 border-gray-200' } :
    appStatus === 'review_required' ? { label: 'Review required', cls: 'bg-mxOrange/10 text-mxOrange border-mxOrange/30' } :
    null;
  const isChecking = checkingId === ad.id;
  return (
    <div key={ad.id} className="bg-white border border-gray-200 rounded p-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-oswald font-bold text-sm uppercase text-navy leading-tight">AD {ad.ad_number}</p>
          {ad.source === 'drs_sync' && <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/20">DRS</span>}
          {appPill && (
            <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${appPill.cls}`}>{appPill.label}</span>
          )}
          {ad.compliance_type === 'recurring' && <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-info/10 text-info border border-info/20">Recurring</span>}
          {showGroundingPill && ad.affects_airworthiness && (
            <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-danger/10 text-danger border border-danger/30">Grounds aircraft</span>
          )}
          {!ad.affects_airworthiness && <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">Non-AW</span>}
        </div>
        <p className="text-sm text-navy mt-1 leading-tight">{ad.subject}</p>
        {ad.applicability_reason && (
          <p className="text-[10px] text-gray-500 mt-1">{ad.applicability_reason}</p>
        )}
        {(ad.next_due_date || ad.next_due_time != null) && (
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-1">
            {status === 'overdue' ? 'Overdue' : 'Due'}:
            {ad.next_due_date && ` ${ad.next_due_date}${daysOut != null ? ` (${daysOut}d)` : ''}`}
            {ad.next_due_time != null && ` @ ${ad.next_due_time.toFixed(1)} hrs${hrsOut != null ? ` (${hrsOut.toFixed(1)} hrs)` : ''}`}
          </p>
        )}
        {ad.compliance_method && (
          <p className="text-[10px] text-gray-500 mt-1">Method: {ad.compliance_method}</p>
        )}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {ad.source_url && (
            <a href={ad.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-info underline"><ExternalLink size={10} /> FAA source</a>
          )}
          {ad.source === 'drs_sync' && appStatus === 'review_required' && canEdit && (
            <button
              onClick={() => handleCheckApplicability(ad.id)}
              disabled={isChecking}
              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#7C3AED] hover:underline disabled:opacity-50"
              title="Have Howard parse this AD's applicability against your aircraft's serials and equipment"
            >
              <Sparkles size={10} className={isChecking ? 'animate-pulse' : ''} />
              {isChecking ? 'Checking…' : 'Check applicability'}
            </button>
          )}
        </div>
      </div>
      {canEdit && (
        <div className="flex gap-2 shrink-0">
          <button onClick={() => openEdit(ad)} title="Edit" className="text-gray-400 hover:text-mxOrange"><Edit2 size={14} /></button>
          <button onClick={() => handleDelete(ad)} title="Remove" className="text-gray-400 hover:text-danger"><Trash2 size={14} /></button>
        </div>
      )}
    </div>
  );
}

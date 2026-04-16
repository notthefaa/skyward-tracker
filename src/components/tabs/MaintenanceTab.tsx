import { useState, useEffect } from "react";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { processMxItem, getMxTextColor, isMxExpired } from "@/lib/math";
import { INPUT_WHITE_BG } from "@/lib/styles";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics, SystemSettings, AircraftRole, MxSubTab } from "@/lib/types";
import useSWR from "swr";
import { Wrench, Trash2, Plus, X, Edit2, Calendar, Send, ExternalLink, ChevronRight, HelpCircle, AlertTriangle, Download, Layers, Settings, ClipboardList, ShieldAlert } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import ServiceEventModal from "@/components/modals/ServiceEventModal";
import MxGuideModal from "@/components/modals/MxGuideModal";
import MxTemplatePickerModal from "@/components/modals/MxTemplatePickerModal";
import SquawksTab from "@/components/tabs/SquawksTab";
import SectionSelector from "@/components/shell/SectionSelector";
import { MX_ADS_SELECTOR_ITEMS, emitMxAdsNavigate } from "@/components/shell/mxAdsNav";

export default function MaintenanceTab({ 
  aircraft, role, aircraftRole, onGroundedStatusChange, sysSettings, session, userInitials, initialSubTab
}: { 
  aircraft: AircraftWithMetrics | null, 
  role: string,
  aircraftRole: AircraftRole | null,
  onGroundedStatusChange: () => void,
  sysSettings: SystemSettings,
  session: any,
  userInitials: string,
  initialSubTab?: MxSubTab
}) {
  const { showSuccess, showError, showWarning } = useToast();
  const confirm = useConfirm();
  const [subTab, setSubTab] = useState<MxSubTab>(initialSubTab || 'maintenance');

  useEffect(() => {
    if (initialSubTab) setSubTab(initialSubTab);
  }, [initialSubTab]);

  const canEditMx = role === 'admin' || aircraftRole === 'admin';
  const currentEngineTime = aircraft?.total_engine_time || 0;
  const isTurbine = aircraft?.engine_type === 'Turbine';

  const { data: mxItems = [], mutate } = useSWR(
    aircraft ? swrKeys.mxItems(aircraft.id) : null,
    async () => {
      const { data } = await supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraft!.id).is('deleted_at', null).order('due_date').order('due_time');
      return (data || []) as any[];
    }
  );

  const { data: activeEvents = [], mutate: mutateEvents } = useSWR(
    aircraft ? swrKeys.mxEvents(aircraft.id) : null,
    async () => {
      const { data } = await supabase.from('aft_maintenance_events').select('*').eq('aircraft_id', aircraft!.id).is('deleted_at', null).in('status', ['draft', 'scheduling', 'confirmed', 'in_progress', 'ready_for_pickup']).order('created_at', { ascending: false });
      return data || [];
    }
  );

  const [showMxModal, setShowMxModal] = useState(false);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mxName, setMxName] = useState("");
  const [mxTrackingType, setMxTrackingType] = useState<'time'|'date'|'both'>('date');
  const [mxIsRequired, setMxIsRequired] = useState(true);
  const [mxLastTime, setMxLastTime] = useState(""); const [mxIntervalTime, setMxIntervalTime] = useState(""); const [mxDueTime, setMxDueTime] = useState("");
  const [mxLastDate, setMxLastDate] = useState(""); const [mxIntervalDays, setMxIntervalDays] = useState(""); const [mxDueDate, setMxDueDate] = useState("");
  const [automateScheduling, setAutomateScheduling] = useState(false);
  const [confirmResendId, setConfirmResendId] = useState<string | null>(null);
  const [resendingEventId, setResendingEventId] = useState<string | null>(null);
  const [isExportingMx, setIsExportingMx] = useState(false);

  useModalScrollLock(showMxModal || !!confirmResendId);

  // ─── Separate items into active tracking vs needs-setup ───
  const needsSetupItems = mxItems.filter(item => {
    if (item.tracking_type === 'time') return item.due_time === null || item.due_time === undefined;
    if (item.tracking_type === 'date') return item.due_date === null || item.due_date === undefined;
    return false;
  });

  const activeItems = mxItems.filter(item => {
    if (item.tracking_type === 'time') return item.due_time !== null && item.due_time !== undefined;
    if (item.tracking_type === 'date') return item.due_date !== null && item.due_date !== undefined;
    return true;
  });

  const exportMxHistory = async () => {
    if (!aircraft) return;
    setIsExportingMx(true);
    try {
      const { data: completedEvents } = await supabase
        .from('aft_maintenance_events').select('*')
        .eq('aircraft_id', aircraft.id).eq('status', 'complete').is('deleted_at', null)
        .order('completed_at', { ascending: false });

      if (!completedEvents || completedEvents.length === 0) {
        showWarning("No completed service events to export.");
        setIsExportingMx(false);
        return;
      }

      const eventIds = completedEvents.map((e: any) => e.id);
      const { data: allLineItems } = await supabase
        .from('aft_event_line_items').select('*').in('event_id', eventIds);

      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF();
      let y = 20;

      doc.setFont("helvetica", "bold"); doc.setFontSize(18);
      doc.text(`Maintenance History - ${aircraft.tail_number}`, 14, y); y += 8;
      doc.setFontSize(10); doc.setFont("helvetica", "normal");
      doc.text(`${aircraft.aircraft_type} | SN: ${aircraft.serial_number || 'N/A'} | Generated ${new Date().toLocaleDateString()}`, 14, y); y += 15;

      for (const ev of completedEvents) {
        if (y > 240) { doc.addPage(); y = 20; }
        const evLines = (allLineItems || []).filter((li: any) => li.event_id === ev.id);
        const completedDate = ev.completed_at ? new Date(ev.completed_at).toLocaleDateString() : 'Unknown';
        doc.setDrawColor(9, 31, 60); doc.setLineWidth(0.5);
        doc.line(14, y, 196, y); y += 8;
        doc.setFont("helvetica", "bold"); doc.setFontSize(12);
        doc.text(`Service Completed: ${completedDate}`, 14, y); y += 6;
        doc.setFontSize(9); doc.setFont("helvetica", "normal");
        if (ev.mx_contact_name) { doc.text(`Mechanic: ${ev.mx_contact_name}`, 14, y); y += 5; }
        if (ev.confirmed_date) { doc.text(`Service Date: ${ev.confirmed_date}`, 14, y); y += 5; }
        y += 3;
        for (const li of evLines) {
          if (y > 260) { doc.addPage(); y = 20; }
          doc.setFont("helvetica", "bold"); doc.setFontSize(10);
          doc.text(`${li.item_name}`, 18, y); y += 5;
          doc.setFont("helvetica", "normal"); doc.setFontSize(9);
          if (li.item_description) { doc.text(li.item_description, 22, y); y += 4; }
          const status = (li.line_status || 'pending').toUpperCase();
          doc.text(`Status: ${status}`, 22, y); y += 4;
          if (li.completion_date) { doc.text(`Completed: ${li.completion_date}${li.completion_time ? ' @ ' + li.completion_time + ' hrs' : ''}`, 22, y); y += 4; }
          if (li.completed_by_name) { doc.text(`Signed: ${li.completed_by_name}${li.completed_by_cert ? ' (Cert #' + li.completed_by_cert + ')' : ''}`, 22, y); y += 4; }
          if (li.work_description) {
            const splitWork = doc.splitTextToSize(`Work: ${li.work_description}`, 170);
            doc.text(splitWork, 22, y); y += (splitWork.length * 4);
          }
          y += 4;
        }
        y += 5;
      }
      doc.save(`${aircraft.tail_number}_Maintenance_History.pdf`);
    } catch (error) {
      console.error("MX export error:", error);
      showError("Failed to generate maintenance history PDF.");
    }
    setIsExportingMx(false);
  };

  // Only check active items (not needs-setup) for grounded status
  const isGroundedLocally = activeItems.some(item => {
    if (!item.is_required) return false;
    if (item.tracking_type === 'time') return item.due_time <= currentEngineTime;
    if (item.tracking_type === 'date') return new Date(item.due_date + 'T00:00:00') < new Date(new Date().setHours(0,0,0,0));
    return false;
  });

  const openMxForm = (item: any = null) => {
    if (item) {
      setEditingId(item.id); setMxName(item.item_name); setMxTrackingType(item.tracking_type); setMxIsRequired(item.is_required);
      setMxLastTime(item.last_completed_time?.toString() || ""); setMxIntervalTime(item.time_interval?.toString() || ""); setMxDueTime(item.due_time?.toString() || "");
      setMxLastDate(item.last_completed_date || ""); setMxIntervalDays(item.date_interval_days?.toString() || ""); setMxDueDate(item.due_date || "");
      setAutomateScheduling(item.automate_scheduling || false);
    } else {
      setEditingId(null); setMxName(""); setMxTrackingType('date'); setMxIsRequired(true);
      setMxLastTime(""); setMxIntervalTime(""); setMxDueTime("");
      setMxLastDate(""); setMxIntervalDays(""); setMxDueDate("");
      setAutomateScheduling(false);
    }
    setShowMxModal(true);
  };

  const handleManualMxTrigger = async (item: any) => {
    const ok = await confirm({
      title: "Create Draft Work Package?",
      message: `A draft work package will be created for "${item.item_name}" and the primary contact will be notified.`,
      confirmText: "Create Draft",
    });
    if (!ok) return;
    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/mx-events/manual-trigger', { method: 'POST', body: JSON.stringify({ mxItemId: item.id, aircraftId: aircraft!.id }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed to create draft work package.'); }
      await mutate(); await mutateEvents();
      showSuccess('Draft work package created.');
    } catch (err: any) {
      showError(err?.message || 'Failed to create draft work package.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendWorkpackage = async (eventId: string) => {
    setResendingEventId(eventId); setConfirmResendId(null);
    try {
      await authFetch('/api/mx-events/send-workpackage', { method: 'POST', body: JSON.stringify({ eventId, resend: true }) });
      mutateEvents();
    } catch (err) { console.error(err); showError("Failed to resend."); }
    setResendingEventId(null);
  };

  const submitMxItem = async (e: React.FormEvent) => {
    e.preventDefault(); setIsSubmitting(true);
    // Wrap in try/catch/finally — a bare throw after setIsSubmitting(true)
    // would leave the submit button frozen in "Saving…" forever.
    try {
      const payload: Record<string, any> = { aircraft_id: aircraft!.id, item_name: mxName, tracking_type: mxTrackingType, is_required: mxIsRequired, automate_scheduling: automateScheduling };

      const wantTime = mxTrackingType === 'time' || mxTrackingType === 'both';
      const wantDate = mxTrackingType === 'date' || mxTrackingType === 'both';

      if (wantTime) {
        payload.last_completed_time = parseFloat(mxLastTime) || 0;
        payload.time_interval = mxIntervalTime ? parseFloat(mxIntervalTime) : null;
        payload.due_time = mxDueTime ? parseFloat(mxDueTime) : (parseFloat(mxLastTime) + parseFloat(mxIntervalTime || '0'));
      } else {
        payload.last_completed_time = null; payload.time_interval = null; payload.due_time = null;
      }

      if (wantDate) {
        payload.last_completed_date = mxLastDate || null;
        payload.date_interval_days = mxIntervalDays ? parseInt(mxIntervalDays) : null;
        payload.due_date = mxDueDate || (mxLastDate && mxIntervalDays ? new Date(new Date(mxLastDate).getTime() + parseInt(mxIntervalDays) * 86400000).toISOString().split('T')[0] : null);
      } else {
        payload.last_completed_date = null; payload.date_interval_days = null; payload.due_date = null;
      }
      if (editingId) {
        const res = await authFetch('/api/maintenance-items', { method: 'PUT', body: JSON.stringify({ itemId: editingId, aircraftId: aircraft!.id, itemData: payload }) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed to update maintenance item'); }
      } else {
        const res = await authFetch('/api/maintenance-items', { method: 'POST', body: JSON.stringify({ aircraftId: aircraft!.id, itemData: payload }) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed to create maintenance item'); }
      }
      await mutate(); onGroundedStatusChange(); setShowMxModal(false);
      showSuccess(editingId ? 'Maintenance item updated.' : 'Maintenance item added.');
    } catch (err: any) {
      showError(err?.message || 'Failed to save maintenance item.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteMxItem = async (id: string) => {
    const ok = await confirm({
      title: "Delete Maintenance Item?",
      message: "This maintenance item will be permanently removed from tracking.",
      confirmText: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      const res = await authFetch('/api/maintenance-items', { method: 'DELETE', body: JSON.stringify({ itemId: id, aircraftId: aircraft!.id }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed to delete maintenance item'); }
      await mutate(); onGroundedStatusChange();
      showSuccess('Maintenance item deleted.');
    } catch (err: any) {
      showError(err?.message || 'Failed to delete maintenance item.');
    }
  };

  if (!aircraft) return null;

  const statusLabel = (s: string) => ({ draft: 'Draft — Review & Send', scheduling: 'Scheduling', confirmed: 'Confirmed', in_progress: 'In Progress', ready_for_pickup: 'Ready for Pickup', cancelled: 'Cancelled' }[s] || s);
  const statusColor = (s: string) => ({ draft: 'bg-[#F08B46]', scheduling: 'bg-gray-500', confirmed: 'bg-[#3AB0FF]', in_progress: 'bg-[#56B94A]', ready_for_pickup: 'bg-[#56B94A]', cancelled: 'bg-[#CE3732]' }[s] || 'bg-gray-400');

  /** Format interval for display in needs-setup items */
  const formatItemInterval = (item: any): string => {
    if (item.tracking_type === 'time' && item.time_interval) {
      return `Every ${item.time_interval.toLocaleString()} hrs`;
    }
    if (item.tracking_type === 'date' && item.date_interval_days) {
      const days = item.date_interval_days;
      if (days >= 365) {
        const yrs = Math.round(days / 365);
        return `Every ${yrs} year${yrs > 1 ? 's' : ''}`;
      }
      return `Every ${days} days`;
    }
    return '';
  };

  return (
    <>
      {/* ─── MX / SQUAWKS / SERVICE / ADS SELECTOR ─── */}
      <SectionSelector
        items={MX_ADS_SELECTOR_ITEMS}
        selectedKey={subTab}
        onSelect={(key) => {
          // Maintenance / squawks / service are local subtabs; ADs is
          // a separate app tab so we hand off to AppShell via event.
          if (key === 'maintenance' || key === 'squawks' || key === 'service') {
            setSubTab(key);
          } else {
            emitMxAdsNavigate(key);
          }
        }}
        compact
      />

      {/* ─── MAINTENANCE SUB-VIEW ─── */}
      {subTab === 'maintenance' && (
        <>
          {canEditMx && (
            <div className="mb-2 space-y-2">
              <div className="flex gap-2">
                <div className="flex-1"><PrimaryButton onClick={() => openMxForm()}><Plus size={18} /> Track New Item</PrimaryButton></div>
                <div className="flex-1">
                  <button onClick={() => setShowServiceModal(true)} className="w-full bg-[#F08B46] text-white font-oswald tracking-widest uppercase py-3 px-4 rounded hover:bg-opacity-90 active:scale-95 transition-all duration-150 ease-out flex justify-center items-center gap-2 text-sm">
                    <Calendar size={18} /> Schedule Service
                  </button>
                </div>
              </div>
              <button 
                onClick={() => setShowTemplateModal(true)} 
                className="w-full border-2 border-dashed border-[#F08B46] text-[#F08B46] font-oswald font-bold uppercase tracking-widest py-2.5 rounded hover:bg-orange-50 active:scale-95 transition-all text-xs flex justify-center items-center gap-2"
              >
                <Layers size={16} /> Start from Template
              </button>
            </div>
          )}

          <ServiceEventModal aircraft={aircraft} show={showServiceModal} onClose={() => { setShowServiceModal(false); mutateEvents(); }} onRefresh={() => { mutate(); mutateEvents(); }} canManageService={canEditMx} />
          <MxGuideModal show={showGuideModal} onClose={() => setShowGuideModal(false)} />
          <MxTemplatePickerModal aircraft={aircraft} show={showTemplateModal} onClose={() => setShowTemplateModal(false)} onRefresh={() => { mutate(); onGroundedStatusChange(); }} />

          {canEditMx && activeEvents.length > 0 && (
            <div className="mb-4 space-y-2">
              {activeEvents.map(ev => (
                <div key={ev.id} className={`bg-white shadow-lg rounded-sm p-4 border-t-4 ${ev.status === 'draft' ? 'border-[#F08B46]' : ev.status === 'confirmed' ? 'border-[#3AB0FF]' : ev.status === 'in_progress' || ev.status === 'ready_for_pickup' ? 'border-[#56B94A]' : 'border-gray-400'}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white ${statusColor(ev.status)}`}>{statusLabel(ev.status)}</span>
                      <p className="font-oswald font-bold text-navy text-sm mt-2">{ev.status === 'draft' ? 'Work Package Ready for Review' : ev.confirmed_date ? `Service: ${ev.confirmed_date}` : ev.proposed_date ? `Proposed: ${ev.proposed_date} (by ${ev.proposed_by})` : 'Awaiting Date'}</p>
                      {ev.estimated_completion && <p className="text-[10px] text-gray-500 mt-1">Est. completion: {ev.estimated_completion}</p>}
                      <p className="text-[10px] text-gray-400 mt-1">MX Contact: {ev.mx_contact_name || 'N/A'}</p>
                    </div>
                    <div className="flex flex-col gap-2 items-end shrink-0 ml-3">
                      <button onClick={() => setShowServiceModal(true)} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] bg-blue-50 border border-blue-200 px-2.5 py-1.5 rounded transition-colors active:scale-95">View <ChevronRight size={12} /></button>
                      {ev.status !== 'draft' && <button onClick={() => setConfirmResendId(ev.id)} disabled={resendingEventId === ev.id} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#F08B46] bg-orange-50 border border-orange-200 px-2.5 py-1.5 rounded transition-colors active:scale-95 disabled:opacity-50"><Send size={10} /> {resendingEventId === ev.id ? '...' : 'Resend'}</button>}
                      {ev.access_token && ev.status !== 'draft' && <a href={`/service/${ev.access_token}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy bg-gray-50 border border-gray-200 px-2.5 py-1.5 rounded transition-colors active:scale-95"><ExternalLink size={10} /> Portal</a>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ─── NEEDS SETUP SECTION ─── */}
          {needsSetupItems.length > 0 && (
            <div className="bg-[#FFF7ED] shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#F08B46] mb-4">
              <div className="flex justify-between items-end mb-4">
                <div>
                  <h2 className="font-oswald text-xl font-bold uppercase text-navy m-0 leading-none flex items-center gap-2">
                    <Settings size={18} className="text-[#F08B46]" /> Needs Setup
                  </h2>
                  <p className="text-[10px] text-gray-500 mt-1">Enter last-completed data from your logbook to activate tracking</p>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest bg-[#F08B46] text-white px-2 py-1 rounded">{needsSetupItems.length} item{needsSetupItems.length > 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-2">
                {needsSetupItems.map(item => (
                  <div key={item.id} className="p-3 border border-orange-200 bg-white rounded flex justify-between items-center">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-oswald font-bold uppercase text-sm text-navy truncate">{item.item_name}</h4>
                        {item.is_required && <span className="text-[7px] font-bold uppercase tracking-widest px-1 py-0.5 rounded bg-red-100 text-[#CE3732] shrink-0">Required</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-orange-100 text-[#F08B46]">Setup Required</span>
                        {formatItemInterval(item) && (
                          <span className="text-[10px] text-gray-400">{formatItemInterval(item)}</span>
                        )}
                      </div>
                    </div>
                    {canEditMx && (
                      <div className="flex gap-3 pl-3 shrink-0">
                        <button onClick={() => openMxForm(item)} className="text-[#F08B46] hover:text-orange-600 transition-colors active:scale-95" title="Configure"><Edit2 size={16}/></button>
                        <button onClick={() => deleteMxItem(item.id)} className="text-gray-400 hover:text-[#CE3732] transition-colors active:scale-95"><Trash2 size={16}/></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── ACTIVE TRACKING ITEMS ─── */}
          <div className={`bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 mb-6 ${isGroundedLocally ? 'border-[#CE3732]' : 'border-[#F08B46]'}`}>
            <div className="flex justify-between items-end mb-6">
              <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Maintenance</h2>
              <div className="flex items-center gap-3">
                <button onClick={exportMxHistory} disabled={isExportingMx} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] hover:opacity-80 transition-colors active:scale-95 disabled:opacity-50"><Download size={14} /> {isExportingMx ? 'Exporting...' : 'History'}</button>
                <button onClick={() => setShowGuideModal(true)} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#F08B46] hover:opacity-80 transition-colors active:scale-95"><HelpCircle size={14} /> Guide</button>
              </div>
            </div>
            <div className="space-y-3">
              {activeItems.length === 0 ? (
                <p className="text-center text-sm text-gray-400 italic py-4">
                  {needsSetupItems.length > 0 ? 'All items need setup — configure them above to start tracking.' : 'No maintenance items tracked.'}
                </p>
              ) : activeItems.map(item => {
                const processed = processMxItem(item, currentEngineTime, aircraft.burnRate, aircraft.burnRateLow, aircraft.burnRateHigh);
                const dueTextColor = getMxTextColor(processed, sysSettings);
                const containerClass = processed.isExpired ? (item.is_required ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200') : 'bg-white border-gray-200';
                return (
                  <div key={item.id} className={`p-4 border rounded flex justify-between items-center ${containerClass}`}>
                    <div className="w-full">
                      <div className="flex items-center gap-2">
                        <h4 className={`font-oswald font-bold uppercase text-sm ${processed.isExpired ? 'text-[#CE3732]' : 'text-navy'}`}>{item.item_name}</h4>
                        {!item.is_required && <span className={`text-[8px] border px-1 rounded uppercase tracking-widest opacity-70 ${processed.isExpired ? 'border-[#CE3732] text-[#CE3732]' : 'border-navy text-navy'}`}>Optional</span>}
                      </div>
                      <p className={`text-xs mt-1 font-roboto font-bold ${dueTextColor}`}>{processed.dueText}</p>
                      {item.primary_heads_up_sent && !item.mx_schedule_sent && (
                        <div className="mt-3 bg-red-50 border border-red-200 p-3 rounded w-full max-w-sm">
                          <p className="text-[10px] text-[#CE3732] font-bold uppercase mb-2 leading-tight">Action Required: Projected MX Due<br/>(System Confidence: {aircraft.confidenceScore || 0}%)</p>
                          <button onClick={() => handleManualMxTrigger(item)} disabled={isSubmitting} className="w-full bg-[#CE3732] text-white text-[10px] font-bold uppercase px-3 py-2 rounded shadow active:scale-95 transition-transform disabled:opacity-50">{isSubmitting ? "Processing..." : "Approve & Email Mechanic"}</button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 pl-4 shrink-0">
                      {canEditMx && (
                        <>
                          <button onClick={() => openMxForm(item)} className="text-gray-400 hover:text-[#F08B46] transition-colors active:scale-95"><Edit2 size={16}/></button>
                          <button onClick={() => deleteMxItem(item.id)} className="text-gray-400 hover:text-[#CE3732] transition-colors active:scale-95"><Trash2 size={16}/></button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─── MX ITEM FORM MODAL ─── */}
          {showMxModal && canEditMx && (
            <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }}>
            <div className="flex min-h-full items-center justify-center p-3">
              <div className="bg-white rounded shadow-2xl w-full max-w-md p-5 border-t-4 border-[#F08B46] animate-slide-up">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="font-oswald text-2xl font-bold uppercase text-navy">{editingId ? 'Edit MX Item' : 'Track New Item'}</h2>
                  <button onClick={() => setShowMxModal(false)} className="text-gray-400 hover:text-[#CE3732] transition-colors"><X size={24}/></button>
                </div>
                <form onSubmit={submitMxItem} className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Item Name *</label><input type="text" required value={mxName} onChange={e=>setMxName(e.target.value)} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" placeholder="e.g. Annual Inspection" /></div>
                    <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Required?</label><select value={mxIsRequired ? "yes" : "no"} onChange={e=>setMxIsRequired(e.target.value === "yes")} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none"><option value="yes">Yes</option><option value="no">Optional</option></select></div>
                  </div>
                  <div className="pt-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy block mb-2">Tracking Method</label>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      <label className="flex items-center gap-2 text-sm font-bold text-navy cursor-pointer"><input type="radio" checked={mxTrackingType==='time'} onChange={()=>setMxTrackingType('time')} /> Track by Time</label>
                      <label className="flex items-center gap-2 text-sm font-bold text-navy cursor-pointer"><input type="radio" checked={mxTrackingType==='date'} onChange={()=>setMxTrackingType('date')} /> Track by Date</label>
                      <label className="flex items-center gap-2 text-sm font-bold text-navy cursor-pointer"><input type="radio" checked={mxTrackingType==='both'} onChange={()=>setMxTrackingType('both')} /> Both (whichever first)</label>
                    </div>
                    {mxTrackingType === 'both' && (
                      <p className="text-[10px] text-gray-500 font-roboto mt-2 leading-tight">For items like Annual (12 months OR 100 hrs) — the item comes due whenever either interval expires.</p>
                    )}
                  </div>
                  {(mxTrackingType === 'time' || mxTrackingType === 'both') && (
                    <div className="bg-gray-50 p-3 md:p-4 rounded border border-gray-200 space-y-3">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Time Interval</p>
                      <div className="w-full min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Last Completed ({isTurbine ? 'FTT' : 'Tach'}) *</label><input type="number" step="0.1" required value={mxLastTime} onChange={e=>setMxLastTime(e.target.value)} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
                      <div className="grid grid-cols-2 gap-3 w-full min-w-0">
                        <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Interval (Hrs)</label><input type="number" step="0.1" value={mxIntervalTime} onChange={e=>setMxIntervalTime(e.target.value)} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
                        <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">OR Exact Due</label><input type="number" step="0.1" required={!mxIntervalTime} value={mxDueTime} onChange={e=>setMxDueTime(e.target.value)} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
                      </div>
                    </div>
                  )}
                  {(mxTrackingType === 'date' || mxTrackingType === 'both') && (
                    <div className="bg-gray-50 p-3 md:p-4 rounded border border-gray-200 space-y-3">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Date Interval</p>
                      <div className="w-full min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Last Completed Date *</label><input type="date" required value={mxLastDate} onChange={e=>setMxLastDate(e.target.value)} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
                      <div className="grid grid-cols-2 gap-3 w-full min-w-0">
                        <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Interval (Days)</label><input type="number" value={mxIntervalDays} onChange={e=>setMxIntervalDays(e.target.value)} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
                        <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">OR Exact Due</label><input type="date" required={!mxIntervalDays} value={mxDueDate} onChange={e=>setMxDueDate(e.target.value)} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" /></div>
                      </div>
                    </div>
                  )}
                  {!editingId && (
                    <div className="pt-2 pb-2">
                      <label className="flex items-start gap-2 text-xs font-bold text-navy cursor-pointer">
                        <input type="checkbox" checked={automateScheduling} onChange={e=>setAutomateScheduling(e.target.checked)} className="mt-0.5 w-4 h-4 text-[#F08B46] border-gray-300 rounded focus:ring-[#F08B46] cursor-pointer shrink-0" />
                        <span className="flex flex-col"><span>Automate Scheduling</span><span className="text-[10px] text-gray-500 font-normal mt-1 leading-tight">When this item approaches its due threshold, the system will automatically create a draft work package and notify you to review and send it to your mechanic.</span></span>
                      </label>
                    </div>
                  )}
                  <div className="pt-4"><PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Maintenance Item"}</PrimaryButton></div>
                </form>
              </div>
            </div>
            </div>
          )}

          {confirmResendId && (
            <div className="fixed inset-0 bg-black/60 z-[10001] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setConfirmResendId(null)}>
            <div className="flex min-h-full items-center justify-center p-4">
              <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-[#F08B46] animate-slide-up" onClick={e => e.stopPropagation()}>
                <h3 className="font-oswald text-xl font-bold uppercase text-navy mb-3">Resend Work Package?</h3>
                <p className="text-sm text-gray-600 mb-6">Are you sure you want to resend the work order to <strong>{activeEvents.find(e => e.id === confirmResendId)?.mx_contact_name || 'the primary maintenance contact'}</strong>?</p>
                <div className="flex gap-3">
                  <button onClick={() => setConfirmResendId(null)} className="flex-1 border border-gray-300 text-gray-600 font-oswald font-bold uppercase tracking-widest py-3 rounded text-xs active:scale-95">Cancel</button>
                  <button onClick={() => handleResendWorkpackage(confirmResendId)} disabled={resendingEventId === confirmResendId} className="flex-1 bg-[#F08B46] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded text-xs active:scale-95 disabled:opacity-50">{resendingEventId === confirmResendId ? 'Sending...' : 'Resend'}</button>
                </div>
              </div>
            </div>
            </div>
          )}
        </>
      )}

      {/* ─── SQUAWKS SUB-VIEW ─── */}
      {subTab === 'squawks' && (
        <SquawksTab aircraft={aircraft} session={session} role={role} aircraftRole={aircraftRole} userInitials={userInitials} onGroundedStatusChange={onGroundedStatusChange} />
      )}

      {/* ─── SERVICE SUB-VIEW ─── */}
      {subTab === 'service' && (
        <ServiceEventsList
          aircraft={aircraft}
          activeEvents={activeEvents}
          canEditMx={canEditMx}
          onOpenModal={() => setShowServiceModal(true)}
        />
      )}
    </>
  );
}

/**
 * Service-events listing — summary cards for every work package the
 * aircraft has. Tapping a card opens ServiceEventModal (which handles
 * the detailed view + mechanic portal link). Admins see a "Schedule
 * Service" CTA; non-admins get read-only.
 *
 * We split into "active" (work in flight) and "past" (complete /
 * cancelled) because owners glance here to see what's queued far more
 * often than they dig into history.
 */
function ServiceEventsList({
  aircraft,
  activeEvents,
  canEditMx,
  onOpenModal,
}: {
  aircraft: AircraftWithMetrics | null;
  activeEvents: any[];
  canEditMx: boolean;
  onOpenModal: () => void;
}) {
  const { data: pastEvents = [] } = useSWR(
    aircraft ? ['mx-events-past', aircraft.id] : null,
    async () => {
      const { data } = await supabase
        .from('aft_maintenance_events')
        .select('*')
        .eq('aircraft_id', aircraft!.id)
        .is('deleted_at', null)
        .in('status', ['complete', 'cancelled'])
        .order('created_at', { ascending: false })
        .limit(20);
      return data || [];
    },
  );

  const renderCard = (ev: any) => {
    const statusColor = ev.status === 'draft' ? '#F08B46'
      : ev.status === 'confirmed' ? '#3AB0FF'
      : ev.status === 'in_progress' || ev.status === 'ready_for_pickup' ? '#56B94A'
      : ev.status === 'complete' ? '#56B94A'
      : ev.status === 'cancelled' ? '#CE3732'
      : '#9CA3AF';
    const dateLabel = ev.confirmed_date
      ? `Service: ${ev.confirmed_date}`
      : ev.proposed_date
      ? `Proposed: ${ev.proposed_date}`
      : 'Awaiting date';
    return (
      <div
        key={ev.id}
        className="bg-white shadow rounded-sm p-4 border-l-4 flex items-start justify-between gap-3"
        style={{ borderLeftColor: statusColor }}
      >
        <div className="min-w-0">
          <span
            className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white inline-block"
            style={{ backgroundColor: statusColor }}
          >
            {ev.status.replace(/_/g, ' ')}
          </span>
          <p className="font-oswald font-bold text-navy text-sm mt-2 truncate">{dateLabel}</p>
          {ev.estimated_completion && (
            <p className="text-[10px] text-gray-500 mt-0.5">Est. completion: {ev.estimated_completion}</p>
          )}
          <p className="text-[10px] text-gray-400 mt-0.5 truncate">
            MX Contact: {ev.mx_contact_name || 'N/A'}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            onClick={onOpenModal}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] bg-blue-50 border border-blue-200 px-2.5 py-1.5 rounded active:scale-95"
          >
            View <ChevronRight size={12} />
          </button>
          {ev.access_token && ev.status !== 'draft' && (
            <a
              href={`/service/${ev.access_token}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy bg-gray-50 border border-gray-200 px-2.5 py-1.5 rounded active:scale-95"
            >
              <ExternalLink size={10} /> Portal
            </a>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {canEditMx && (
        <button
          onClick={onOpenModal}
          className="w-full bg-[#F08B46] text-white font-oswald tracking-widest uppercase py-3 px-4 rounded hover:bg-opacity-90 active:scale-95 transition-all flex justify-center items-center gap-2 text-sm"
        >
          <Calendar size={18} /> Schedule Service
        </button>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-oswald text-sm font-bold uppercase tracking-widest text-navy">
            Active work
          </h3>
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
            {activeEvents.length}
          </span>
        </div>
        {activeEvents.length === 0 ? (
          <p className="text-xs text-gray-500 italic bg-gray-50 rounded p-3 border border-gray-200">
            No work packages in flight. {canEditMx ? 'Tap Schedule Service to bundle items into a trip to the shop.' : 'Your aircraft admin can schedule service when needed.'}
          </p>
        ) : (
          <div className="space-y-2">{activeEvents.map(renderCard)}</div>
        )}
      </div>

      {pastEvents.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-oswald text-sm font-bold uppercase tracking-widest text-gray-500">
              Past
            </h3>
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              {pastEvents.length}
            </span>
          </div>
          <div className="space-y-2 opacity-80">{pastEvents.map(renderCard)}</div>
        </div>
      )}
    </div>
  );
}

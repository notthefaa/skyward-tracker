import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { supabase } from "@/lib/supabase";
import { authFetch, UPLOAD_TIMEOUT_MS } from "@/lib/authFetch";
import { processMxItem, getMxTextColor, isMxExpired } from "@/lib/math";
import { INPUT_WHITE_BG } from "@/lib/styles";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics, SystemSettings, AircraftRole, MxSubTab } from "@/lib/types";
import useSWR from "swr";
import { Wrench, Trash2, Plus, X, Edit2, Calendar, Send, ExternalLink, ChevronRight, HelpCircle, AlertTriangle, Download, Layers, Settings, ClipboardList, ShieldAlert, Camera, Loader2 } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import SquawksTab from "@/components/tabs/SquawksTab";

// Click-triggered modals — keep them out of the MX tab's eager chunk.
// MxTemplatePickerModal alone pulls 25 KB of MX_TEMPLATES data.
const ServiceEventModal = dynamic(() => import("@/components/modals/ServiceEventModal"), { ssr: false });
const MxGuideModal = dynamic(() => import("@/components/modals/MxGuideModal"), { ssr: false });
const MxTemplatePickerModal = dynamic(() => import("@/components/modals/MxTemplatePickerModal"), { ssr: false });
import SectionSelector from "@/components/shell/SectionSelector";
import { MX_ADS_SELECTOR_ITEMS, emitMxAdsNavigate } from "@/components/shell/mxAdsNav";
import { ModalPortal } from "@/components/ModalPortal";

/** Shared labels so the Maintenance-tab banner and the Service-subtab
 *  cards describe the same underlying service event with the same
 *  vocabulary. Previously the banner said "Draft — Review & Send"
 *  while the Service card showed raw "draft" — same row, two
 *  different reads. */
const mxEventStatusLabel = (s: string) =>
  ({ draft: 'Draft — Review & Send', scheduling: 'Scheduling', confirmed: 'Confirmed', in_progress: 'In Progress', ready_for_pickup: 'Ready for Pickup', complete: 'Complete', cancelled: 'Cancelled' }[s] || s);

const mxEventStatusBgClass = (s: string) =>
  ({ draft: 'bg-mxOrange', scheduling: 'bg-gray-500', confirmed: 'bg-info', in_progress: 'bg-[#56B94A]', ready_for_pickup: 'bg-[#56B94A]', complete: 'bg-[#56B94A]', cancelled: 'bg-danger' }[s] || 'bg-gray-400');

/** One-line summary to pair with the status chip. Drafts show the
 *  "Work Package Ready for Review" prompt instead of a date; other
 *  statuses show the date/proposal they carry. */
const mxEventSummary = (ev: any) => {
  if (ev.status === 'draft') return 'Work Package Ready for Review';
  if (ev.confirmed_date) return `Service: ${ev.confirmed_date}`;
  if (ev.proposed_date) return `Proposed: ${ev.proposed_date}${ev.proposed_by ? ` (by ${ev.proposed_by})` : ''}`;
  return 'Awaiting date';
};

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
      const { data, error } = await supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraft!.id).is('deleted_at', null).order('due_date').order('due_time');
      if (error) throw error;
      return (data || []) as any[];
    }
  );

  const { data: activeEvents = [], mutate: mutateEvents } = useSWR(
    aircraft ? swrKeys.mxEvents(aircraft.id) : null,
    async () => {
      const { data, error } = await supabase.from('aft_maintenance_events').select('*').eq('aircraft_id', aircraft!.id).is('deleted_at', null).in('status', ['draft', 'scheduling', 'confirmed', 'in_progress', 'ready_for_pickup']).order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    }
  );

  const [showMxModal, setShowMxModal] = useState(false);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [preSelectMxItemId, setPreSelectMxItemId] = useState<string | null>(null);
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
  // Scan-from-logbook state for the "Track New Item" flow. Kept
  // separate from the MX-event completion scan so neither flow
  // steps on the other.
  const [isScanningNewItem, setIsScanningNewItem] = useState(false);
  const [scanPrefillHint, setScanPrefillHint] = useState<string | null>(null);
  const scanNewItemInputRef = useRef<HTMLInputElement | null>(null);
  // Multi-item scan pipeline: detectedItems holds every item Claude
  // pulled off the logbook page; pickerSelections is the checkbox
  // state over that list; editQueue is the ordered list of indices
  // the pilot committed to (after confirming the picker); queueCursor
  // tracks which one the form is currently showing.
  const [detectedItems, setDetectedItems] = useState<any[] | null>(null);
  const [pickerSelections, setPickerSelections] = useState<boolean[]>([]);
  const [editQueue, setEditQueue] = useState<number[]>([]);
  const [queueCursor, setQueueCursor] = useState(0);

  // Reset modal + editing state when the aircraft changes — otherwise
  // a partially-edited MX row from Aircraft A would land on Aircraft
  // B when the form submits.
  useEffect(() => {
    setShowMxModal(false);
    setShowServiceModal(false);
    setPreSelectMxItemId(null);
    setShowGuideModal(false);
    setShowTemplateModal(false);
    setEditingId(null);
    setConfirmResendId(null);
    setResendingEventId(null);
    setMxName(''); setMxLastTime(''); setMxIntervalTime(''); setMxDueTime('');
    setMxLastDate(''); setMxIntervalDays(''); setMxDueDate('');
    setAutomateScheduling(false);
    setIsScanningNewItem(false);
    setScanPrefillHint(null);
    setDetectedItems(null);
    setPickerSelections([]);
    setEditQueue([]);
    setQueueCursor(0);
  }, [aircraft?.id]);

  useModalScrollLock(showMxModal || !!confirmResendId);

  // ─── Separate items into active tracking vs needs-setup ───
  // 'both'-tracking items need BOTH a due_time AND a due_date to be
  // fully tracked. Pre-fix the partition treated any 'both' item as
  // active regardless of which sides were populated, so an item with
  // both fields null silently rendered "Not yet configured" on the
  // active list (and processMxItem's fall-through covered the crash
  // path, but the user-visible state was still wrong).
  const needsSetupItems = mxItems.filter(item => {
    if (item.tracking_type === 'time') return item.due_time === null || item.due_time === undefined;
    if (item.tracking_type === 'date') return item.due_date === null || item.due_date === undefined;
    if (item.tracking_type === 'both') {
      const noTime = item.due_time === null || item.due_time === undefined;
      const noDate = item.due_date === null || item.due_date === undefined;
      return noTime || noDate;
    }
    return false;
  });

  const activeItems = mxItems.filter(item => {
    if (item.tracking_type === 'time') return item.due_time !== null && item.due_time !== undefined;
    if (item.tracking_type === 'date') return item.due_date !== null && item.due_date !== undefined;
    if (item.tracking_type === 'both') {
      return item.due_time !== null && item.due_time !== undefined
        && item.due_date !== null && item.due_date !== undefined;
    }
    return false;
  });

  const exportMxHistory = async () => {
    if (!aircraft) return;
    setIsExportingMx(true);
    try {
      const { data: completedEvents, error: eventsErr } = await supabase
        .from('aft_maintenance_events').select('*')
        .eq('aircraft_id', aircraft.id).eq('status', 'complete').is('deleted_at', null)
        .order('completed_at', { ascending: false });
      // Without throw the catch below would never fire and the user
      // would see the misleading "No completed events" toast.
      if (eventsErr) throw eventsErr;

      if (!completedEvents || completedEvents.length === 0) {
        showWarning("No completed service events to export.");
        setIsExportingMx(false);
        return;
      }

      const eventIds = completedEvents.map((e: any) => e.id);
      const { data: allLineItems, error: linesErr } = await supabase
        .from('aft_event_line_items').select('*').in('event_id', eventIds);
      if (linesErr) throw linesErr;

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
    setScanPrefillHint(null);
    setDetectedItems(null);
    setPickerSelections([]);
    setEditQueue([]);
    setQueueCursor(0);
    setShowMxModal(true);
  };

  // Everything below is the multi-item scan pipeline.

  const resetScanAndQueue = () => {
    setDetectedItems(null);
    setPickerSelections([]);
    setEditQueue([]);
    setQueueCursor(0);
    setScanPrefillHint(null);
  };

  // Fully overwrite the form from a detected item. Used when the
  // pilot has committed to the queue — each iteration is a fresh
  // item, so preserving prior values would bleed one item's fields
  // into the next.
  const prefillFormFromItem = (item: any) => {
    setMxName(item?.item_name || '');
    const tt = item?.tracking_type;
    setMxTrackingType(tt === 'time' || tt === 'date' || tt === 'both' ? tt : 'date');
    setMxIsRequired(typeof item?.is_required === 'boolean' ? item.is_required : true);
    setMxLastTime(item?.last_completed_time != null ? String(item.last_completed_time) : '');
    setMxLastDate(item?.last_completed_date || '');
    setMxIntervalTime(item?.time_interval != null ? String(item.time_interval) : '');
    setMxIntervalDays(item?.date_interval_days != null ? String(item.date_interval_days) : '');
    setMxDueTime('');
    setMxDueDate('');
    setAutomateScheduling(false);
    setScanPrefillHint(
      item?.work_description
        ? `Prefilled from scan — ${item.work_description}`
        : 'Prefilled from scan — review every field before saving.'
    );
  };

  // Scan a logbook entry. One entry can describe multiple items, so
  // we ask for an array and branch:
  //   0 items → warn, leave the form alone
  //   1 item  → prefill the form in place, respecting any values the
  //             pilot has already typed (classifications overwrite)
  //   N items → open the picker so the pilot chooses which ones to
  //             track before we walk through them one at a time
  const handleScanForNewItem = async (file: File) => {
    if (!aircraft) return;
    setIsScanningNewItem(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('aircraftId', aircraft.id);
      const res = await authFetch('/api/maintenance-items/scan-logentry', { method: 'POST', body: formData, timeoutMs: UPLOAD_TIMEOUT_MS });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Scan failed');
      }
      const { items, warning } = await res.json();
      if (warning) { showWarning(warning); return; }

      const detected: any[] = Array.isArray(items) ? items : [];
      if (detected.length === 0) {
        showWarning("We couldn't read a trackable item from that page. Try a sharper photo or fill in the form manually.");
        return;
      }
      if (detected.length === 1) {
        // Match the queue path's behaviour: scan is authoritative, the
        // user reviews every field before saving. Pre-fix, this branch
        // preserved user input on most fields but always overwrote
        // tracking_type + is_required — same flow, two prefill rules.
        prefillFormFromItem(detected[0]);
        showSuccess('Logbook entry scanned — review the fields before saving.');
      } else {
        setDetectedItems(detected);
        setPickerSelections(detected.map(() => true));
        setEditQueue([]);
        setQueueCursor(0);
        showSuccess(`Found ${detected.length} items — pick which ones to track.`);
      }
    } catch (err: any) {
      showError("Scan didn't work: " + (err?.message || 'unknown error'));
    } finally {
      setIsScanningNewItem(false);
    }
  };

  // Commit picker selection → begin the queue walk-through.
  const startEditQueue = () => {
    if (!detectedItems) return;
    const queue = pickerSelections
      .map((v, i) => (v ? i : -1))
      .filter(i => i >= 0);
    if (queue.length === 0) {
      showWarning("Select at least one item to track.");
      return;
    }
    setEditQueue(queue);
    setQueueCursor(0);
    prefillFormFromItem(detectedItems[queue[0]]);
  };

  // Advance the queue without saving the current item. Closes the
  // modal if this was the last one.
  const skipCurrentQueueItem = () => {
    const next = queueCursor + 1;
    if (!detectedItems || next >= editQueue.length) {
      setShowMxModal(false);
      resetScanAndQueue();
      return;
    }
    setQueueCursor(next);
    prefillFormFromItem(detectedItems[editQueue[next]]);
  };

  // One-liner interval summary for the picker row so the pilot can
  // tell at a glance what the model inferred before deciding to
  // include it.
  const describeDetectedItemInterval = (item: any): string => {
    const parts: string[] = [];
    if ((item?.tracking_type === 'time' || item?.tracking_type === 'both') && item?.time_interval) {
      parts.push(`Every ${item.time_interval} hrs`);
    }
    if ((item?.tracking_type === 'date' || item?.tracking_type === 'both') && item?.date_interval_days) {
      const d = item.date_interval_days;
      parts.push(d >= 365 ? `Every ${Math.round(d / 365)} year${Math.round(d / 365) > 1 ? 's' : ''}` : `Every ${d} days`);
    }
    if (item?.is_required) parts.push('Required');
    return parts.join(' · ') || 'Interval not detected — you can set it in the next step.';
  };

  const handleManualMxTrigger = (item: any) => {
    // Open the service-event review flow with this item pre-selected.
    // The pilot then confirms items + date + mechanic email before
    // anything is sent — no silent one-click email out the door.
    setPreSelectMxItemId(item.id);
    setShowServiceModal(true);
  };

  const handleResendWorkpackage = async (eventId: string) => {
    setResendingEventId(eventId); setConfirmResendId(null);
    try {
      await authFetch('/api/mx-events/send-workpackage', { method: 'POST', body: JSON.stringify({ eventId, resend: true }), timeoutMs: UPLOAD_TIMEOUT_MS });
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
        const lastTimeNum = parseFloat(mxLastTime) || 0;
        const intervalNum = mxIntervalTime ? parseFloat(mxIntervalTime) : null;
        const dueTimeNum  = mxDueTime ? parseFloat(mxDueTime) : null;
        // The form's `required={!mxIntervalTime}` lets "0" through —
        // "0" is a truthy string. Without an explicit due reading,
        // interval=0 (or a stripped negative) collapses to
        // due_time = last_completed_time, so the item lands as
        // instantly overdue with zero feedback. Reject here.
        if (dueTimeNum === null && (intervalNum === null || !(intervalNum > 0))) {
          throw new Error('Enter a positive interval (Hrs) or an exact due reading.');
        }
        payload.last_completed_time = lastTimeNum;
        payload.time_interval       = intervalNum;
        payload.due_time            = dueTimeNum != null ? dueTimeNum : lastTimeNum + (intervalNum || 0);
      } else {
        payload.last_completed_time = null; payload.time_interval = null; payload.due_time = null;
      }

      if (wantDate) {
        const intervalDaysNum = mxIntervalDays ? parseInt(mxIntervalDays, 10) : null;
        if (!mxDueDate && (intervalDaysNum === null || !(intervalDaysNum > 0))) {
          throw new Error('Enter a positive interval (Days) or an exact due date.');
        }
        payload.last_completed_date = mxLastDate || null;
        payload.date_interval_days  = intervalDaysNum;
        payload.due_date            = mxDueDate || (mxLastDate && intervalDaysNum && intervalDaysNum > 0
          ? new Date(new Date(mxLastDate).getTime() + intervalDaysNum * 86400000).toISOString().split('T')[0]
          : null);
      } else {
        payload.last_completed_date = null; payload.date_interval_days = null; payload.due_date = null;
      }
      if (editingId) {
        const res = await authFetch('/api/maintenance-items', { method: 'PUT', body: JSON.stringify({ itemId: editingId, aircraftId: aircraft!.id, itemData: payload }) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Couldn't update the maintenance item"); }
      } else {
        const res = await authFetch('/api/maintenance-items', { method: 'POST', body: JSON.stringify({ aircraftId: aircraft!.id, itemData: payload }) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Couldn't create the maintenance item"); }
      }
      await mutate(); onGroundedStatusChange();
      if (!editingId && editQueue.length > 0) {
        const next = queueCursor + 1;
        if (next < editQueue.length) {
          if (detectedItems) prefillFormFromItem(detectedItems[editQueue[next]]);
          setQueueCursor(next);
          showSuccess(`Saved (${queueCursor + 1} of ${editQueue.length}).`);
          return;
        }
        setShowMxModal(false);
        showSuccess(`${editQueue.length} item${editQueue.length > 1 ? 's' : ''} tracked.`);
        resetScanAndQueue();
      } else {
        setShowMxModal(false);
        showSuccess(editingId ? 'Maintenance item updated.' : 'Maintenance item added.');
      }
    } catch (err: any) {
      showError(err?.message || "Couldn't save the maintenance item.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteMxItem = async (id: string) => {
    const ok = await confirm({
      title: "Delete Maintenance Item?",
      message: "We'll stop tracking this item. History on completed work stays in your service-event records.",
      confirmText: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      const res = await authFetch('/api/maintenance-items', { method: 'DELETE', body: JSON.stringify({ itemId: id, aircraftId: aircraft!.id }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Couldn't delete the maintenance item"); }
      await mutate(); onGroundedStatusChange();
      showSuccess('Maintenance item deleted.');
    } catch (err: any) {
      showError(err?.message || "Couldn't delete the maintenance item.");
    }
  };

  if (!aircraft) return null;

  const statusLabel = mxEventStatusLabel;
  const statusColor = mxEventStatusBgClass;

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
    <div className="flex flex-col">
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
                  <button onClick={() => setShowServiceModal(true)} className="w-full bg-mxOrange text-white font-oswald tracking-widest uppercase py-3 px-4 rounded hover:bg-opacity-90 active:scale-95 transition-all duration-150 ease-out flex justify-center items-center gap-2 text-sm">
                    <Calendar size={18} /> Schedule Service
                  </button>
                </div>
              </div>
              <button 
                onClick={() => setShowTemplateModal(true)} 
                className="w-full border-2 border-dashed border-mxOrange text-mxOrange font-oswald font-bold uppercase tracking-widest py-2.5 rounded hover:bg-orange-50 active:scale-95 transition-all text-xs flex justify-center items-center gap-2"
              >
                <Layers size={16} /> Start from Template
              </button>
            </div>
          )}

          {showGuideModal && <MxGuideModal show onClose={() => setShowGuideModal(false)} />}
          {showTemplateModal && <MxTemplatePickerModal aircraft={aircraft} show onClose={() => setShowTemplateModal(false)} onRefresh={() => { mutate(); onGroundedStatusChange(); }} />}

          {canEditMx && activeEvents.length > 0 && (
            <div className="mb-4 space-y-2">
              {activeEvents.map(ev => (
                <div
                  key={ev.id}
                  onClick={() => setShowServiceModal(true)}
                  className={`bg-white shadow-lg rounded-sm p-4 border-t-4 cursor-pointer hover:shadow-xl active:scale-[0.99] transition-all ${ev.status === 'draft' ? 'border-mxOrange' : ev.status === 'confirmed' ? 'border-info' : ev.status === 'in_progress' || ev.status === 'ready_for_pickup' ? 'border-[#56B94A]' : 'border-gray-400'}`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white ${statusColor(ev.status)}`}>{statusLabel(ev.status)}</span>
                      <p className="font-oswald font-bold text-navy text-sm mt-2">{mxEventSummary(ev)}</p>
                      {ev.estimated_completion && <p className="text-[10px] text-gray-500 mt-1">Est. completion: {ev.estimated_completion}</p>}
                      <p className="text-[10px] text-gray-400 mt-1">MX Contact: {ev.mx_contact_name || 'N/A'}</p>
                    </div>
                    <div className="flex flex-col gap-2 items-end shrink-0 ml-3">
                      <button onClick={(e) => { e.stopPropagation(); setShowServiceModal(true); }} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-info bg-blue-50 border border-blue-200 px-2.5 py-1.5 rounded transition-colors active:scale-95">View <ChevronRight size={12} /></button>
                      {ev.status !== 'draft' && <button onClick={(e) => { e.stopPropagation(); setConfirmResendId(ev.id); }} disabled={resendingEventId === ev.id} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-mxOrange bg-orange-50 border border-orange-200 px-2.5 py-1.5 rounded transition-colors active:scale-95 disabled:opacity-50"><Send size={10} /> {resendingEventId === ev.id ? '...' : 'Resend'}</button>}
                      {ev.access_token && ev.status !== 'draft' && <a href={`/service/${ev.access_token}`} onClick={(e) => e.stopPropagation()} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy bg-gray-50 border border-gray-200 px-2.5 py-1.5 rounded transition-colors active:scale-95"><ExternalLink size={10} /> Portal</a>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ─── NEEDS SETUP SECTION ─── */}
          {needsSetupItems.length > 0 && (
            <div className="bg-[#FFF7ED] shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-mxOrange mb-4">
              <div className="flex justify-between items-end mb-4">
                <div>
                  <h2 className="font-oswald text-xl font-bold uppercase text-navy m-0 leading-none flex items-center gap-2">
                    <Settings size={18} className="text-mxOrange" /> Needs Setup
                  </h2>
                  <p className="text-[10px] text-gray-500 mt-1">Enter when this was last done (from your logbook) and we'll start tracking it.</p>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest bg-mxOrange text-white px-2 py-1 rounded">{needsSetupItems.length} item{needsSetupItems.length > 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-2">
                {needsSetupItems.map(item => (
                  <div
                    key={item.id}
                    onClick={() => canEditMx && openMxForm(item)}
                    className={`p-3 border border-orange-200 bg-white rounded flex justify-between items-center ${canEditMx ? 'cursor-pointer hover:bg-orange-50 active:scale-[0.99] transition-all' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-oswald font-bold uppercase text-sm text-navy truncate">{item.item_name}</h4>
                        {item.is_required && <span className="text-[7px] font-bold uppercase tracking-widest px-1 py-0.5 rounded bg-red-100 text-danger shrink-0">Required</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-orange-100 text-mxOrange">Setup Required</span>
                        {formatItemInterval(item) && (
                          <span className="text-[10px] text-gray-400">{formatItemInterval(item)}</span>
                        )}
                      </div>
                    </div>
                    {canEditMx && (
                      <div className="flex gap-3 pl-3 shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); openMxForm(item); }} className="text-mxOrange hover:text-orange-600 transition-colors active:scale-95" title="Configure"><Edit2 size={16}/></button>
                        <button onClick={(e) => { e.stopPropagation(); deleteMxItem(item.id); }} className="text-gray-400 hover:text-danger transition-colors active:scale-95"><Trash2 size={16}/></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── ACTIVE TRACKING ITEMS ─── */}
          {(() => {
            const processedActiveItems = activeItems.map(item => ({
              item,
              processed: processMxItem(item, currentEngineTime, aircraft.burnRate, aircraft.burnRateLow, aircraft.burnRateHigh),
            }));
            // Split into three buckets so a pilot scanning this tab can
            // tell at a glance what's actually blocking flight today
            // vs. what's just worth keeping an eye on. "Blocks flight"
            // mirrors isGroundedLocally (required + expired).
            const blocking = processedActiveItems.filter(({ item, processed }) => processed.isExpired && item.is_required);
            const watchlist = processedActiveItems.filter(({ item, processed }) => processed.isExpired && !item.is_required);
            const onTrack = processedActiveItems.filter(({ processed }) => !processed.isExpired);
            const renderRow = ({ item, processed }: { item: any; processed: any }) => {
              const dueTextColor = getMxTextColor(processed, sysSettings);
              const containerClass = processed.isExpired
                ? (item.is_required ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200')
                : 'bg-white border-gray-200';
              const hoverClass = processed.isExpired
                ? (item.is_required ? 'hover:bg-red-100' : 'hover:bg-orange-100')
                : 'hover:bg-gray-50';
              return (
                <div
                  key={item.id}
                  onClick={() => canEditMx && openMxForm(item)}
                  className={`p-4 border rounded flex justify-between items-center ${containerClass} ${canEditMx ? `cursor-pointer ${hoverClass} active:scale-[0.99] transition-all` : ''}`}
                >
                  <div className="w-full">
                    <div className="flex items-center gap-2">
                      <h4 className={`font-oswald font-bold uppercase text-sm ${processed.isExpired ? 'text-danger' : 'text-navy'}`}>{item.item_name}</h4>
                      {!item.is_required && <span className={`text-[8px] border px-1 rounded uppercase tracking-widest opacity-70 ${processed.isExpired ? 'border-danger text-danger' : 'border-navy text-navy'}`}>Optional</span>}
                    </div>
                    <p className={`text-xs mt-1 font-roboto font-bold ${dueTextColor}`}>{processed.dueText}</p>
                    {item.primary_heads_up_sent && !item.mx_schedule_sent && (
                      <div className="mt-3 bg-red-50 border border-red-200 p-3 rounded w-full max-w-sm">
                        <p className="text-[10px] text-danger font-bold uppercase mb-1 leading-tight">Heads up — coming due based on recent flying</p>
                        <p className="text-[10px] text-danger mb-2 leading-tight" title="How sure we are about the projection, based on how much recent flight history we have to work with.">Forecast confidence: {aircraft.confidenceScore || 0}% <span className="opacity-60">(from recent flight activity)</span></p>
                        <button onClick={(e) => { e.stopPropagation(); handleManualMxTrigger(item); }} disabled={isSubmitting} className="w-full bg-danger text-white text-[10px] font-bold uppercase px-3 py-2 rounded shadow active:scale-95 transition-transform disabled:opacity-50">Review &amp; Schedule</button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 pl-4 shrink-0">
                    {canEditMx && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); openMxForm(item); }} className="text-gray-400 hover:text-mxOrange transition-colors active:scale-95"><Edit2 size={16}/></button>
                        <button onClick={(e) => { e.stopPropagation(); deleteMxItem(item.id); }} className="text-gray-400 hover:text-danger transition-colors active:scale-95"><Trash2 size={16}/></button>
                      </>
                    )}
                  </div>
                </div>
              );
            };
            return (
          <div className={`bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 mb-6 ${isGroundedLocally ? 'border-danger' : 'border-mxOrange'}`}>
            <div className="flex justify-between items-end mb-6">
              <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Maintenance</h2>
              <div className="flex items-center gap-3">
                <button onClick={exportMxHistory} disabled={isExportingMx} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-info hover:opacity-80 transition-colors active:scale-95 disabled:opacity-50"><Download size={14} /> {isExportingMx ? 'Exporting...' : 'History'}</button>
                <button onClick={() => setShowGuideModal(true)} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-mxOrange hover:opacity-80 transition-colors active:scale-95"><HelpCircle size={14} /> Guide</button>
              </div>
            </div>
            {activeItems.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-4">
                {needsSetupItems.length > 0 ? 'All items need setup — fill in the last-completed info above to start tracking.' : 'Nothing tracked yet.'}
              </p>
            ) : (
              <div className="space-y-5">
                {blocking.length > 0 && (
                  <div>
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-danger mb-2 flex items-center gap-1.5">
                      <ShieldAlert size={13} /> Grounds the airplane today ({blocking.length})
                    </h3>
                    <div className="space-y-3">{blocking.map(renderRow)}</div>
                  </div>
                )}
                {watchlist.length > 0 && (
                  <div>
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-mxOrange mb-2 flex items-center gap-1.5">
                      <AlertTriangle size={13} /> Past due — optional items ({watchlist.length})
                    </h3>
                    <p className="text-[10px] text-gray-500 mb-2">These are past due but marked optional, so they don&apos;t ground the airplane.</p>
                    <div className="space-y-3">{watchlist.map(renderRow)}</div>
                  </div>
                )}
                {onTrack.length > 0 && (
                  <div>
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">On track ({onTrack.length})</h3>
                    <div className="space-y-3">{onTrack.map(renderRow)}</div>
                  </div>
                )}
              </div>
            )}
          </div>
            );
          })()}

          {/* ─── MX ITEM FORM MODAL ─── */}
          {showMxModal && canEditMx && (
            <ModalPortal>
            <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }}>
            <div className="flex min-h-full items-center justify-center p-3">
              <div className="bg-white rounded shadow-2xl w-full max-w-md p-5 border-t-4 border-mxOrange animate-slide-up">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="font-oswald text-2xl font-bold uppercase text-navy">
                    {editingId
                      ? 'Edit Maintenance Item'
                      : editQueue.length > 0
                        ? `Track Item (${queueCursor + 1} of ${editQueue.length})`
                        : detectedItems && editQueue.length === 0
                          ? 'Items Detected'
                          : 'Track New Item'}
                  </h2>
                  <button onClick={() => { setShowMxModal(false); resetScanAndQueue(); }} className="text-gray-400 hover:text-danger transition-colors"><X size={24}/></button>
                </div>
                {detectedItems && editQueue.length === 0 ? (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                      We found {detectedItems.length} items on this page. Pick the ones you want to track — we&apos;ll walk through them one at a time so you can review each before saving.
                    </p>
                    <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest">
                      <button type="button" onClick={() => setPickerSelections(detectedItems.map(() => true))} className="text-info hover:opacity-80 active:scale-95">Select all</button>
                      <span className="text-gray-300">|</span>
                      <button type="button" onClick={() => setPickerSelections(detectedItems.map(() => false))} className="text-info hover:opacity-80 active:scale-95">None</button>
                    </div>
                    <div className="space-y-2">
                      {detectedItems.map((item, idx) => (
                        <label key={idx} className="flex gap-3 items-start p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50 transition-colors">
                          <input
                            type="checkbox"
                            checked={!!pickerSelections[idx]}
                            onChange={e => {
                              const checked = e.target.checked;
                              setPickerSelections(prev => prev.map((v, i) => (i === idx ? checked : v)));
                            }}
                            className="mt-1 w-5 h-5 text-mxOrange rounded border-gray-300 shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <h4 className="font-oswald font-bold uppercase text-sm text-navy">{item?.item_name || 'Unnamed item'}</h4>
                            <p className="text-[11px] text-gray-500 mt-0.5">{describeDetectedItemInterval(item)}</p>
                            {item?.last_completed_date && (
                              <p className="text-[10px] text-gray-400 mt-0.5">
                                Last completed: {item.last_completed_date}
                                {item.last_completed_time != null ? ` @ ${item.last_completed_time} hrs` : ''}
                              </p>
                            )}
                            {item?.work_description && (
                              <p className="text-[10px] text-gray-400 mt-1 leading-tight">{item.work_description}</p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button type="button" onClick={resetScanAndQueue} className="flex-1 border border-gray-300 text-gray-600 font-oswald font-bold uppercase tracking-widest py-3 rounded text-xs active:scale-95">
                        Cancel scan
                      </button>
                      <button
                        type="button"
                        onClick={startEditQueue}
                        disabled={pickerSelections.filter(Boolean).length === 0}
                        className="flex-1 bg-mxOrange text-white font-oswald font-bold uppercase tracking-widest py-3 rounded text-xs active:scale-95 disabled:opacity-50"
                      >
                        Continue ({pickerSelections.filter(Boolean).length})
                      </button>
                    </div>
                  </div>
                ) : (
                <form onSubmit={submitMxItem} className="space-y-4">
                  {!editingId && editQueue.length === 0 && (
                    <div className="bg-purple-50 border border-purple-200 rounded p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => scanNewItemInputRef.current?.click()}
                          disabled={isScanningNewItem}
                          className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#7C3AED] bg-white border border-purple-300 rounded px-3 py-2 hover:bg-purple-100 active:scale-95 disabled:opacity-50 transition-all"
                        >
                          {isScanningNewItem
                            ? <><Loader2 size={12} className="animate-spin" /> Scanning...</>
                            : <><Camera size={12} /> Scan from logbook</>}
                        </button>
                        <span className="text-[10px] text-purple-900/70 flex-1 min-w-0">Snap a logbook entry — we&apos;ll classify the work and prefill the fields below.</span>
                        <input
                          ref={scanNewItemInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={e => {
                            const f = e.target.files?.[0];
                            if (f) handleScanForNewItem(f);
                            e.target.value = '';
                          }}
                        />
                      </div>
                      {scanPrefillHint && (
                        <p className="text-[10px] text-purple-900/80 mt-2 leading-tight">{scanPrefillHint}</p>
                      )}
                    </div>
                  )}
                  {editQueue.length > 0 && !editingId && (
                    <div className="bg-purple-50 border border-purple-200 rounded p-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-purple-900">
                          Item {queueCursor + 1} of {editQueue.length}
                        </p>
                        <button
                          type="button"
                          onClick={skipCurrentQueueItem}
                          className="text-[10px] font-bold uppercase tracking-widest text-purple-700 bg-white border border-purple-300 rounded px-2 py-1 active:scale-95 hover:bg-purple-100"
                        >
                          {queueCursor + 1 === editQueue.length ? 'Skip & Close' : 'Skip this one'}
                        </button>
                      </div>
                      {scanPrefillHint && (
                        <p className="text-[10px] text-purple-900/80 mt-2 leading-tight">{scanPrefillHint}</p>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Item Name *</label><input type="text" required value={mxName} onChange={e=>setMxName(e.target.value)} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none" placeholder="e.g. Annual Inspection" /></div>
                    <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Required?</label><select value={mxIsRequired ? "yes" : "no"} onChange={e=>setMxIsRequired(e.target.value === "yes")} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none"><option value="yes">Yes</option><option value="no">Optional</option></select></div>
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
                      <div className="w-full min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Last Completed ({isTurbine ? 'FTT' : 'Tach'}) *</label><input type="number" inputMode="decimal" step="0.1" required value={mxLastTime} onChange={e=>setMxLastTime(e.target.value)} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none" /></div>
                      <div className="grid grid-cols-2 gap-3 w-full min-w-0">
                        <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Interval (Hrs)</label><input type="number" inputMode="decimal" step="0.1" min="0.1" value={mxIntervalTime} onChange={e=>setMxIntervalTime(e.target.value)} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none" /></div>
                        <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">OR Exact Due</label><input type="number" inputMode="decimal" step="0.1" required={!(parseFloat(mxIntervalTime) > 0)} value={mxDueTime} onChange={e=>setMxDueTime(e.target.value)} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none" /></div>
                      </div>
                    </div>
                  )}
                  {(mxTrackingType === 'date' || mxTrackingType === 'both') && (
                    <div className="bg-gray-50 p-3 md:p-4 rounded border border-gray-200 space-y-3">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Date Interval</p>
                      <div className="w-full min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Last Completed Date *</label><input type="date" required value={mxLastDate} onChange={e=>setMxLastDate(e.target.value)} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none" /></div>
                      <div className="grid grid-cols-2 gap-3 w-full min-w-0">
                        <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">Interval (Days)</label><input type="number" min="1" value={mxIntervalDays} onChange={e=>setMxIntervalDays(e.target.value)} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none" /></div>
                        <div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-widest text-navy block truncate">OR Exact Due</label><input type="date" required={!(parseInt(mxIntervalDays, 10) > 0)} value={mxDueDate} onChange={e=>setMxDueDate(e.target.value)} style={INPUT_WHITE_BG} className="w-full min-w-0 border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none" /></div>
                      </div>
                    </div>
                  )}
                  {!editingId && (
                    <div className="pt-2 pb-2">
                      <label className="flex items-start gap-2 text-xs font-bold text-navy cursor-pointer">
                        <input type="checkbox" checked={automateScheduling} onChange={e=>setAutomateScheduling(e.target.checked)} className="mt-0.5 w-4 h-4 text-mxOrange border-gray-300 rounded focus:ring-mxOrange cursor-pointer shrink-0" />
                        <span className="flex flex-col"><span>Auto-draft a work package when this gets close to due</span><span className="text-[10px] text-gray-500 font-normal mt-1 leading-tight">When this item gets close to due, we'll draft a work package and email you to review it before it goes to your mechanic. Nothing sends automatically — you still tap send.</span></span>
                      </label>
                    </div>
                  )}
                  <div className="pt-4">
                    <PrimaryButton disabled={isSubmitting}>
                      {isSubmitting
                        ? 'Saving...'
                        : editingId
                          ? 'Save Maintenance Item'
                          : editQueue.length > 0
                            ? (queueCursor + 1 < editQueue.length ? 'Save & Next' : 'Save & Finish')
                            : 'Save Maintenance Item'}
                    </PrimaryButton>
                  </div>
                </form>
                )}
              </div>
            </div>
            </div>
            </ModalPortal>
          )}

          {confirmResendId && (
            <ModalPortal>
            <div className="fixed inset-0 bg-black/60 z-[10001] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setConfirmResendId(null)}>
            <div className="flex min-h-full items-center justify-center p-4">
              <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-mxOrange animate-slide-up" onClick={e => e.stopPropagation()}>
                <h3 className="font-oswald text-xl font-bold uppercase text-navy mb-3">Resend Work Package?</h3>
                <p className="text-sm text-gray-600 mb-6">Send the same work package email to <strong>{activeEvents.find(e => e.id === confirmResendId)?.mx_contact_name || 'your maintenance contact'}</strong> again? The subject line gets a &quot;Reminder&quot; tag so they know it&apos;s a nudge.</p>
                <div className="flex gap-3">
                  <button onClick={() => setConfirmResendId(null)} className="flex-1 border border-gray-300 text-gray-600 font-oswald font-bold uppercase tracking-widest py-3 rounded text-xs active:scale-95">Cancel</button>
                  <button onClick={() => handleResendWorkpackage(confirmResendId)} disabled={resendingEventId === confirmResendId} className="flex-1 bg-mxOrange text-white font-oswald font-bold uppercase tracking-widest py-3 rounded text-xs active:scale-95 disabled:opacity-50">{resendingEventId === confirmResendId ? 'Sending...' : 'Resend'}</button>
                </div>
              </div>
            </div>
            </div>
            </ModalPortal>
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

      {showServiceModal && <ServiceEventModal aircraft={aircraft} show onClose={() => { setShowServiceModal(false); setPreSelectMxItemId(null); mutateEvents(); }} onRefresh={() => { mutate(); mutateEvents(); }} canManageService={canEditMx} preSelectMxItemId={preSelectMxItemId} />}
    </div>
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
      const { data, error } = await supabase
        .from('aft_maintenance_events')
        .select('*')
        .eq('aircraft_id', aircraft!.id)
        .is('deleted_at', null)
        .in('status', ['complete', 'cancelled'])
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
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
    return (
      <div
        key={ev.id}
        onClick={onOpenModal}
        className="bg-white shadow rounded-sm p-4 border-l-4 flex items-start justify-between gap-3 cursor-pointer hover:shadow-lg active:scale-[0.99] transition-all"
        style={{ borderLeftColor: statusColor }}
      >
        <div className="min-w-0">
          <span
            className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white inline-block"
            style={{ backgroundColor: statusColor }}
          >
            {mxEventStatusLabel(ev.status)}
          </span>
          <p className="font-oswald font-bold text-navy text-sm mt-2 truncate">{mxEventSummary(ev)}</p>
          {ev.estimated_completion && (
            <p className="text-[10px] text-gray-500 mt-0.5">Est. completion: {ev.estimated_completion}</p>
          )}
          <p className="text-[10px] text-gray-400 mt-0.5 truncate">
            MX Contact: {ev.mx_contact_name || 'N/A'}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onOpenModal(); }}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-info bg-blue-50 border border-blue-200 px-2.5 py-1.5 rounded active:scale-95"
          >
            View <ChevronRight size={12} />
          </button>
          {ev.access_token && ev.status !== 'draft' && (
            <a
              href={`/service/${ev.access_token}`}
              onClick={(e) => e.stopPropagation()}
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
          className="w-full bg-mxOrange text-white font-oswald tracking-widest uppercase py-3 px-4 rounded hover:bg-opacity-90 active:scale-95 transition-all flex justify-center items-center gap-2 text-sm"
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
          <p className="text-xs text-gray-500 bg-gray-50 rounded p-3 border border-gray-200">
            Nothing open right now. {canEditMx ? 'Tap Schedule Service to bundle items into a trip to the shop.' : 'Your aircraft admin can schedule service when needed.'}
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

import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { newIdempotencyKey, idempotencyHeader } from "@/lib/idempotencyClient";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics } from "@/lib/types";
import useSWR from "swr";
import { Download, ChevronLeft, ChevronRight, Plus, X, Edit2, Trash2, Info, MapPin } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { ModalPortal } from "@/components/ModalPortal";
import { mutateWithDeadline } from "@/lib/mutateWithDeadline";

const whiteBg = { backgroundColor: '#ffffff' } as const;

export default function TimesTab({ 
  aircraft, session, role, userInitials, onUpdate 
}: { 
  aircraft: AircraftWithMetrics | null, 
  session: any, 
  role: string, 
  userInitials: string, 
  onUpdate: () => void 
}) {
  const [logPage, setLogPage] = useState(1);
  
  const { data, mutate } = useSWR<{ logs: any[]; hasMore: boolean }>(
    aircraft ? swrKeys.times(aircraft.id, logPage) : null,
    async () => {
      // Cookie-bearing fetch via /api/flight-logs. Server uses the
      // same "fetch pageSize+1" pattern to avoid the iOS-wedging
      // COUNT(*) clause; route docs explain the trade-off.
      const res = await authFetch(
        `/api/flight-logs?aircraftId=${aircraft!.id}&page=${logPage}&pageSize=10`,
      );
      if (!res.ok) throw new Error(`flight-logs fetch failed: ${res.status}`);
      return res.json();
    }
  );

  const flightLogs = data?.logs || [];
  const hasMoreLogs = data?.hasMore || false;
  
  const [showLogModal, setShowLogModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [viewPax, setViewPax] = useState<string | null>(null);
  const [viewRouting, setViewRouting] = useState<{pod: string | null, poa: string | null} | null>(null);
  const [showLegend, setShowLegend] = useState(false);

  useModalScrollLock(showLogModal || !!viewPax || !!viewRouting || showLegend);

  const { showSuccess, showError, showWarning } = useToast();
  const confirm = useConfirm();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [logPod, setLogPod] = useState("");
  const [logPoa, setLogPoa] = useState("");
  const [logAftt, setLogAftt] = useState("");
  const [logFtt, setLogFtt] = useState("");
  const [logHobbs, setLogHobbs] = useState("");
  const [logTach, setLogTach] = useState("");
  const [logCycles, setLogCycles] = useState("");
  const [logLandings, setLogLandings] = useState("");
  const [logInitials, setLogInitials] = useState("");
  const [logPax, setLogPax] = useState("");
  const [logReason, setLogReason] = useState("");
  const [logFuel, setLogFuel] = useState("");
  const [logFuelUnit, setLogFuelUnit] = useState<'gallons' | 'lbs'>('gallons');
  // Sticky idempotency key for the open submit attempt — survives a
  // network timeout + manual retry so the server dedupes a request
  // whose response was lost (iOS PWA backgrounding can drop the
  // response while the row already wrote). Cleared on success and
  // on modal open so a fresh form gets a fresh key.
  const [submitIdemKey, setSubmitIdemKey] = useState<string | null>(null);

  // Reset everything tied to a single aircraft's context when the
  // pilot switches tails. Without this, an open "Edit Flight Log"
  // modal stays open across the switch and the Save would land on
  // the previous aircraft's row; pagination past the new tail's
  // last page would render empty. Preserves logFuelUnit (a UI
  // preference, not tail-specific).
  useEffect(() => {
    setShowLogModal(false);
    setEditingId(null);
    setLogPage(1);
    setViewPax(null);
    setViewRouting(null);
    setLogPod(''); setLogPoa('');
    setLogAftt(''); setLogFtt(''); setLogHobbs(''); setLogTach('');
    setLogCycles(''); setLogLandings('');
    setLogPax(''); setLogReason('');
    setLogFuel('');
    setSubmitIdemKey(null);
  }, [aircraft?.id]);

  // Lazily load the last fuel unit the pilot chose so they don't have to
  // re-select it every time they log a flight. Only runs on the client.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('aft_fuel_unit');
    if (stored === 'gallons' || stored === 'lbs') setLogFuelUnit(stored);
  }, []);

  const isTurbine = aircraft?.engine_type === 'Turbine';
  const hasAirframeMeter = isTurbine
    ? (aircraft?.setup_aftt != null)
    : (aircraft?.setup_hobbs != null);

  const openLogForm = (log: any = null) => {
    if (log) {
      setEditingId(log.id); 
      setLogPod(log.pod || "");
      setLogPoa(log.poa || "");
      setLogAftt(log.aftt?.toString() || ""); 
      setLogFtt(log.ftt?.toString() || ""); 
      setLogHobbs(log.hobbs?.toString() || ""); 
      setLogTach(log.tach?.toString() || "");
      setLogCycles(log.engine_cycles?.toString() || ""); 
      setLogLandings(log.landings?.toString() || ""); 
      setLogInitials(log.initials || ""); 
      setLogPax(log.pax_info || ""); 
      setLogReason(log.trip_reason || "");
      setLogFuel(log.fuel_gallons?.toString() || "");
      setLogFuelUnit("gallons");
    } else {
      setEditingId(null);
      setLogPod(""); setLogPoa("");
      setLogAftt(""); setLogFtt(""); setLogHobbs(""); setLogTach("");
      setLogCycles(""); setLogLandings("");
      setLogInitials(userInitials || "");
      setLogPax(""); setLogReason("");
      setLogFuel("");
      // Reset the unit to whatever the pilot chose last, not always 'gallons'.
      const storedUnit = typeof window !== 'undefined' ? window.localStorage.getItem('aft_fuel_unit') : null;
      setLogFuelUnit(storedUnit === 'lbs' ? 'lbs' : 'gallons');
    }
    setSubmitIdemKey(newIdempotencyKey());
    setShowLogModal(true);
  };

  const deleteLatestLog = async (log: any) => {
    const ok = await confirm({
      title: "Delete Latest Flight Log?",
      message: "This permanently erases the most recent flight log and rolls the aircraft totals back to the previous log.",
      confirmText: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    setIsSubmitting(true);

    const { data: previousLogs, error: prevErr } = await supabase
      .from('aft_flight_logs').select('*')
      .eq('aircraft_id', aircraft!.id)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false }).order('created_at', { ascending: false }).limit(2);

    // If we can't read the previous log we MUST NOT proceed — the
    // delete would otherwise roll totals back to setup_* values and
    // silently corrupt the airframe history.
    if (prevErr) {
      showError("Couldn't load previous flight log: " + (prevErr.message || 'unknown error'));
      setIsSubmitting(false);
      return;
    }

    const previousLog = previousLogs && previousLogs.length > 1 ? previousLogs[1] : null;

    const updateData: Record<string, any> = {};
    if (isTurbine) {
      updateData.total_engine_time = previousLog ? previousLog.ftt : (aircraft!.setup_ftt || 0);
      if (hasAirframeMeter) {
        updateData.total_airframe_time = previousLog
          ? (previousLog.aftt != null ? previousLog.aftt : previousLog.ftt)
          : (aircraft!.setup_aftt ?? 0);
      } else {
        updateData.total_airframe_time = updateData.total_engine_time;
      }
    } else {
      updateData.total_engine_time = previousLog ? previousLog.tach : (aircraft!.setup_tach || 0);
      if (hasAirframeMeter) {
        updateData.total_airframe_time = previousLog && previousLog.hobbs != null
          ? previousLog.hobbs
          : (aircraft!.setup_hobbs ?? updateData.total_engine_time);
      } else {
        updateData.total_airframe_time = updateData.total_engine_time;
      }
    }
    
    updateData.current_fuel_gallons = previousLog && previousLog.fuel_gallons !== null ? previousLog.fuel_gallons : 0;
    updateData.fuel_last_updated = previousLog ? (previousLog.occurred_at ?? previousLog.created_at) : null;

    const res = await authFetch('/api/flight-logs', {
      method: 'DELETE',
      body: JSON.stringify({ logId: log.id, aircraftId: aircraft!.id, aircraftUpdate: updateData })
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Couldn't delete the flight log"); }

    setLogPage(1);
    await mutateWithDeadline(mutate()); 
    onUpdate();
    showSuccess("Flight log deleted — times rolled back");
    setIsSubmitting(false);
  };

  const exportCSV = async () => {
    setIsExporting(true);
    const { data: exportData, error: exportErr } = await supabase
      .from('aft_flight_logs').select('*')
      .eq('aircraft_id', aircraft!.id)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false }).order('created_at', { ascending: false });

    // Without this we tell the user "No logs to export" on a transient
    // failure — they'd assume their flight history is gone.
    if (exportErr) {
      showError("Couldn't load flight logs to export. Try again.");
      setIsExporting(false);
      return;
    }

    if (!exportData || exportData.length === 0) {
      showWarning("No logs to export."); setIsExporting(false); return;
    }

    const headers = ['Date', 'POD', 'POA', 'Initials', 'FLT'];
    if (hasAirframeMeter) headers.push(isTurbine ? 'AFTT' : 'Hobbs');
    headers.push(isTurbine ? 'FTT' : 'Tach', 'LDG');
    if (isTurbine) headers.push('Engine Cycles');
    headers.push('Fuel (Gal)', 'Reason', 'Passengers');

    const csvRows = [headers.join(',')];
    const rowsWithMath = exportData.map((log: any, index: number) => {
      const prevLog = exportData[index + 1];
      let fltTime = "-";
      const prevFtt = prevLog ? (prevLog.ftt || 0) : (aircraft!.setup_ftt || 0);
      const prevTach = prevLog ? (prevLog.tach || 0) : (aircraft!.setup_tach || 0);
      const canUseAftt = log.aftt && (prevLog ? prevLog.aftt : (aircraft!.setup_aftt != null));
      const canUseHobbs = log.hobbs && (prevLog ? prevLog.hobbs : (aircraft!.setup_hobbs != null));
      const prevAftt = canUseAftt ? (prevLog ? prevLog.aftt : (aircraft!.setup_aftt || 0)) : 0;
      const prevHobbs = canUseHobbs ? (prevLog ? prevLog.hobbs : (aircraft!.setup_hobbs || 0)) : 0;
      const diff = isTurbine
        ? (canUseAftt ? ((log.aftt || 0) - prevAftt) : ((log.ftt || 0) - prevFtt))
        : (canUseHobbs ? ((log.hobbs || 0) - prevHobbs) : ((log.tach || 0) - prevTach));
      fltTime = Math.max(0, diff).toFixed(1);

      const row = [
        new Date(log.occurred_at ?? log.created_at).toLocaleDateString('en-US', { year: '2-digit', month: 'numeric', day: 'numeric' }),
        log.pod || '-', log.poa || '-', log.initials, fltTime
      ];
      if (hasAirframeMeter) row.push(isTurbine ? (log.aftt || '') : (log.hobbs || ''));
      row.push(isTurbine ? (log.ftt || '') : (log.tach || ''), log.landings);
      if (isTurbine) row.push(log.engine_cycles);
      row.push(log.fuel_gallons || '-', log.trip_reason || 'N/A', `"${(log.pax_info || '').replace(/"/g, '""')}"`);
      return row.join(',');
    });

    csvRows.push(...rowsWithMath.reverse());
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = window.URL.createObjectURL(blob); 
    a.download = `${aircraft!.tail_number}_Flight_Logs.csv`; a.click();
    setIsExporting(false);
  };

  const submitFlightLog = async (e: React.FormEvent) => {
    e.preventDefault();

    // Blank landings/cycles treated as 0 — a ferry or positioning leg
    // may land zero times, and rejecting "" as "cannot be negative" is
    // misleading. Explicit negative values still fail.
    const landingsNum = logLandings.trim() === '' ? 0 : parseInt(logLandings);
    const cyclesNum = !isTurbine
      ? 0
      : logCycles.trim() === '' ? 0 : parseInt(logCycles);
    if (Number.isNaN(landingsNum) || landingsNum < 0) return showError("Landings must be zero or a positive whole number.");
    if (isTurbine && (Number.isNaN(cyclesNum) || cyclesNum < 0)) return showError("Engine cycles must be zero or a positive whole number.");
    if (logFtt && parseFloat(logFtt) < 0) return showError("FTT cannot be negative.");
    if (logTach && parseFloat(logTach) < 0) return showError("Tach cannot be negative.");
    if (logAftt && parseFloat(logAftt) < 0) return showError("AFTT cannot be negative.");
    if (logHobbs && parseFloat(logHobbs) < 0) return showError("Hobbs cannot be negative.");
    if (logFuel && parseFloat(logFuel) < 0) return showError("Fuel cannot be negative.");

    // Required-meter guard. The bounds checks below compare
    // `parseFloat(x) < prev` — and `NaN < N` is false, so a blank or
    // non-numeric Tach/FTT silently skips every bounds check and lands
    // a junk value. The form has `required`, but iOS autofill drift
    // (controlled-input value diverging from React state, see
    // feedback_form_novalidate_ios_autofill.md) can bypass HTML5
    // validation on a future noValidate switch. Reject up-front.
    if (isTurbine && !Number.isFinite(parseFloat(logFtt))) return showError("FTT is required.");
    if (!isTurbine && !Number.isFinite(parseFloat(logTach))) return showError("Tach is required.");

    // Resolve the "previous" reference (what the new values must meet or exceed)
    // and, for edits, the "next" log (upper bound so we don't overtake a newer entry).
    let prevFtt = aircraft!.total_engine_time || 0;
    let prevTach = aircraft!.total_engine_time || 0;
    let prevAftt: number | null | undefined = aircraft!.total_airframe_time;
    let prevHobbs: number | null | undefined = aircraft!.total_airframe_time;
    let nextLog: any = null;
    let isLatestLog = true;

    if (editingId) {
      // Edit validation anchors against the adjacent logs by occurred_at,
      // matching how the server-side derive_latest aggregate works. Using
      // created_at here instead would have us validate against a different
      // neighbor than the RPC picks when the aircraft totals are rederived.
      const { data: editingLog, error: editingLogErr } = await supabase
        .from('aft_flight_logs').select('occurred_at, created_at')
        .eq('id', editingId).maybeSingle();
      // Distinguish "log doesn't exist" from "couldn't read it" — without
      // this an RLS/JWT hiccup looks identical to a deleted log and the
      // user gets a misleading error.
      if (editingLogErr) return showError("Couldn't load this flight log to validate the edit. Try again.");
      if (!editingLog) return showError("Flight log not found.");

      const pivotOccurred = editingLog.occurred_at ?? editingLog.created_at;
      const pivotCreated = editingLog.created_at;
      // Tuple compare on (occurred_at, created_at) so two logs sharing
      // the same occurred_at don't exclude each other. Using .lt() on
      // occurred_at alone would skip a sibling with the same timestamp,
      // giving us the wrong neighbor and a misleading validation preview.
      // created_at is the server tiebreaker, matching how the RPC's
      // derive-latest SELECT orders rows.
      const baseUrl = `/api/flight-logs?aircraftId=${aircraft!.id}&pivotOccurred=${encodeURIComponent(pivotOccurred)}&pivotCreated=${encodeURIComponent(pivotCreated)}`;
      const [prevRes, nextRes] = await Promise.all([
        authFetch(`${baseUrl}&neighbor=prev`),
        authFetch(`${baseUrl}&neighbor=next`),
      ]);
      // A failed neighbor lookup would silently treat the edit as the
      // latest log and validate against setup_* — letting the user save
      // a value that overshoots a newer entry's totals.
      if (!prevRes.ok || !nextRes.ok) {
        return showError("Couldn't validate the edit against neighboring logs. Try again.");
      }
      const prevBody = await prevRes.json();
      const nextBody = await nextRes.json();
      const prevLog = prevBody.neighbor || null;
      nextLog = nextBody.neighbor || null;
      isLatestLog = !nextLog;

      prevFtt = prevLog?.ftt ?? aircraft!.setup_ftt ?? 0;
      prevTach = prevLog?.tach ?? aircraft!.setup_tach ?? 0;
      prevAftt = prevLog?.aftt ?? aircraft!.setup_aftt;
      prevHobbs = prevLog?.hobbs ?? aircraft!.setup_hobbs;
    }

    if (isTurbine) {
      if (logAftt && prevAftt != null && parseFloat(logAftt) < prevAftt) return showError(`New AFTT (${logAftt}) cannot be less than previous AFTT (${prevAftt}).`);
      if (parseFloat(logFtt) < prevFtt) return showError(`New FTT (${logFtt}) cannot be less than previous FTT (${prevFtt}).`);
      if (nextLog) {
        if (logAftt && nextLog.aftt != null && parseFloat(logAftt) > nextLog.aftt) return showError(`New AFTT (${logAftt}) cannot exceed the next log's AFTT (${nextLog.aftt}).`);
        if (nextLog.ftt != null && parseFloat(logFtt) > nextLog.ftt) return showError(`New FTT (${logFtt}) cannot exceed the next log's FTT (${nextLog.ftt}).`);
      }
    } else {
      if (parseFloat(logTach) < prevTach) return showError(`New Tach (${logTach}) cannot be less than previous Tach (${prevTach}).`);
      if (logHobbs && prevHobbs != null && parseFloat(logHobbs) < prevHobbs) return showError(`New Hobbs (${logHobbs}) cannot be less than previous Hobbs (${prevHobbs}).`);
      if (nextLog) {
        if (nextLog.tach != null && parseFloat(logTach) > nextLog.tach) return showError(`New Tach (${logTach}) cannot exceed the next log's Tach (${nextLog.tach}).`);
        if (logHobbs && nextLog.hobbs != null && parseFloat(logHobbs) > nextLog.hobbs) return showError(`New Hobbs (${logHobbs}) cannot exceed the next log's Hobbs (${nextLog.hobbs}).`);
      }
    }

    setIsSubmitting(true);

    let fuelGallons = logFuel ? parseFloat(logFuel) : null;
    if (fuelGallons !== null && logFuelUnit === 'lbs') {
      const weightPerGal = isTurbine ? 6.7 : 6.0;
      fuelGallons = fuelGallons / weightPerGal;
    }

    const payload: Record<string, any> = { 
      aircraft_id: aircraft!.id, user_id: session.user.id, 
      pod: logPod.toUpperCase() || null, poa: logPoa.toUpperCase() || null,
      engine_cycles: isTurbine ? cyclesNum : 0,
      landings: landingsNum, initials: logInitials.toUpperCase(),
      pax_info: logPax || null, trip_reason: logReason || null, fuel_gallons: fuelGallons
    };
    
    const aircraftUpdate: Record<string, any> = {};

    // Secondary airframe meter: drop 0 to "not present". A truthy
    // "0" string would otherwise land in the log and poison the
    // log_flight_atomic coalesce chain on the next entry — see
    // migration 076 + the N6872A field report.
    const aftFloat = parseFloat(logAftt);
    const hobbsFloat = parseFloat(logHobbs);
    const hasAftt = logAftt && Number.isFinite(aftFloat) && aftFloat > 0;
    const hasHobbs = logHobbs && Number.isFinite(hobbsFloat) && hobbsFloat > 0;

    if (isTurbine) {
      payload.ftt = parseFloat(logFtt);
      aircraftUpdate.total_engine_time = parseFloat(logFtt);
      if (hasAftt) {
        payload.aftt = aftFloat;
        aircraftUpdate.total_airframe_time = aftFloat;
      } else {
        aircraftUpdate.total_airframe_time = parseFloat(logFtt);
      }
    } else {
      payload.tach = parseFloat(logTach);
      aircraftUpdate.total_engine_time = parseFloat(logTach);
      if (hasHobbs) {
        payload.hobbs = hobbsFloat;
        aircraftUpdate.total_airframe_time = hobbsFloat;
      } else {
        aircraftUpdate.total_airframe_time = parseFloat(logTach);
      }
    }

    if (fuelGallons !== null) {
      aircraftUpdate.current_fuel_gallons = fuelGallons;
      aircraftUpdate.fuel_last_updated = new Date().toISOString(); 
    }

    // Wrap the network write in try/catch so a failed save doesn't
    // leave the submit button stuck in "Saving..." forever. The
    // finally clears isSubmitting even on error; success path also
    // closes the modal inside try so the side-effects stay ordered.
    // Sticky idempotency key bound to the modal session. If the
    // network times out (iOS PWA fetch suspension is the common
    // cause) and the user re-taps Submit, the server dedupes against
    // this key so a request whose response was lost mid-flight can't
    // re-write the row. Falls back to a fresh key if state is
    // somehow missing (e.g. submit fired before openLogForm seeded).
    const idemKey = submitIdemKey ?? newIdempotencyKey();
    try {
      if (editingId) {
        // Only overwrite aircraft totals if we're editing the most recent log.
        // Editing an older entry must not reach forward and clobber the current totals,
        // which reflect the latest log.
        const editAircraftUpdate = isLatestLog ? aircraftUpdate : {};
        const res = await authFetch('/api/flight-logs', {
          method: 'PUT',
          headers: idempotencyHeader(idemKey),
          body: JSON.stringify({ logId: editingId, aircraftId: aircraft!.id, logData: payload, aircraftUpdate: editAircraftUpdate })
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Couldn't update the flight log"); }
      } else {
        const res = await authFetch('/api/flight-logs', {
          method: 'POST',
          headers: idempotencyHeader(idemKey),
          body: JSON.stringify({ aircraftId: aircraft!.id, logData: payload, aircraftUpdate })
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Couldn't save the flight log"); }
      }
      await mutateWithDeadline(mutate()); onUpdate(); setShowLogModal(false);
      setSubmitIdemKey(null); // success: drop the key so the next open generates a fresh one
      showSuccess(editingId ? "Flight log updated" : "Flight logged");
    } catch (err: any) {
      // Keep submitIdemKey set on failure so a retry inside the same
      // modal session reuses it and the server dedupes if the row
      // already wrote. Refresh the list anyway — on a timeout the
      // request may have hit the server before the response was lost
      // (iOS PWA backgrounding does this), and showing the new row
      // lets the pilot decide whether to retry or close the modal.
      mutate().catch(() => {});
      onUpdate();
      showError(err?.message || "Couldn't save the flight log.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!aircraft) return null;

  const logsWithMath = flightLogs.slice(0, 10).map((log, index) => {
    const prevLog = flightLogs[index + 1];
    let fltTime = "-";
    if (prevLog || !hasMoreLogs) {
      const prevFtt = prevLog ? (prevLog.ftt || 0) : (aircraft.setup_ftt || 0);
      const prevTach = prevLog ? (prevLog.tach || 0) : (aircraft.setup_tach || 0);
      // Only use hobbs/aftt when BOTH current and previous have the value,
      // otherwise the delta would be against 0 (producing the full reading, not a flight delta).
      const canUseAftt = log.aftt && (prevLog ? prevLog.aftt : (aircraft.setup_aftt != null));
      const canUseHobbs = log.hobbs && (prevLog ? prevLog.hobbs : (aircraft.setup_hobbs != null));
      const prevAftt = canUseAftt ? (prevLog ? prevLog.aftt : (aircraft.setup_aftt || 0)) : 0;
      const prevHobbs = canUseHobbs ? (prevLog ? prevLog.hobbs : (aircraft.setup_hobbs || 0)) : 0;
      const diff = isTurbine
        ? (canUseAftt ? ((log.aftt || 0) - prevAftt) : ((log.ftt || 0) - prevFtt))
        : (canUseHobbs ? ((log.hobbs || 0) - prevHobbs) : ((log.tach || 0) - prevTach));
      fltTime = Math.max(0, diff).toFixed(1);
    }
    return { ...log, fltTime };
  });

  const displayLogsReversed = [...logsWithMath].reverse();

  return (
    <>
      <div className="mb-2">
        <PrimaryButton onClick={() => openLogForm()}><Plus size={18} /> Log New Flight</PrimaryButton>
      </div>

      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-info flex flex-col mb-6">
        <div className="flex justify-between items-end mb-6">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-info block mb-1">{isTurbine ? 'TURBINE' : 'PISTON'} LOGBOOK</span>
            <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Flight Log</h2>
          </div>
          <button onClick={exportCSV} disabled={isExporting} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-info hover:opacity-80 transition-colors disabled:opacity-50">
            <Download size={14} /> {isExporting ? "Exporting..." : "Export CSV"}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-navy text-[10px] font-bold uppercase tracking-widest text-gray-500">
                <th className="pb-2 px-2 text-center">DATE</th>
                <th className="pb-2 px-2 text-center">PIC</th>
                <th className="pb-2 px-2 text-center">FLT</th>
                {hasAirframeMeter && <th className="pb-2 px-2 text-center">{isTurbine ? 'AFTT' : 'Hobbs'}</th>}
                <th className="pb-2 px-2 text-center">{isTurbine ? 'FTT' : 'Tach'}</th>
                <th className="pb-2 px-2 text-center">LDG</th>
                {isTurbine && <th className="pb-2 px-2 text-center">Cyc</th>}
                <th className="pb-2 px-2 text-center">RSN</th>
                <th className="pb-2 px-2 text-center">PAX</th>
                {role === 'admin' && <th className="pb-2"></th>}
              </tr>
            </thead>
            <tbody className="text-xs font-roboto text-navy">
              {displayLogsReversed.map((log) => (
                <tr key={log.id} className="border-b border-gray-200 hover:bg-blue-50/50 transition-colors">
                  <td className="py-3 px-2 text-center whitespace-nowrap">{new Date(log.occurred_at ?? log.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td className="py-3 px-2 text-center font-bold">{log.initials}</td>
                  <td className="py-3 px-2 text-center text-info font-bold">
                    {log.pod || log.poa ? (
                      <button onClick={() => setViewRouting({ pod: log.pod, poa: log.poa })} className="underline active:scale-95 transition-transform" title="View Routing">{log.fltTime}</button>
                    ) : <span>{log.fltTime}</span>}
                  </td>
                  {hasAirframeMeter && <td className="py-3 px-2 text-center">{isTurbine ? (log.aftt?.toFixed(1) || '-') : (log.hobbs?.toFixed(1) || '-')}</td>}
                  <td className="py-3 px-2 text-center">{isTurbine ? log.ftt?.toFixed(1) : log.tach?.toFixed(1)}</td>
                  <td className="py-3 px-2 text-center">{log.landings}</td>
                  {isTurbine && <td className="py-3 px-2 text-center">{log.engine_cycles}</td>}
                  <td className="py-3 px-2 text-center">{log.trip_reason || "-"}</td>
                  <td className="py-3 px-2 text-center">
                    {log.pax_info ? <button onClick={() => setViewPax(log.pax_info)} className="text-info font-bold underline active:scale-95 transition-transform">Y</button> : <span className="text-gray-400 font-medium">N</span>}
                  </td>
                  {role === 'admin' && (
                    <td className="py-3 text-right flex justify-end items-center gap-3">
                      <button onClick={() => openLogForm(log)} className="text-gray-400 hover:text-info transition-colors" title="Edit Log"><Edit2 size={14}/></button>
                      {logPage === 1 && log.id === flightLogs[0]?.id && (
                        <button onClick={() => deleteLatestLog(log)} className="text-gray-400 hover:text-danger transition-colors" title="Delete Latest Log"><Trash2 size={14}/></button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between items-center mt-4 border-t border-gray-200 pt-4">
          <button onClick={() => setLogPage(p => Math.max(1, p - 1))} disabled={logPage === 1} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-info transition-colors"><ChevronLeft size={14} /> Prev</button>
          <span className="text-[10px] font-bold uppercase text-gray-400">Page {logPage}</span>
          <button onClick={() => setLogPage(p => p + 1)} disabled={!hasMoreLogs} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-info transition-colors">Next <ChevronRight size={14} /></button>
        </div>
        {role === 'admin' && flightLogs.length > 0 && (
          <p className="text-[10px] text-gray-400 mt-3 leading-tight">
            Only the most recent log can be deleted (this rolls aircraft totals back to the prior entry). Older logs can be edited — use edit to correct a mistake.
          </p>
        )}
      </div>

      {viewPax && (
        <ModalPortal>
        <div className="fixed inset-0 z-[10000] overflow-y-auto bg-black/60 animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setViewPax(null)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-info animate-slide-up relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setViewPax(null)} className="absolute top-4 right-4 text-gray-400 hover:text-danger transition-colors"><X size={20}/></button>
            <h3 className="font-oswald text-xl font-bold uppercase tracking-widest text-navy mb-4">Passenger Info</h3>
            <p className="text-sm text-navy font-roboto whitespace-pre-wrap">{viewPax}</p>
          </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {viewRouting && (
        <ModalPortal>
        <div className="fixed inset-0 z-[10000] overflow-y-auto bg-black/60 animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setViewRouting(null)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-info animate-slide-up relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setViewRouting(null)} className="absolute top-4 right-4 text-gray-400 hover:text-danger transition-colors"><X size={20}/></button>
            <h3 className="font-oswald text-xl font-bold uppercase tracking-widest text-navy mb-4">Flight Routing</h3>
            <div className="flex items-center gap-4 text-navy">
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded p-3 text-center">
                <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Depart</span>
                <span className="font-roboto text-lg font-bold">{viewRouting.pod || '-'}</span>
              </div>
              <ChevronRight size={24} className="text-gray-300" />
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded p-3 text-center">
                <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Arrive</span>
                <span className="font-roboto text-lg font-bold">{viewRouting.poa || '-'}</span>
              </div>
            </div>
          </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {showLegend && (
        <ModalPortal>
        <div className="fixed inset-0 z-[10000] overflow-y-auto bg-black/60 animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowLegend(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-info animate-slide-up relative" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setShowLegend(false)} className="absolute top-4 right-4 text-gray-400 hover:text-danger transition-colors"><X size={20}/></button>
            <h3 className="font-oswald text-xl font-bold uppercase tracking-widest text-navy mb-4">Reason Codes</h3>
            <ul className="text-sm text-navy font-roboto space-y-3">
              <li><strong className="text-info w-8 inline-block">PE:</strong> Personal Entertainment</li>
              <li><strong className="text-info w-8 inline-block">BE:</strong> Business Entertainment</li>
              <li><strong className="text-info w-8 inline-block">MX:</strong> Maintenance</li>
              <li><strong className="text-info w-8 inline-block">T:</strong> Training</li>
              <li><strong className="text-info w-12 inline-block">ADJ:</strong> Adjustment (book-keeping; 0 landings OK)</li>
            </ul>
          </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {showLogModal && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-info animate-slide-up">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy">{editingId ? 'Edit Flight Log' : 'Log New Flight'}</h2>
              <button onClick={() => setShowLogModal(false)} className="text-gray-400 hover:text-danger transition-colors"><X size={24}/></button>
            </div>
            <p className="text-[10px] text-gray-500 mb-4 leading-tight">
              <span className="text-danger font-bold">*</span> required &middot; <span className="font-bold">(Opt)</span> optional
            </p>
            <form onSubmit={submitFlightLog} className="space-y-4">
              <div className="grid grid-cols-2 gap-4 border-b border-gray-100 pb-4 mb-2">
                <div><label className="block text-[10px] font-bold uppercase tracking-widest text-navy mb-1">POD (Depart)</label><input type="text" style={whiteBg} maxLength={4} value={logPod} onChange={e=>setLogPod(e.target.value.toUpperCase())} className="w-full border border-gray-300 rounded p-3 text-sm uppercase focus:border-info outline-none bg-white text-center font-bold" placeholder="ICAO" /></div>
                <div><label className="block text-[10px] font-bold uppercase tracking-widest text-navy mb-1">POA (Arrive)</label><input type="text" style={whiteBg} maxLength={4} value={logPoa} onChange={e=>setLogPoa(e.target.value.toUpperCase())} className="w-full border border-gray-300 rounded p-3 text-sm uppercase focus:border-info outline-none bg-white text-center font-bold" placeholder="ICAO" /></div>
              </div>

              <div className={`grid ${hasAirframeMeter ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
                {isTurbine ? (
                  <>
                    {hasAirframeMeter && (
                      <div>
                        <div className="flex justify-between items-center mb-1"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">AFTT (Opt)</label><span className="text-[9px] font-bold uppercase text-gray-400">Last: {aircraft?.total_airframe_time?.toFixed(1) || 0} hrs</span></div>
                        <input type="number" inputMode="decimal" min="0" style={whiteBg} step="0.1" value={logAftt} onChange={e=>setLogAftt(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm focus:border-info outline-none bg-white" />
                      </div>
                    )}
                    <div>
                      <div className="flex justify-between items-center mb-1"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">FTT <span className="text-danger">*</span></label><span className="text-[9px] font-bold uppercase text-gray-400">Last: {aircraft?.total_engine_time?.toFixed(1) || 0} hrs</span></div>
                      <input type="number" inputMode="decimal" min="0" style={whiteBg} step="0.1" required value={logFtt} onChange={e=>setLogFtt(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm focus:border-info outline-none bg-white" />
                    </div>
                  </>
                ) : (
                  <>
                    {hasAirframeMeter && (
                      <div>
                        <div className="flex justify-between items-center mb-1"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Hobbs (Opt)</label><span className="text-[9px] font-bold uppercase text-gray-400">Last: {aircraft?.total_airframe_time?.toFixed(1) || 0} hrs</span></div>
                        <input type="number" inputMode="decimal" min="0" style={whiteBg} step="0.1" value={logHobbs} onChange={e=>setLogHobbs(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm focus:border-info outline-none bg-white" />
                      </div>
                    )}
                    <div>
                      <div className="flex justify-between items-center mb-1"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Tach <span className="text-danger">*</span></label><span className="text-[9px] font-bold uppercase text-gray-400">Last: {aircraft?.total_engine_time?.toFixed(1) || 0} hrs</span></div>
                      <input type="number" inputMode="decimal" min="0" style={whiteBg} step="0.1" required value={logTach} onChange={e=>setLogTach(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm focus:border-info outline-none bg-white" />
                    </div>
                  </>
                )}
              </div>

              <div className={`grid ${isTurbine ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
                <div>
                  <div className="flex items-center justify-between mb-1 h-4"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Landings <span className="text-danger">*</span></label></div>
                  <input type="number" min="0" style={whiteBg} required value={logLandings} onChange={e=>setLogLandings(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm focus:border-info outline-none bg-white" placeholder="0 for ferry / reposition / adjustment" />
                </div>
                {isTurbine && (
                  <div>
                    <div className="flex items-center justify-between mb-1 h-4"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Engine Cycles <span className="text-danger">*</span></label></div>
                    <input type="number" min="0" style={whiteBg} required value={logCycles} onChange={e=>setLogCycles(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm focus:border-info outline-none bg-white" placeholder="0" />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 border border-info/30 bg-info/5 p-3 rounded mt-2">
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Current Fuel State (Opt)</label><input type="number" inputMode="decimal" min="0" style={whiteBg} step="0.1" value={logFuel} onChange={e=>setLogFuel(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-info outline-none bg-white" placeholder="Quantity" /></div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Fuel Unit</label>
                  {editingId ? (
                    <>
                      <input type="text" value="Gallons" readOnly className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-gray-50 text-gray-600 cursor-not-allowed" />
                      <p className="text-[9px] text-gray-500 mt-1 leading-tight">Flight logs are stored in gallons. Enter the edited value in gallons.</p>
                    </>
                  ) : (
                    <select value={logFuelUnit} onChange={e=>{ const v = e.target.value as 'gallons' | 'lbs'; setLogFuelUnit(v); if (typeof window !== 'undefined') window.localStorage.setItem('aft_fuel_unit', v); }} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-info outline-none"><option value="gallons">Gallons</option><option value="lbs">Lbs</option></select>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1 h-4"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Initials <span className="text-danger">*</span></label></div>
                  <input type="text" style={whiteBg} maxLength={3} required value={logInitials} onChange={e=>setLogInitials(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm uppercase focus:border-info outline-none bg-white" placeholder="ABC" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1 h-4">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Reason (Opt)</label>
                    <button type="button" onClick={() => setShowLegend(true)} className="text-[10px] text-info hover:text-blue-600 flex items-center gap-1 font-bold uppercase"><Info size={10} /> Legend</button>
                  </div>
                  <select value={logReason} onChange={e=>setLogReason(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm bg-white focus:border-info outline-none"><option value="">Select...</option><option value="PE">PE</option><option value="BE">BE</option><option value="MX">MX</option><option value="T">T</option><option value="ADJ">ADJ</option></select>
                </div>
              </div>

              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Passengers (Opt)</label><input type="text" style={whiteBg} value={logPax} onChange={e=>setLogPax(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-info outline-none bg-white" placeholder="Names or notes..." /></div>
              <div className="pt-4"><PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Flight Log"}</PrimaryButton></div>
            </form>
          </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </>
  );
}

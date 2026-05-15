"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { processMxItem, getMxTextColor } from "@/lib/math";
import { getFuelWeightPerGallon } from "@/lib/constants";
import { parseFiniteNumber } from "@/lib/validation";
import { INPUT_WHITE_BG } from "@/lib/styles";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics, SystemSettings, AppTab, AppRole, AircraftRole, AircraftStatus } from "@/lib/types";
import useSWR, { useSWRConfig } from "swr";
import { PlaneTakeoff, MapPin, Droplet, Phone, Mail, Wrench, AlertTriangle, FileText, Clock, X, Trash2, Edit2, UserPlus, Loader2, Users, ChevronDown, Calendar, CheckCircle, PenSquare } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { useToast } from "@/components/ToastProvider";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { AircraftAvatarImg } from "@/components/AircraftAvatarImg";
import { ModalPortal } from "@/components/ModalPortal";
import { todayInZone } from "@/lib/pilotTime";
import { newIdempotencyKey, idempotencyHeader } from "@/lib/idempotencyClient";
import { formatAircraftType } from "@/lib/aircraftDisplay";

export default function SummaryTab({
  aircraft, setActiveTab, onNavigateToSquawks, role, aircraftRole, onDeleteAircraft, sysSettings, onEditAircraft, refreshData, session, aircraftStatus, userInitials
}: {
  aircraft: AircraftWithMetrics | null,
  setActiveTab: (tab: AppTab) => void,
  onNavigateToSquawks: () => void,
  role: AppRole,
  aircraftRole: AircraftRole | null,
  onDeleteAircraft: (id: string) => void,
  sysSettings: SystemSettings,
  onEditAircraft: () => void,
  refreshData: () => void,
  session: any,
  aircraftStatus: AircraftStatus,
  userInitials: string,
}) {
  const canEdit = role === 'admin' || aircraftRole === 'admin';

  // ─── Consolidated SWR hook ───
  // Replaces 7 parallel direct supabase.from() reads with a single
  // cookie-bearing call to /api/aircraft/[id]/summary. Server does the
  // parallel batch with the service-role key — no per-call GoTrue
  // mutex pressure on iOS. Per-resource sub-fields derived below.
  const { data: summary, mutate: mutateSummary } = useSWR<{
    mxItems: any[];
    openSquawks: Array<{ id: string; affects_airworthiness: boolean }>;
    latestNote: any | null;
    lastFlight: { occurred_at: string; created_at: string; initials: string | null } | null;
    upcomingReservations: any[];
    currentStatus: any | null;
    crew: Array<{ user_id: string; aircraft_role: string; email: string; initials: string; full_name: string }>;
  }>(
    aircraft ? swrKeys.summary(aircraft.id) : null,
    async () => {
      const res = await authFetch(`/api/aircraft/${aircraft!.id}/summary`);
      if (!res.ok) throw new Error(`Summary fetch failed: ${res.status}`);
      return res.json();
    },
  );
  const mutateCrew = mutateSummary; // legacy alias — crew is now part of the consolidated payload

  // mx "next due" derivation lives here because it depends on
  // aircraft.burnRate (in-memory state from useFleetData) — the server
  // doesn't have that, so we ship the raw rows and process locally.
  const mxData = useMemo(() => {
    if (!summary?.mxItems || summary.mxItems.length === 0) return null;
    if (!aircraft) return null;
    const activeItems = summary.mxItems.filter((item: any) => {
      if (item.tracking_type === 'time') return item.due_time !== null && item.due_time !== undefined;
      if (item.tracking_type === 'date') return item.due_date !== null && item.due_date !== undefined;
      return true;
    });
    if (activeItems.length === 0) return null;
    const currentEngineTime = aircraft.total_engine_time || 0;
    const processed = activeItems.map((item: any) =>
      processMxItem(item, currentEngineTime, aircraft.burnRate, aircraft.burnRateLow, aircraft.burnRateHigh)
    );
    processed.sort((a, b) => a.remaining - b.remaining);
    return processed[0];
  }, [summary?.mxItems, aircraft]);

  const squawkData = summary?.openSquawks ?? [];
  const latestNote = summary?.latestNote ?? null;
  const flightData = summary?.lastFlight ?? null;
  const reservationData = summary?.upcomingReservations ?? [];
  const currentStatus = summary?.currentStatus ?? null;
  const crewMembers = summary?.crew ?? [];

  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showCrewList, setShowCrewList] = useState(false);
  const crewListEndRef = useRef<HTMLDivElement>(null);
  const [showFuelModal, setShowFuelModal] = useState(false);
  const [fuelAmount, setFuelAmount] = useState("");
  const [fuelUnit, setFuelUnit] = useState<'gallons' | 'lbs'>('gallons');
  const [isSavingFuel, setIsSavingFuel] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<'admin' | 'pilot'>('pilot');
  const [isInviting, setIsInviting] = useState(false);
  // Sticky idempotency key for the pilot-invite POST. A network-blip
  // retry uses the same key so the same Supabase Auth invite isn't
  // fired twice (rate-limited or queued double-emails). Cleared on
  // form open + on successful send.
  const inviteIdemKeyRef = useRef<string | null>(null);
  const [changingRoleUserId, setChangingRoleUserId] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [isCrewUpdating, setIsCrewUpdating] = useState(false);
  // Quick Log — minimal flight entry from the Summary tab. Hours +
  // landings + cycles + purpose only; the full Flight Times tab is
  // for fuel, route, pax, etc.
  const [showQuickLogModal, setShowQuickLogModal] = useState(false);
  // Sticky-per-attempt idempotency key. Without this a double-tap on
  // "Log Flight" mints two keys and both inserts land; pre-fix gave
  // double Last-Flown updates on slow networks.
  const quickLogIdemKeyRef = useRef<string | null>(null);
  const [qlEngineHours, setQlEngineHours] = useState("");
  const [qlAirframeHours, setQlAirframeHours] = useState("");
  const [qlLandings, setQlLandings] = useState("1");
  const [qlCycles, setQlCycles] = useState("1");
  const [qlReason, setQlReason] = useState("");
  const [qlInitials, setQlInitials] = useState("");
  const [isSavingQuickLog, setIsSavingQuickLog] = useState(false);
  const { showSuccess, showError } = useToast();
  const { mutate: globalMutate } = useSWRConfig();
  useModalScrollLock(showDeleteModal || showFuelModal || showInviteModal || showNoteModal || showQuickLogModal);

  // Aircraft switch — close every modal + clear every form draft so a
  // QuickLog/Fuel/Invite/Delete that was composed against tail A can
  // never silently submit against tail B's id. Same pattern as the
  // CalendarTab/MaintenanceTab/etc. resets.
  useEffect(() => {
    setShowNoteModal(false);
    setShowDeleteModal(false);
    setShowCrewList(false);
    setShowFuelModal(false);
    setShowInviteModal(false);
    setShowQuickLogModal(false);
    setFuelAmount("");
    setFuelUnit('gallons');
    setInviteEmail("");
    setInviteRole('pilot');
    inviteIdemKeyRef.current = null;
    setChangingRoleUserId(null);
    setRemovingUserId(null);
    setQlEngineHours("");
    setQlAirframeHours("");
    setQlLandings("1");
    setQlCycles("1");
    setQlReason("");
    setQlInitials("");
  }, [aircraft?.id]);

  const handleFuelUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fuelAmount || !aircraft) return;
    // Client-side parse + bound so the user gets an immediate error
    // on bad input instead of waiting for a 400 round-trip.
    const parsed = parseFiniteNumber(fuelAmount, { min: 0, max: 10000 });
    if (parsed === undefined || parsed === null) {
      return showError("Enter a valid fuel amount (finite number between 0 and 10,000).");
    }
    setIsSavingFuel(true);
    const gallons = fuelUnit === 'lbs' ? parsed / getFuelWeightPerGallon(aircraft.engine_type) : parsed;
    // Route through the API so the validation + access check runs on
    // the server too. The direct supabase update path used to let a
    // DevTools caller splash NaN / Infinity into current_fuel_gallons
    // even when the UI validated correctly.
    try {
      const res = await authFetch('/api/aircraft/fuel', {
        method: 'POST',
        body: JSON.stringify({ aircraftId: aircraft.id, gallons }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Fuel update failed');
      }
      setShowFuelModal(false);
      setFuelAmount("");
      refreshData();
      showSuccess("Fuel state updated");
    } catch (err: any) {
      showError(err.message || 'Fuel update failed');
    }
    setIsSavingFuel(false);
  };

  const openQuickLog = () => {
    if (!aircraft) return;
    setQlEngineHours("");
    setQlAirframeHours("");
    setQlLandings("1");
    setQlCycles("1");
    setQlReason("");
    setQlInitials(userInitials || "");
    setShowQuickLogModal(true);
  };

  const handleQuickLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aircraft) return;

    const isTurb = aircraft.engine_type === 'Turbine';
    const hasAirframe = isTurb ? (aircraft.setup_aftt != null) : (aircraft.setup_hobbs != null);
    const initials = qlInitials.trim().toUpperCase();
    if (!initials) return showError("Initials are required.");

    const engineHours = parseFloat(qlEngineHours);
    if (!Number.isFinite(engineHours) || engineHours < 0) {
      return showError(isTurb ? "Enter a valid FTT." : "Enter a valid Tach.");
    }
    const prevEngine = aircraft.total_engine_time || 0;
    if (engineHours < prevEngine) {
      return showError(`New ${isTurb ? 'FTT' : 'Tach'} (${engineHours}) cannot be less than current (${prevEngine.toFixed(1)}).`);
    }

    let airframeHours: number | null = null;
    if (hasAirframe && qlAirframeHours.trim() !== "") {
      airframeHours = parseFloat(qlAirframeHours);
      if (!Number.isFinite(airframeHours) || airframeHours < 0) {
        return showError(isTurb ? "AFTT must be a finite non-negative number." : "Hobbs must be a finite non-negative number.");
      }
      const prevAirframe = aircraft.total_airframe_time;
      if (prevAirframe != null && airframeHours < prevAirframe) {
        return showError(`New ${isTurb ? 'AFTT' : 'Hobbs'} (${airframeHours}) cannot be less than current (${prevAirframe.toFixed(1)}).`);
      }
    }

    const landingsNum = qlLandings.trim() === '' ? 0 : parseInt(qlLandings);
    if (Number.isNaN(landingsNum) || landingsNum < 0) return showError("Landings must be zero or a positive whole number.");
    const cyclesNum = !isTurb ? 0 : (qlCycles.trim() === '' ? 0 : parseInt(qlCycles));
    if (isTurb && (Number.isNaN(cyclesNum) || cyclesNum < 0)) return showError("Engine cycles must be zero or a positive whole number.");

    const logData: Record<string, any> = {
      initials,
      landings: landingsNum,
      engine_cycles: isTurb ? cyclesNum : 0,
      trip_reason: qlReason.trim() || null,
    };
    if (isTurb) {
      logData.ftt = engineHours;
      if (airframeHours != null) logData.aftt = airframeHours;
    } else {
      logData.tach = engineHours;
      if (airframeHours != null) logData.hobbs = airframeHours;
    }

    setIsSavingQuickLog(true);
    if (!quickLogIdemKeyRef.current) quickLogIdemKeyRef.current = newIdempotencyKey();
    try {
      const res = await authFetch('/api/flight-logs', {
        method: 'POST',
        headers: idempotencyHeader(quickLogIdemKeyRef.current),
        body: JSON.stringify({ aircraftId: aircraft.id, logData, aircraftUpdate: {} }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Couldn't save the flight log.");
      }
      quickLogIdemKeyRef.current = null;
      setShowQuickLogModal(false);
      // Bust the summary cards' SWR keys so "Last Flown" + Next Mx Due
      // reflect the new log without waiting for a tab switch.
      globalMutate(swrKeys.summaryFlight(aircraft.id));
      globalMutate(swrKeys.summaryMx(aircraft.id));
      refreshData();
      showSuccess("Flight logged");
    } catch (err: any) {
      showError(err?.message || "Couldn't save the flight log.");
    } finally {
      setIsSavingQuickLog(false);
    }
  };

  const handleInvitePilot = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!aircraft) return;
    // Read at submit time via FormData so iOS autofill / 1Password
    // values that landed in the input without firing onChange still
    // make it through. Falls back to controlled state for non-autofill
    // submits. Same pattern as AuthScreen / AddAircraft / PilotOnboarding.
    const fd = new FormData(e.currentTarget);
    const trimmedEmail = String(fd.get('email') || inviteEmail).trim();
    if (!trimmedEmail) { showError('Enter an email address.'); return; }
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_RE.test(trimmedEmail)) { showError("That email doesn't look right."); return; }
    setIsInviting(true);
    try {
      if (!inviteIdemKeyRef.current) inviteIdemKeyRef.current = newIdempotencyKey();
      const res = await authFetch('/api/pilot-invite', { method: 'POST', headers: idempotencyHeader(inviteIdemKeyRef.current), body: JSON.stringify({ email: trimmedEmail, aircraftId: aircraft.id, aircraftRole: inviteRole }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't send the invitation");
      inviteIdemKeyRef.current = null;
      showSuccess(data.message || 'Invitation sent'); setShowInviteModal(false); setInviteEmail(""); setInviteRole('pilot'); mutateCrew(); refreshData();
    } catch (err: any) { showError(err.message); }
    setIsInviting(false);
  };

  const handleChangeRole = async (targetUserId: string, newRole: 'admin' | 'pilot') => {
    if (!aircraft) return;
    setIsCrewUpdating(true);
    try {
      const res = await authFetch('/api/aircraft-access', { method: 'PUT', body: JSON.stringify({ targetUserId, aircraftId: aircraft.id, newRole }) });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Couldn't update the role");
      showSuccess("Role updated"); setChangingRoleUserId(null); mutateCrew(); refreshData();
    } catch (err: any) { showError(err.message); }
    setIsCrewUpdating(false);
  };

  const handleRemovePilot = async (targetUserId: string) => {
    if (!aircraft) return;
    setIsCrewUpdating(true);
    try {
      const res = await authFetch('/api/aircraft-access', { method: 'DELETE', body: JSON.stringify({ targetUserId, aircraftId: aircraft.id }) });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Couldn't remove the pilot");
      showSuccess("Pilot removed"); setRemovingUserId(null); mutateCrew(); refreshData();
    } catch (err: any) { showError(err.message); }
    setIsCrewUpdating(false);
  };

  if (!aircraft) return null;

  const isTurbine = aircraft.engine_type === 'Turbine';
  const hasAirframeMeter = isTurbine ? (aircraft.setup_aftt != null) : (aircraft.setup_hobbs != null);
  const weightPerGal = getFuelWeightPerGallon(aircraft.engine_type);
  const fuelGals = aircraft.current_fuel_gallons || 0;
  const fuelLbs = Math.round(fuelGals * weightPerGal);

  const activeSquawks = squawkData || [];
  const nextMx = mxData || null;
  const lastFlight = flightData || null;
  const nextReservations = reservationData || [];

  // 'unknown' renders neutral while the first verdict is in flight or
  // after a fetch failure (see useGroundedStatus). Don't claim
  // airworthy when we haven't actually checked.
  const statusBorderColor = aircraftStatus === 'grounded' ? 'border-danger' : aircraftStatus === 'issues' ? 'border-mxOrange' : aircraftStatus === 'airworthy' ? 'border-success' : 'border-gray-300';
  const statusIconColor = aircraftStatus === 'grounded' ? 'text-danger' : aircraftStatus === 'issues' ? 'text-mxOrange' : aircraftStatus === 'airworthy' ? 'text-success' : 'text-gray-400';
  // Quick Log button picks up the same status hue as the card's
  // top-border + icon so the chrome reads as a single status surface.
  const statusButtonClasses = aircraftStatus === 'grounded'
    ? 'text-danger bg-red-50 border-red-200 hover:bg-red-100'
    : aircraftStatus === 'issues'
    ? 'text-mxOrange bg-orange-50 border-orange-200 hover:bg-orange-100'
    : aircraftStatus === 'airworthy'
    ? 'text-success bg-green-50 border-green-200 hover:bg-green-100'
    : 'text-gray-500 bg-gray-50 border-gray-200 hover:bg-gray-100';
  const mxTextColor = nextMx ? getMxTextColor(nextMx, sysSettings) : 'text-gray-500';

  const lastFlownLabel = (() => {
    if (!lastFlight) return null;
    const flightDate = new Date(lastFlight.occurred_at ?? lastFlight.created_at);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - flightDate.getTime()) / (1000 * 60 * 60 * 24));
    let timeAgo = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Yesterday' : `${diffDays} days ago`;
    return `${timeAgo} by ${lastFlight.initials || 'Unknown'}`;
  })();

  return (
    <div className="flex flex-col gap-4 animate-fade-in relative">
      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <ModalPortal>
        <div className="fixed inset-0 z-[10000] overflow-y-auto bg-black/80 animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowDeleteModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-danger animate-slide-up relative" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4"><h2 className="font-oswald text-2xl font-bold uppercase text-danger flex items-center gap-2"><AlertTriangle size={24} /> Delete Aircraft</h2><button onClick={() => setShowDeleteModal(false)} className="text-gray-400 hover:text-danger transition-colors"><X size={24}/></button></div>
            <p className="text-sm text-navy font-roboto mb-6 leading-relaxed"><strong>Heads up:</strong> no undo on this one.<br/><br/>Every flight log, maintenance item, squawk, and note tied to <strong className="text-danger">{aircraft.tail_number}</strong> goes with it.</p>
            <div className="flex gap-4">
              <button onClick={() => setShowDeleteModal(false)} className="flex-1 border border-gray-300 text-gray-600 font-bold uppercase tracking-widest text-[10px] py-3 rounded hover:bg-gray-50 transition-colors active:scale-95">Cancel</button>
              <button onClick={() => { setShowDeleteModal(false); onDeleteAircraft(aircraft.id); }} className="flex-1 bg-danger text-white font-bold uppercase tracking-widest text-[10px] py-3 rounded hover:bg-red-700 transition-colors shadow-md active:scale-95">Confirm Delete</button>
            </div>
          </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Quick Log modal */}
      {showQuickLogModal && (
        <ModalPortal>
        <div className="fixed inset-0 z-[10000] overflow-y-auto bg-black/80 animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowQuickLogModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-info animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3"><h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><PenSquare size={20} className="text-info" /> Quick Log Flight</h2><button onClick={() => setShowQuickLogModal(false)} className="text-gray-400 hover:text-danger"><X size={24} /></button></div>
            <p className="text-xs text-gray-500 font-roboto mb-4 leading-relaxed">Just hours, landings, and purpose. For fuel, route, and pax, head to the Flight Times tab.</p>
            <form onSubmit={handleQuickLog} className="space-y-3">
              <div className={`grid ${hasAirframeMeter ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">{isTurbine ? 'FTT' : 'Tach'} *</label>
                  <input type="number" inputMode="decimal" step="0.1" required value={qlEngineHours} onChange={e => setQlEngineHours(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-info outline-none" placeholder={(aircraft.total_engine_time || 0).toFixed(1)} />
                </div>
                {hasAirframeMeter && (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">{isTurbine ? 'AFTT' : 'Hobbs'}</label>
                    <input type="number" inputMode="decimal" step="0.1" value={qlAirframeHours} onChange={e => setQlAirframeHours(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-info outline-none" placeholder={(aircraft.total_airframe_time || 0).toFixed(1)} />
                  </div>
                )}
              </div>
              <div className={`grid ${isTurbine ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Landings</label>
                  <input type="number" inputMode="numeric" min="0" step="1" value={qlLandings} onChange={e => setQlLandings(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-info outline-none" />
                </div>
                {isTurbine && (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Cycles</label>
                    <input type="number" inputMode="numeric" min="0" step="1" value={qlCycles} onChange={e => setQlCycles(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-info outline-none" />
                  </div>
                )}
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Purpose</label>
                <select value={qlReason} onChange={e => setQlReason(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-info outline-none"><option value="">Select...</option><option value="PE">PE — Personal</option><option value="BE">BE — Business</option><option value="MX">MX — Maintenance</option><option value="T">T — Training</option><option value="ADJ">ADJ — Adjustment</option></select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Initials *</label>
                <input type="text" required value={qlInitials} onChange={e => setQlInitials(e.target.value.toUpperCase())} maxLength={4} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-info outline-none" />
              </div>
              <div className="pt-2"><PrimaryButton disabled={isSavingQuickLog}>{isSavingQuickLog ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : "Log Flight"}</PrimaryButton></div>
            </form>
          </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Fuel modal */}
      {showFuelModal && (
        <ModalPortal>
        <div className="fixed inset-0 z-[10000] overflow-y-auto bg-black/80 animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowFuelModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-blue-500 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4"><h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><Droplet size={20} className="text-blue-500" /> Update Fuel State</h2><button onClick={() => setShowFuelModal(false)} className="text-gray-400 hover:text-danger"><X size={24} /></button></div>
            <form onSubmit={handleFuelUpdate} className="space-y-4">
              <div className="grid grid-cols-5 gap-3">
                <div className="col-span-3"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Current Fuel *</label><input type="number" inputMode="decimal" step="0.1" required value={fuelAmount} onChange={e => setFuelAmount(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-500 outline-none" placeholder="Quantity" /></div>
                <div className="col-span-2"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Unit</label><select value={fuelUnit} onChange={e => setFuelUnit(e.target.value as any)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-500 outline-none"><option value="gallons">Gallons</option><option value="lbs">Lbs</option></select></div>
              </div>
              <div className="pt-2"><PrimaryButton disabled={isSavingFuel}>{isSavingFuel ? "Saving..." : "Update Fuel State"}</PrimaryButton></div>
            </form>
          </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Invite modal */}
      {showInviteModal && (
        <ModalPortal>
        <div className="fixed inset-0 z-[10000] overflow-y-auto bg-black/80 animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowInviteModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-info animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4"><h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><UserPlus size={20} className="text-info" /> Invite Pilot</h2><button onClick={() => setShowInviteModal(false)} className="text-gray-400 hover:text-danger"><X size={24} /></button></div>
            <p className="text-xs text-gray-500 mb-4">Give a pilot access to <strong>{aircraft.tail_number}</strong>.</p>
            <form onSubmit={handleInvitePilot} className="space-y-4" noValidate>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email Address *</label><input type="text" inputMode="email" name="email" autoComplete="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-info outline-none" placeholder="pilot@example.com" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Role for {aircraft.tail_number}</label><select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'admin' | 'pilot')} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-info outline-none"><option value="pilot">Aircraft Pilot</option><option value="admin">Aircraft Admin</option></select></div>
              <div className="pt-2"><PrimaryButton disabled={isInviting}>{isInviting ? <><Loader2 size={16} className="animate-spin" /> Sending...</> : "Send Invitation"}</PrimaryButton></div>
            </form>
          </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Hero section */}
      <div className="bg-white shadow-lg rounded-sm overflow-hidden">
        <div className="relative bg-slateGray flex items-center justify-center" style={{ aspectRatio: '16/9' }}>
          {aircraft.avatar_url ? <AircraftAvatarImg publicUrl={aircraft.avatar_url} alt="Aircraft Avatar" loading="eager" className="w-full h-full object-cover" /> : <PlaneTakeoff size={64} className="text-white/20" />}
          {canEdit && (
            <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
              <button onClick={() => setShowInviteModal(true)} className="bg-info text-white p-2.5 rounded-full shadow-[0_4px_10px_rgba(0,0,0,0.5)] hover:bg-blue-600 active:scale-95 transition-all" title="Invite Pilot"><UserPlus size={18} /></button>
              <button onClick={onEditAircraft} className="bg-slateGray text-white p-2.5 rounded-full shadow-[0_4px_10px_rgba(0,0,0,0.5)] hover:bg-gray-500 active:scale-95 transition-all" title="Edit Aircraft"><Edit2 size={18} /></button>
              <button onClick={() => setShowDeleteModal(true)} className="bg-danger text-white p-2.5 rounded-full shadow-[0_4px_10px_rgba(0,0,0,0.5)] hover:bg-red-700 active:scale-95 transition-all" title="Delete Aircraft"><Trash2 size={18} /></button>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex flex-col justify-end p-4 md:p-6 pointer-events-none">
            <h2 className="font-oswald text-4xl md:text-5xl font-bold text-white uppercase leading-none mb-1">{aircraft.tail_number}</h2>
            <p className="text-xs md:text-sm text-gray-200 font-bold uppercase tracking-widest">{formatAircraftType(aircraft)} • SN: {aircraft.serial_number || 'N/A'}</p>
          </div>
        </div>

        {/* Contact info */}
        <div className="bg-cream px-4 py-3 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-gray-200 pb-3">
            <div className="flex items-center gap-3 text-navy">
              <MapPin size={18} className="text-brandOrange shrink-0" />
              <div><span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">Home Base</span><span className="font-roboto font-bold text-sm uppercase">{aircraft.home_airport || 'NOT ASSIGNED'}</span></div>
            </div>
            {aircraft.home_airport && <a href={`https://www.airnav.com/airport/${aircraft.home_airport}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-brandOrange hover:text-orange-600 bg-orange-50 border border-orange-200 px-3 py-1.5 rounded transition-colors active:scale-95">AirNav</a>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col text-navy overflow-hidden">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">Main Contact</span>
              <span className="font-roboto font-bold text-xs block mb-1 truncate">{aircraft.main_contact || 'None'}</span>
              <div className="flex gap-2 mt-1">
                {aircraft.main_contact_phone && <a href={`tel:${aircraft.main_contact_phone}`} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-brandOrange hover:text-orange-600 bg-orange-50 border border-orange-200 px-2 py-1 rounded transition-colors active:scale-95"><Phone size={12} /> Call</a>}
                {aircraft.main_contact_email && <a href={`mailto:${aircraft.main_contact_email}`} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy hover:text-blue-800 bg-blue-50 border border-blue-200 px-2 py-1 rounded transition-colors active:scale-95"><Mail size={12} /> Email</a>}
              </div>
            </div>
            <div className="flex flex-col text-navy overflow-hidden border-l border-gray-200 pl-4">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">MX Contact</span>
              <span className="font-roboto font-bold text-xs block mb-1 truncate">{aircraft.mx_contact || 'None'}</span>
              <div className="flex gap-2 mt-1">
                {aircraft.mx_contact_phone && <a href={`tel:${aircraft.mx_contact_phone}`} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-brandOrange hover:text-orange-600 bg-orange-50 border border-orange-200 px-2 py-1 rounded transition-colors active:scale-95"><Phone size={12} /> Call</a>}
                {aircraft.mx_contact_email && <a href={`mailto:${aircraft.mx_contact_email}`} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy hover:text-blue-800 bg-blue-50 border border-blue-200 px-2 py-1 rounded transition-colors active:scale-95"><Mail size={12} /> Email</a>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Current Status Banner */}
      {currentStatus && (() => {
        if (currentStatus.type === 'ready_for_pickup') {
          return (
            <div onClick={() => setActiveTab('mx')} className="bg-green-50 shadow-lg border-2 border-green-300 rounded-sm p-3 flex items-center gap-3 cursor-pointer hover:shadow-xl active:scale-[0.98] transition-all">
              <div className="bg-[#56B94A] text-white p-2 rounded-full shrink-0"><CheckCircle size={16} /></div>
              <p className="text-sm font-roboto text-navy"><span className="font-bold">Ready for Pickup</span>{currentStatus.mx_contact_name ? ` — ${currentStatus.mx_contact_name} is done` : " — work's done"}</p>
            </div>
          );
        }
        if (currentStatus.type === 'maintenance') {
          const endDate = currentStatus.estimated_completion
            ? new Date(currentStatus.estimated_completion + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : null;
          return (
            <div onClick={() => setActiveTab('calendar')} className="bg-orange-50 shadow-lg border border-orange-200 rounded-sm p-3 flex items-center gap-3 cursor-pointer hover:shadow-xl active:scale-[0.98] transition-all">
              <div className="bg-mxOrange text-white p-2 rounded-full shrink-0"><Wrench size={16} /></div>
              <p className="text-sm font-roboto text-navy"><span className="font-bold">In Maintenance</span>{currentStatus.mx_contact_name ? ` with ${currentStatus.mx_contact_name}` : ''}{endDate ? ` until ${endDate}` : ''}</p>
            </div>
          );
        }
        const isYou = currentStatus.user_id === session?.user?.id;
        const endDt = new Date(currentStatus.end_time);
        const sameDay = new Date(currentStatus.start_time).toDateString() === endDt.toDateString();
        const endLabel = sameDay
          ? endDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          : endDt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const who = isYou ? 'You have' : `${currentStatus.pilot_name || currentStatus.pilot_initials} has`;
        return (
          <div onClick={() => setActiveTab('calendar')} className={`${isYou ? 'bg-emerald-50 border-emerald-200' : 'bg-sky-50 border-sky-200'} shadow-lg border rounded-sm p-3 flex items-center gap-3 cursor-pointer hover:shadow-xl active:scale-[0.98] transition-all`}>
            <div className={`${isYou ? 'bg-[#56B94A]' : 'bg-info'} text-white p-2 rounded-full shrink-0`}><Calendar size={16} /></div>
            <p className="text-sm font-roboto text-navy flex-1 min-w-0 break-words"><span className="font-bold">{who}</span> the airplane booked {sameDay ? 'until' : 'through'} {endLabel}</p>
          </div>
        );
      })()}

      {/* Flight Times — CLICKABLE: navigates to Times tab */}
      <div onClick={() => setActiveTab('times')} className={`bg-white shadow-lg rounded-sm p-4 border-t-4 ${statusBorderColor} flex flex-col cursor-pointer hover:shadow-xl transition-all active:scale-[0.98]`}>
        <div className="flex justify-between items-start mb-3 border-b border-gray-100 pb-3">
          <div className="flex flex-col gap-1"><div className="flex items-center gap-2"><Clock size={20} className={statusIconColor} /><h3 className="font-oswald text-xl font-bold uppercase text-navy m-0 leading-none">Flight Times</h3></div>{lastFlownLabel && <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-1">Last Flown: {lastFlownLabel}</span>}</div>
          <div className="flex items-center gap-2">
            <button onClick={(e) => { e.stopPropagation(); openQuickLog(); }} className={`text-[10px] font-bold uppercase tracking-widest border px-3 py-1.5 rounded active:scale-95 transition-all flex items-center gap-1.5 ${statusButtonClasses}`}><PenSquare size={12} /> Quick Log</button>
            <span className="text-[10px] font-bold uppercase tracking-widest bg-gray-100 px-2 py-1 rounded text-gray-600">{isTurbine ? 'TURBINE' : 'PISTON'}</span>
          </div>
        </div>
        <div className={`grid ${hasAirframeMeter ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
          {hasAirframeMeter && (
            <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">{isTurbine ? "Total Airframe" : "Current Hobbs"}</span><p className="text-3xl font-roboto font-bold text-navy">{aircraft.total_airframe_time?.toFixed(1) || 0} <span className="text-sm text-gray-400">hrs</span></p></div>
          )}
          <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">{isTurbine ? "Total Flight" : "Current Tach"}</span><p className="text-3xl font-roboto font-bold text-navy">{aircraft.total_engine_time?.toFixed(1) || 0} <span className="text-sm text-gray-400">hrs</span></p></div>
        </div>
      </div>

      {/* Fuel State */}
      <div className="bg-white shadow-lg rounded-sm p-4 border-t-4 border-blue-500 flex flex-col">
        <div className="flex justify-between items-start mb-3 border-b border-gray-100 pb-3">
          <div className="flex flex-col gap-1"><div className="flex items-center gap-2"><Droplet size={20} className="text-blue-500" /><h3 className="font-oswald text-xl font-bold uppercase text-navy m-0 leading-none">Current Fuel</h3></div>{aircraft.fuel_last_updated && <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-1">Updated: {new Date(aircraft.fuel_last_updated).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' })}</span>}</div>
          <div className="flex items-center gap-2"><button onClick={() => setShowFuelModal(true)} className="text-[10px] font-bold uppercase tracking-widest text-blue-500 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded hover:bg-blue-100 active:scale-95 transition-all">Update</button><span className="text-[10px] font-bold uppercase tracking-widest bg-gray-100 px-2 py-1 rounded text-gray-600">{isTurbine ? 'Jet-A' : 'AvGas'}</span></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">Quantity</span><p className="text-3xl font-roboto font-bold text-navy">{fuelGals.toFixed(1)} <span className="text-sm text-gray-400">Gal</span></p></div>
          <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">Weight</span><p className="text-3xl font-roboto font-bold text-navy">{fuelLbs.toLocaleString()} <span className="text-sm text-gray-400">Lbs</span></p></div>
        </div>
      </div>

      {/* Quick info cards */}
      <div className="grid grid-cols-1 gap-3">
        {nextReservations.length > 0 && (
          <div onClick={() => setActiveTab('calendar')} className="bg-white border border-emerald-200 shadow-sm rounded-sm p-4 flex gap-4 items-center cursor-pointer hover:bg-emerald-50 transition-colors active:scale-[0.98]">
            <div className="bg-emerald-50 p-3 rounded-full text-[#56B94A] shrink-0"><Calendar size={20}/></div>
            <div className="flex-1"><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Next Up</span>{nextReservations.map((r: any, idx: number) => { const startDate = new Date(r.start_time); return (<p key={idx} className="text-sm text-navy leading-tight mt-1"><strong>{r.pilot_initials || '—'}</strong> — {startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}{r.route && <span className="text-gray-400 ml-1.5">{r.route}</span>}</p>); })}</div>
          </div>
        )}

        <div onClick={() => setActiveTab('mx')} className={`bg-white border shadow-sm rounded-sm p-4 flex gap-4 items-center transition-colors cursor-pointer active:scale-[0.98] ${nextMx ? 'border-gray-200 hover:bg-orange-50' : 'border-gray-200 opacity-70 hover:bg-gray-50'}`}>
          <div className={`p-3 rounded-full shrink-0 ${nextMx ? 'bg-orange-50 text-mxOrange' : 'bg-gray-100 text-gray-400'}`}><Wrench size={20}/></div>
          <div className="flex-1"><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Next Mx Due</span>{nextMx ? (<><p className="text-sm font-bold text-navy leading-tight">{nextMx.item_name}</p><p className={`text-xs font-bold mt-0.5 ${mxTextColor}`}>{nextMx.dueText}</p></>) : <p className="text-sm font-bold text-gray-500 leading-tight">Nothing tracked yet</p>}</div>
        </div>

        <div onClick={onNavigateToSquawks} className={`bg-white border shadow-sm rounded-sm p-4 flex gap-4 items-center transition-colors cursor-pointer active:scale-[0.98] ${activeSquawks.length > 0 ? 'border-red-200 hover:bg-red-50' : 'border-gray-200 opacity-70 hover:bg-gray-50'}`}>
          <div className={`p-3 rounded-full shrink-0 ${activeSquawks.length > 0 ? 'bg-red-50 text-danger' : 'bg-gray-100 text-gray-400'}`}><AlertTriangle size={20}/></div>
          <div className="flex-1"><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Active Squawks</span>{activeSquawks.length > 0 ? (<><p className="text-sm font-bold text-navy leading-tight">{activeSquawks.length} Open Issue{activeSquawks.length > 1 ? 's' : ''}</p>{activeSquawks.some(sq => sq.affects_airworthiness) && <p className="text-xs font-bold text-danger mt-0.5">Aircraft Grounded</p>}</>) : <p className="text-sm font-bold text-gray-500 leading-tight">No Active Squawks</p>}</div>
        </div>

        {latestNote && (
          <>
            <div onClick={() => setShowNoteModal(true)} className="bg-white border border-gray-200 shadow-sm rounded-sm p-4 flex gap-4 items-center cursor-pointer hover:bg-blue-50 transition-colors active:scale-[0.98]">
              <div className="bg-blue-50 p-3 rounded-full text-navy shrink-0"><FileText size={20}/></div>
              <div className="flex-1"><div className="flex justify-between items-center mb-1"><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Latest Note</span><span className="text-[10px] text-gray-400 font-bold">{new Date(latestNote.created_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}</span></div><p className="text-sm font-bold text-navy leading-tight line-clamp-2">{latestNote.content}</p></div>
            </div>
            {showNoteModal && (
              <ModalPortal>
              <div className="fixed inset-0 z-[10000] overflow-y-auto bg-black/60 animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowNoteModal(false)}>
                <div className="flex min-h-full items-center justify-center p-4">
                <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-navy animate-slide-up relative" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => setShowNoteModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-danger"><X size={20}/></button>
                  <div className="mb-4"><span className="text-[10px] font-bold uppercase tracking-widest text-navy block">{latestNote.author_email || 'Pilot'}</span><span className="text-[10px] uppercase text-gray-400 font-bold">{new Date(latestNote.created_at).toLocaleString()}</span></div>
                  <p className="text-sm text-navy font-roboto whitespace-pre-wrap leading-relaxed">{latestNote.content}</p>
                </div>
                </div>
              </div>
              </ModalPortal>
            )}
          </>
        )}

        {/* Crew list */}
        <div className="bg-white border border-gray-200 shadow-sm rounded-sm overflow-hidden">
          <button onClick={() => { const willOpen = !showCrewList; setShowCrewList(willOpen); if (willOpen) setTimeout(() => crewListEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150); }} className="w-full p-4 flex gap-4 items-center cursor-pointer hover:bg-gray-50 transition-colors active:scale-[0.98]">
            <div className="bg-gray-100 p-3 rounded-full text-navy shrink-0"><Users size={20}/></div>
            <div className="flex-1 text-left"><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Assigned Users</span><p className="text-sm font-bold text-navy leading-tight">{crewMembers.length} Pilot{crewMembers.length !== 1 ? 's' : ''}</p></div>
            <ChevronDown size={18} className={`text-gray-400 transition-transform ${showCrewList ? 'rotate-180' : ''}`} />
          </button>
          {showCrewList && (
            <div className="border-t border-gray-100 animate-fade-in">
              {crewMembers.map((member: any) => {
                const isCurrentUser = member.user_id === session?.user?.id;
                const effectiveRole = (isCurrentUser && role === 'admin') ? 'admin' : member.aircraft_role;
                const roleLabel = effectiveRole === 'admin' ? 'Admin' : 'Pilot';
                const roleColor = effectiveRole === 'admin' ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600';
                return (
                  <div key={member.user_id} className="px-4 py-3 border-b border-gray-50 last:border-b-0 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-navy text-white flex items-center justify-center font-oswald font-bold text-sm shrink-0">{member.initials || '?'}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-navy truncate">{member.full_name || member.email}{isCurrentUser ? ' (you)' : ''}</p>
                      {member.full_name && <p className="text-[10px] text-gray-500 truncate">{member.email}</p>}
                      <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${roleColor} inline-block mt-1`}>{roleLabel}</span>
                    </div>
                    {canEdit && !isCurrentUser && (
                      <div className="flex gap-2 shrink-0">
                        {changingRoleUserId === member.user_id ? (
                          <div className="flex gap-1 animate-fade-in">
                            <button onClick={() => handleChangeRole(member.user_id, member.aircraft_role === 'admin' ? 'pilot' : 'admin')} disabled={isCrewUpdating} className="text-[8px] font-bold uppercase tracking-widest bg-info text-white px-2 py-1 rounded active:scale-95 disabled:opacity-50">{member.aircraft_role === 'admin' ? 'Make Pilot' : 'Make Admin'}</button>
                            <button onClick={() => setChangingRoleUserId(null)} className="text-[8px] font-bold uppercase tracking-widest text-gray-500 px-2 py-1 active:scale-95">Cancel</button>
                          </div>
                        ) : removingUserId === member.user_id ? (
                          <div className="flex gap-1 animate-fade-in">
                            <button onClick={() => handleRemovePilot(member.user_id)} disabled={isCrewUpdating} className="text-[8px] font-bold uppercase tracking-widest bg-danger text-white px-2 py-1 rounded active:scale-95 disabled:opacity-50">Remove</button>
                            <button onClick={() => setRemovingUserId(null)} className="text-[8px] font-bold uppercase tracking-widest text-gray-500 px-2 py-1 active:scale-95">Cancel</button>
                          </div>
                        ) : (
                          <><button onClick={() => setChangingRoleUserId(member.user_id)} className="text-gray-300 hover:text-info active:scale-95" title="Change Role"><Edit2 size={14}/></button><button onClick={() => setRemovingUserId(member.user_id)} className="text-gray-300 hover:text-danger active:scale-95" title="Remove"><X size={14}/></button></>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {canEdit && <button onClick={() => setShowInviteModal(true)} className="w-full px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-info hover:bg-blue-50 transition-colors active:scale-95 flex items-center justify-center gap-2"><UserPlus size={14} /> Invite Pilot</button>}
              <div ref={crewListEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

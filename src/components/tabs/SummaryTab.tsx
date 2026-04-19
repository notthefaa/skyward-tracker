"use client";

import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { processMxItem, getMxTextColor } from "@/lib/math";
import { getFuelWeightPerGallon } from "@/lib/constants";
import { parseFiniteNumber } from "@/lib/validation";
import { INPUT_WHITE_BG } from "@/lib/styles";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics, SystemSettings, AppTab, AppRole, AircraftRole } from "@/lib/types";
import useSWR from "swr";
import { PlaneTakeoff, MapPin, Droplet, Phone, Mail, Wrench, AlertTriangle, FileText, Clock, X, Trash2, Edit2, UserPlus, Loader2, Users, ChevronDown, Calendar, CheckCircle } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { useToast } from "@/components/ToastProvider";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { useSignedUrls } from "@/hooks/useSignedUrls";

export default function SummaryTab({ 
  aircraft, setActiveTab, onNavigateToSquawks, role, aircraftRole, onDeleteAircraft, sysSettings, onEditAircraft, refreshData, session
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
  session: any
}) {
  const canEdit = role === 'admin' || aircraftRole === 'admin';

  // ─── Split SWR hooks for granular cache invalidation ───
  const { data: mxData } = useSWR(
    aircraft ? swrKeys.summaryMx(aircraft.id) : null,
    async () => {
      const { data } = await supabase.from('aft_maintenance_items')
        .select('*').eq('aircraft_id', aircraft!.id);
      if (!data || data.length === 0) return null;
      const activeItems = data.filter((item: any) => {
        if (item.tracking_type === 'time') return item.due_time !== null && item.due_time !== undefined;
        if (item.tracking_type === 'date') return item.due_date !== null && item.due_date !== undefined;
        return true;
      });
      if (activeItems.length === 0) return null;
      const currentEngineTime = aircraft!.total_engine_time || 0;
      const processed = activeItems.map(item =>
        processMxItem(item, currentEngineTime, aircraft!.burnRate, aircraft!.burnRateLow, aircraft!.burnRateHigh)
      );
      processed.sort((a, b) => a.remaining - b.remaining);
      return processed[0];
    },
  );

  const { data: squawkData } = useSWR(
    aircraft ? swrKeys.summarySquawks(aircraft.id) : null,
    async () => {
      const { data } = await supabase.from('aft_squawks')
        .select('id, affects_airworthiness').eq('aircraft_id', aircraft!.id).eq('status', 'open');
      return data || [];
    },
  );

  const { data: latestNote } = useSWR(
    aircraft ? swrKeys.summaryNote(aircraft.id) : null,
    async () => {
      const { data } = await supabase.from('aft_notes')
        .select('*').eq('aircraft_id', aircraft!.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(1);
      return data?.[0] || null;
    },
  );

  const { data: flightData } = useSWR(
    aircraft ? swrKeys.summaryFlight(aircraft.id) : null,
    async () => {
      const { data } = await supabase.from('aft_flight_logs')
        .select('created_at, initials').eq('aircraft_id', aircraft!.id).order('created_at', { ascending: false }).limit(1);
      return data?.[0] || null;
    },
  );

  const { data: reservationData } = useSWR(
    aircraft ? swrKeys.summaryReservations(aircraft.id) : null,
    async () => {
      const { data } = await supabase.from('aft_reservations')
        .select('*').eq('aircraft_id', aircraft!.id).eq('status', 'confirmed')
        .gt('start_time', new Date().toISOString()).order('start_time').limit(2);
      return data || [];
    }
  );

  const { data: currentStatus } = useSWR(
    aircraft ? swrKeys.summaryCurrentStatus(aircraft.id) : null,
    async () => {
      const now = new Date().toISOString();
      // Active reservation (started but not ended)
      const { data: activeRes } = await supabase.from('aft_reservations')
        .select('pilot_name, pilot_initials, user_id, start_time, end_time')
        .eq('aircraft_id', aircraft!.id).eq('status', 'confirmed')
        .lte('start_time', now).gte('end_time', now)
        .order('start_time').limit(1);
      if (activeRes && activeRes.length > 0) return { type: 'reservation' as const, ...activeRes[0] };
      // Ready for pickup (no date constraint — always show if active)
      const { data: readyMx } = await supabase.from('aft_maintenance_events')
        .select('confirmed_date, estimated_completion, mx_contact_name')
        .eq('aircraft_id', aircraft!.id).eq('status', 'ready_for_pickup')
        .limit(1);
      if (readyMx && readyMx.length > 0) return { type: 'ready_for_pickup' as const, ...readyMx[0] };
      // Active maintenance block
      const today = new Date().toISOString().split('T')[0];
      const { data: activeMx } = await supabase.from('aft_maintenance_events')
        .select('confirmed_date, estimated_completion, mx_contact_name')
        .eq('aircraft_id', aircraft!.id).in('status', ['confirmed', 'in_progress'])
        .lte('confirmed_date', today)
        .gte('estimated_completion', today).limit(1);
      if (activeMx && activeMx.length > 0) return { type: 'maintenance' as const, ...activeMx[0] };
      return null;
    },
    { refreshInterval: 60000 }
  );

  const { data: crewMembers = [], mutate: mutateCrew } = useSWR(
    aircraft ? swrKeys.summaryCrew(aircraft.id) : null,
    async () => {
      const { data: accessData } = await supabase.from('aft_user_aircraft_access')
        .select('user_id, aircraft_role').eq('aircraft_id', aircraft!.id);
      if (!accessData || accessData.length === 0) return [];
      const userIds = accessData.map((a: any) => a.user_id);
      const { data: usersData } = await supabase.from('aft_user_roles')
        .select('user_id, email, initials, full_name').in('user_id', userIds);
      if (!usersData) return [];
      return accessData.map((access: any) => {
        const user = usersData.find((u: any) => u.user_id === access.user_id);
        return {
          user_id: access.user_id,
          aircraft_role: access.aircraft_role,
          email: user?.email || '',
          initials: user?.initials || '',
          full_name: user?.full_name || '',
        };
      });
    },
  );

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
  const [changingRoleUserId, setChangingRoleUserId] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [isCrewUpdating, setIsCrewUpdating] = useState(false);
  const { showSuccess, showError } = useToast();
  const resolve = useSignedUrls();
  useModalScrollLock(showDeleteModal || showFuelModal || showInviteModal || showNoteModal);

  const handleFuelUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fuelAmount || !aircraft) return;
    // parseFloat("Infinity") returns Infinity, which passes the old
    // truthy check and lands in current_fuel_gallons — poisoning the
    // fuel-burn projection forever. parseFiniteNumber rejects NaN /
    // ±Infinity and out-of-range values up front.
    const parsed = parseFiniteNumber(fuelAmount, { min: 0, max: 10000 });
    if (parsed === undefined || parsed === null) {
      return showError("Enter a valid fuel amount (finite number between 0 and 10,000).");
    }
    setIsSavingFuel(true);
    const gallons = fuelUnit === 'lbs' ? parsed / getFuelWeightPerGallon(aircraft.engine_type) : parsed;
    await supabase.from('aft_aircraft').update({ current_fuel_gallons: gallons, fuel_last_updated: new Date().toISOString() }).eq('id', aircraft.id);
    setShowFuelModal(false); setFuelAmount(""); setIsSavingFuel(false); refreshData(); showSuccess("Fuel state updated");
  };

  const handleInvitePilot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !aircraft) return;
    setIsInviting(true);
    try {
      const res = await authFetch('/api/pilot-invite', { method: 'POST', body: JSON.stringify({ email: inviteEmail, aircraftId: aircraft.id, aircraftRole: inviteRole }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to invite');
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
      if (!res.ok) throw new Error(resData.error || 'Failed to update role');
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
      if (!res.ok) throw new Error(resData.error || 'Failed to remove user');
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

  const isGrounded = (nextMx?.isExpired) || activeSquawks.some(sq => sq.affects_airworthiness);
  const hasIssues = activeSquawks.length > 0;
  const statusBorderColor = isGrounded ? 'border-[#CE3732]' : hasIssues ? 'border-[#F08B46]' : 'border-success';
  const statusIconColor = isGrounded ? 'text-[#CE3732]' : hasIssues ? 'text-[#F08B46]' : 'text-success';
  const mxTextColor = nextMx ? getMxTextColor(nextMx, sysSettings) : 'text-gray-500';

  const lastFlownLabel = (() => {
    if (!lastFlight) return null;
    const flightDate = new Date(lastFlight.created_at);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - flightDate.getTime()) / (1000 * 60 * 60 * 24));
    let timeAgo = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Yesterday' : `${diffDays} days ago`;
    return `${timeAgo} by ${lastFlight.initials || 'Unknown'}`;
  })();

  return (
    <div className="flex flex-col gap-4 animate-fade-in relative">
      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/80 animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowDeleteModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-[#CE3732] animate-slide-up relative" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4"><h2 className="font-oswald text-2xl font-bold uppercase text-[#CE3732] flex items-center gap-2"><AlertTriangle size={24} /> Delete Aircraft</h2><button onClick={() => setShowDeleteModal(false)} className="text-gray-400 hover:text-red-500 transition-colors"><X size={24}/></button></div>
            <p className="text-sm text-navy font-roboto mb-6 leading-relaxed"><strong>WARNING:</strong> This action is strictly irreversible.<br/><br/>Deleting <strong className="text-[#CE3732]">{aircraft.tail_number}</strong> will permanently erase all associated flight logs, maintenance items, squawks, and notes from the database.</p>
            <div className="flex gap-4">
              <button onClick={() => setShowDeleteModal(false)} className="flex-1 border border-gray-300 text-gray-600 font-bold uppercase tracking-widest text-[10px] py-3 rounded hover:bg-gray-50 transition-colors active:scale-95">Cancel</button>
              <button onClick={() => { setShowDeleteModal(false); onDeleteAircraft(aircraft.id); }} className="flex-1 bg-[#CE3732] text-white font-bold uppercase tracking-widest text-[10px] py-3 rounded hover:bg-red-700 transition-colors shadow-md active:scale-95">Confirm Delete</button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* Fuel modal */}
      {showFuelModal && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/80 animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowFuelModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-blue-500 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4"><h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><Droplet size={20} className="text-blue-500" /> Update Fuel State</h2><button onClick={() => setShowFuelModal(false)} className="text-gray-400 hover:text-red-500"><X size={24} /></button></div>
            <form onSubmit={handleFuelUpdate} className="space-y-4">
              <div className="grid grid-cols-5 gap-3">
                <div className="col-span-3"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Current Fuel *</label><input type="number" step="0.1" required value={fuelAmount} onChange={e => setFuelAmount(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-500 outline-none" placeholder="Quantity" /></div>
                <div className="col-span-2"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Unit</label><select value={fuelUnit} onChange={e => setFuelUnit(e.target.value as any)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-500 outline-none"><option value="gallons">Gallons</option><option value="lbs">Lbs</option></select></div>
              </div>
              <div className="pt-2"><PrimaryButton disabled={isSavingFuel}>{isSavingFuel ? "Saving..." : "Update Fuel State"}</PrimaryButton></div>
            </form>
          </div>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/80 animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowInviteModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-[#3AB0FF] animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4"><h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><UserPlus size={20} className="text-[#3AB0FF]" /> Invite Pilot</h2><button onClick={() => setShowInviteModal(false)} className="text-gray-400 hover:text-red-500"><X size={24} /></button></div>
            <p className="text-xs text-gray-500 mb-4">Invite a user to <strong>{aircraft.tail_number}</strong>.</p>
            <form onSubmit={handleInvitePilot} className="space-y-4">
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email Address *</label><input type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#3AB0FF] outline-none" placeholder="pilot@example.com" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Role for {aircraft.tail_number}</label><select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'admin' | 'pilot')} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#3AB0FF] outline-none"><option value="pilot">Aircraft Pilot</option><option value="admin">Aircraft Admin</option></select></div>
              <div className="pt-2"><PrimaryButton disabled={isInviting}>{isInviting ? <><Loader2 size={16} className="animate-spin" /> Sending...</> : "Send Invitation"}</PrimaryButton></div>
            </form>
          </div>
          </div>
        </div>
      )}

      {/* Hero section */}
      <div className="bg-white shadow-lg rounded-sm overflow-hidden">
        <div className="relative bg-slateGray flex items-center justify-center" style={{ aspectRatio: '16/9' }}>
          {aircraft.avatar_url ? <img src={resolve(aircraft.avatar_url) || aircraft.avatar_url} alt="Aircraft Avatar" className="w-full h-full object-cover" /> : <PlaneTakeoff size={64} className="text-white/20" />}
          {canEdit && (
            <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
              <button onClick={() => setShowInviteModal(true)} className="bg-[#3AB0FF] text-white p-2.5 rounded-full shadow-[0_4px_10px_rgba(0,0,0,0.5)] hover:bg-blue-600 active:scale-95 transition-all" title="Invite Pilot"><UserPlus size={18} /></button>
              <button onClick={onEditAircraft} className="bg-slateGray text-white p-2.5 rounded-full shadow-[0_4px_10px_rgba(0,0,0,0.5)] hover:bg-gray-500 active:scale-95 transition-all" title="Edit Aircraft"><Edit2 size={18} /></button>
              <button onClick={() => setShowDeleteModal(true)} className="bg-[#CE3732] text-white p-2.5 rounded-full shadow-[0_4px_10px_rgba(0,0,0,0.5)] hover:bg-red-700 active:scale-95 transition-all" title="Delete Aircraft"><Trash2 size={18} /></button>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex flex-col justify-end p-4 md:p-6 pointer-events-none">
            <h2 className="font-oswald text-4xl md:text-5xl font-bold text-white uppercase leading-none mb-1">{aircraft.tail_number}</h2>
            <p className="text-xs md:text-sm text-gray-200 font-bold uppercase tracking-widest">{aircraft.aircraft_type} • SN: {aircraft.serial_number || 'N/A'}</p>
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
              <p className="text-sm font-roboto text-navy"><span className="font-bold">Ready for Pickup</span>{currentStatus.mx_contact_name ? ` — ${currentStatus.mx_contact_name} has completed all work` : ' — All maintenance work is complete'}</p>
            </div>
          );
        }
        if (currentStatus.type === 'maintenance') {
          const endDate = currentStatus.estimated_completion
            ? new Date(currentStatus.estimated_completion + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : null;
          return (
            <div onClick={() => setActiveTab('calendar')} className="bg-orange-50 shadow-lg border border-orange-200 rounded-sm p-3 flex items-center gap-3 cursor-pointer hover:shadow-xl active:scale-[0.98] transition-all">
              <div className="bg-[#F08B46] text-white p-2 rounded-full shrink-0"><Wrench size={16} /></div>
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
            <div className={`${isYou ? 'bg-[#56B94A]' : 'bg-[#3AB0FF]'} text-white p-2 rounded-full shrink-0`}><Calendar size={16} /></div>
            <p className="text-sm font-roboto text-navy flex-1 min-w-0 break-words"><span className="font-bold">{who}</span> the airplane booked {sameDay ? 'until' : 'through'} {endLabel}</p>
          </div>
        );
      })()}

      {/* Flight Times — CLICKABLE: navigates to Times tab */}
      <div onClick={() => setActiveTab('times')} className={`bg-white shadow-lg rounded-sm p-4 border-t-4 ${statusBorderColor} flex flex-col cursor-pointer hover:shadow-xl transition-all active:scale-[0.98]`}>
        <div className="flex justify-between items-start mb-3 border-b border-gray-100 pb-3">
          <div className="flex flex-col gap-1"><div className="flex items-center gap-2"><Clock size={20} className={statusIconColor} /><h3 className="font-oswald text-xl font-bold uppercase text-navy m-0 leading-none">Flight Times</h3></div>{lastFlownLabel && <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-1">Last Flown: {lastFlownLabel}</span>}</div>
          <span className="text-[10px] font-bold uppercase tracking-widest bg-gray-100 px-2 py-1 rounded text-gray-600">{isTurbine ? 'TURBINE' : 'PISTON'}</span>
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
          <div className={`p-3 rounded-full shrink-0 ${nextMx ? 'bg-orange-50 text-[#F08B46]' : 'bg-gray-100 text-gray-400'}`}><Wrench size={20}/></div>
          <div className="flex-1"><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Next Mx Due</span>{nextMx ? (<><p className="text-sm font-bold text-navy leading-tight">{nextMx.item_name}</p><p className={`text-xs font-bold mt-0.5 ${mxTextColor}`}>{nextMx.dueText}</p></>) : <p className="text-sm font-bold text-gray-500 leading-tight">No Maintenance Tracked</p>}</div>
        </div>

        <div onClick={onNavigateToSquawks} className={`bg-white border shadow-sm rounded-sm p-4 flex gap-4 items-center transition-colors cursor-pointer active:scale-[0.98] ${activeSquawks.length > 0 ? 'border-red-200 hover:bg-red-50' : 'border-gray-200 opacity-70 hover:bg-gray-50'}`}>
          <div className={`p-3 rounded-full shrink-0 ${activeSquawks.length > 0 ? 'bg-red-50 text-[#CE3732]' : 'bg-gray-100 text-gray-400'}`}><AlertTriangle size={20}/></div>
          <div className="flex-1"><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Active Squawks</span>{activeSquawks.length > 0 ? (<><p className="text-sm font-bold text-navy leading-tight">{activeSquawks.length} Open Issue{activeSquawks.length > 1 ? 's' : ''}</p>{activeSquawks.some(sq => sq.affects_airworthiness) && <p className="text-xs font-bold text-[#CE3732] mt-0.5">Aircraft Grounded</p>}</>) : <p className="text-sm font-bold text-gray-500 leading-tight">No Active Squawks</p>}</div>
        </div>

        {latestNote && (
          <>
            <div onClick={() => setShowNoteModal(true)} className="bg-white border border-gray-200 shadow-sm rounded-sm p-4 flex gap-4 items-center cursor-pointer hover:bg-blue-50 transition-colors active:scale-[0.98]">
              <div className="bg-blue-50 p-3 rounded-full text-navy shrink-0"><FileText size={20}/></div>
              <div className="flex-1"><div className="flex justify-between items-center mb-1"><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Latest Note</span><span className="text-[10px] text-gray-400 font-bold">{new Date(latestNote.created_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}</span></div><p className="text-sm font-bold text-navy leading-tight line-clamp-2">{latestNote.content}</p></div>
            </div>
            {showNoteModal && (
              <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowNoteModal(false)}>
                <div className="flex min-h-full items-center justify-center p-4">
                <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-navy animate-slide-up relative" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => setShowNoteModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500"><X size={20}/></button>
                  <div className="mb-4"><span className="text-[10px] font-bold uppercase tracking-widest text-navy block">{latestNote.author_email || 'Pilot'}</span><span className="text-[10px] uppercase text-gray-400 font-bold">{new Date(latestNote.created_at).toLocaleString()}</span></div>
                  <p className="text-sm text-navy font-roboto whitespace-pre-wrap leading-relaxed">{latestNote.content}</p>
                </div>
                </div>
              </div>
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
                            <button onClick={() => handleChangeRole(member.user_id, member.aircraft_role === 'admin' ? 'pilot' : 'admin')} disabled={isCrewUpdating} className="text-[8px] font-bold uppercase tracking-widest bg-[#3AB0FF] text-white px-2 py-1 rounded active:scale-95 disabled:opacity-50">{member.aircraft_role === 'admin' ? 'Make Pilot' : 'Make Admin'}</button>
                            <button onClick={() => setChangingRoleUserId(null)} className="text-[8px] font-bold uppercase tracking-widest text-gray-500 px-2 py-1 active:scale-95">Cancel</button>
                          </div>
                        ) : removingUserId === member.user_id ? (
                          <div className="flex gap-1 animate-fade-in">
                            <button onClick={() => handleRemovePilot(member.user_id)} disabled={isCrewUpdating} className="text-[8px] font-bold uppercase tracking-widest bg-[#CE3732] text-white px-2 py-1 rounded active:scale-95 disabled:opacity-50">Remove</button>
                            <button onClick={() => setRemovingUserId(null)} className="text-[8px] font-bold uppercase tracking-widest text-gray-500 px-2 py-1 active:scale-95">Cancel</button>
                          </div>
                        ) : (
                          <><button onClick={() => setChangingRoleUserId(member.user_id)} className="text-gray-300 hover:text-[#3AB0FF] active:scale-95" title="Change Role"><Edit2 size={14}/></button><button onClick={() => setRemovingUserId(member.user_id)} className="text-gray-300 hover:text-[#CE3732] active:scale-95" title="Remove"><X size={14}/></button></>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {canEdit && <button onClick={() => setShowInviteModal(true)} className="w-full px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] hover:bg-blue-50 transition-colors active:scale-95 flex items-center justify-center gap-2"><UserPlus size={14} /> Invite Pilot</button>}
              <div ref={crewListEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

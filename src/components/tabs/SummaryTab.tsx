"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { processMxItem } from "@/lib/math";
import type { AircraftWithMetrics, SystemSettings, AppRole, AircraftRole, AppTab } from "@/lib/types";
import useSWR from "swr";
import { 
  Fuel, Clock, Wrench, AlertTriangle, ChevronRight, Trash2, Edit2, 
  UserPlus, X, Loader2, MapPin
} from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import Toast from "@/components/Toast";

export default function SummaryTab({ 
  aircraft, setActiveTab, role, aircraftRole, onDeleteAircraft, sysSettings, onEditAircraft, refreshData, session
}: { 
  aircraft: AircraftWithMetrics | null, 
  setActiveTab: (tab: AppTab) => void, 
  role: AppRole, 
  aircraftRole: AircraftRole | null,
  onDeleteAircraft: (id: string) => void, 
  sysSettings: SystemSettings,
  onEditAircraft: () => void,
  refreshData: () => void,
  session: any
}) {
  const canEdit = role === 'admin' || aircraftRole === 'admin';

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<'admin' | 'pilot'>('pilot');
  const [isInviting, setIsInviting] = useState(false);

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Toast
  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);
  const showSuccess = (msg: string) => { setToastMessage(msg); setShowToast(true); };

  // Fetch summary data
  const { data: summaryData } = useSWR(
    aircraft ? `summary-${aircraft.id}` : null,
    async () => {
      const [mxRes, sqRes, notesRes, resvRes] = await Promise.all([
        supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraft!.id).eq('is_required', true).order('due_date').order('due_time'),
        supabase.from('aft_squawks').select('*').eq('aircraft_id', aircraft!.id).eq('status', 'open').order('created_at', { ascending: false }).limit(3),
        supabase.from('aft_notes').select('*').eq('aircraft_id', aircraft!.id).order('created_at', { ascending: false }).limit(1),
        supabase.from('aft_reservations').select('*').eq('aircraft_id', aircraft!.id).eq('status', 'confirmed').gte('end_time', new Date().toISOString()).order('start_time').limit(3),
      ]);
      return {
        mxItems: mxRes.data || [],
        squawks: sqRes.data || [],
        latestNote: notesRes.data?.[0] || null,
        upcomingReservations: resvRes.data || [],
      };
    }
  );

  const mxItems = summaryData?.mxItems || [];
  const squawks = summaryData?.squawks || [];
  const latestNote = summaryData?.latestNote;
  const upcomingReservations = summaryData?.upcomingReservations || [];

  const handleInvitePilot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !aircraft) return;
    setIsInviting(true);

    try {
      const res = await authFetch('/api/pilot-invite', {
        method: 'POST',
        body: JSON.stringify({
          email: inviteEmail,
          aircraftId: aircraft.id,
          aircraftRole: inviteRole,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to invite');
      showSuccess(data.message || 'Invitation sent');
      setShowInviteModal(false);
      setInviteEmail("");
      setInviteRole('pilot');
      refreshData();
    } catch (err: any) {
      alert(err.message);
    }
    setIsInviting(false);
  };

  const handleDelete = () => {
    if (!aircraft) return;
    onDeleteAircraft(aircraft.id);
    setShowDeleteConfirm(false);
  };

  if (!aircraft) return null;

  const isTurbine = aircraft.engine_type === 'Turbine';
  const currentEngineTime = aircraft.total_engine_time || 0;

  // Process MX items for the summary cards
  const processedMx = mxItems.map((item: any) => {
    const processed = processMxItem(item, currentEngineTime, aircraft.burnRate, aircraft.burnRateLow, aircraft.burnRateHigh);
    return { ...item, ...processed };
  });

  const nextDueMx = processedMx
    .filter((p: any) => !p.isExpired)
    .sort((a: any, b: any) => a.remaining - b.remaining)
    .slice(0, 3);

  const expiredMx = processedMx.filter((p: any) => p.isExpired);

  return (
    <>
      <Toast message={toastMessage} show={showToast} onDismiss={() => setShowToast(false)} />

      {/* ─── HERO / AIRCRAFT CARD ─── */}
      <div className="bg-cream shadow-lg rounded-sm overflow-hidden border-t-4 border-navy mb-6">
        {/* Avatar */}
        {aircraft.avatar_url && (
          <div className="w-full h-40 md:h-48 bg-navy overflow-hidden">
            <img src={aircraft.avatar_url} alt={aircraft.tail_number} className="w-full h-full object-cover" />
          </div>
        )}
        
        <div className="p-4 md:p-6">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="font-oswald text-3xl font-bold uppercase text-navy leading-none">{aircraft.tail_number}</h2>
              <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mt-1">{aircraft.aircraft_type} • {aircraft.engine_type}</p>
              {aircraft.serial_number && <p className="text-[10px] text-gray-400 mt-0.5">S/N: {aircraft.serial_number}</p>}
              {aircraft.home_airport && (
                <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1"><MapPin size={10} /> {aircraft.home_airport}</p>
              )}
            </div>

            {/* ─── ACTION BUTTONS (hero area) ─── */}
            {canEdit && (
              <div className="flex gap-2 shrink-0">
                <button onClick={() => setShowInviteModal(true)} className="bg-[#3AB0FF] text-white rounded-full p-2 hover:bg-blue-600 transition-colors active:scale-95" title="Invite Pilot">
                  <UserPlus size={16} />
                </button>
                <button onClick={onEditAircraft} className="bg-slateGray text-white rounded-full p-2 hover:bg-gray-500 transition-colors active:scale-95" title="Edit Aircraft">
                  <Edit2 size={16} />
                </button>
                <button onClick={() => setShowDeleteConfirm(true)} className="bg-[#CE3732] text-white rounded-full p-2 hover:bg-red-700 transition-colors active:scale-95" title="Delete Aircraft">
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Times Summary */}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-white border border-gray-200 rounded p-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">{isTurbine ? 'AFTT' : 'Hobbs'}</span>
              <span className="font-oswald text-xl font-bold text-navy">{aircraft.total_airframe_time?.toFixed(1) || '0.0'}</span>
            </div>
            <div className="bg-white border border-gray-200 rounded p-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">{isTurbine ? 'FTT' : 'Tach'}</span>
              <span className="font-oswald text-xl font-bold text-navy">{aircraft.total_engine_time?.toFixed(1) || '0.0'}</span>
            </div>
          </div>

          {/* Fuel State */}
          {aircraft.current_fuel_gallons !== null && aircraft.current_fuel_gallons !== undefined && (
            <div className="mt-3 bg-white border border-gray-200 rounded p-3 flex items-center gap-3">
              <Fuel size={18} className="text-[#3AB0FF]" />
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Fuel State</span>
                <span className="font-oswald font-bold text-navy">{aircraft.current_fuel_gallons.toFixed(1)} gal</span>
                {aircraft.fuel_last_updated && <span className="text-[10px] text-gray-400 ml-2">({new Date(aircraft.fuel_last_updated).toLocaleDateString()})</span>}
              </div>
            </div>
          )}

          {/* Burn Rate */}
          {aircraft.burnRate > 0 && (
            <div className="mt-3 bg-white border border-gray-200 rounded p-3 flex items-center gap-3">
              <Clock size={18} className="text-[#F08B46]" />
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Avg Burn Rate</span>
                <span className="font-oswald font-bold text-navy">{aircraft.burnRate.toFixed(2)} hrs/day</span>
                <span className="text-[10px] text-gray-400 ml-2">(Confidence: {aircraft.confidenceScore}%)</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── UPCOMING RESERVATIONS ─── */}
      {upcomingReservations.length > 0 && (
        <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#3AB0FF] mb-6">
          <div className="flex justify-between items-end mb-4">
            <h3 className="font-oswald text-lg font-bold uppercase text-navy leading-none">Upcoming</h3>
            <button onClick={() => setActiveTab('calendar')} className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] hover:underline flex items-center gap-1">View Calendar <ChevronRight size={12} /></button>
          </div>
          <div className="space-y-2">
            {upcomingReservations.map((r: any) => (
              <div key={r.id} className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded">
                <div className="bg-[#3AB0FF]/10 text-[#3AB0FF] font-oswald font-bold text-sm w-10 h-10 rounded flex items-center justify-center shrink-0">
                  {new Date(r.start_time).getDate()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-navy truncate">{r.pilot_initials || '—'} — {new Date(r.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} to {new Date(r.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
                  {r.route && <p className="text-[10px] text-gray-500 truncate">{r.route}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── EXPIRED MX (if any) ─── */}
      {expiredMx.length > 0 && (
        <div className="bg-red-50 shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#CE3732] mb-6">
          <h3 className="font-oswald text-lg font-bold uppercase text-[#CE3732] mb-4 leading-none flex items-center gap-2"><AlertTriangle size={18} /> Expired Items</h3>
          <div className="space-y-2">
            {expiredMx.map((item: any) => (
              <button key={item.id} onClick={() => setActiveTab('mx')} className="w-full text-left p-3 bg-white border border-red-200 rounded hover:bg-red-50 transition-colors active:scale-[0.99]">
                <span className="font-oswald font-bold text-[#CE3732] text-sm uppercase">{item.item_name}</span>
                <span className="text-xs text-gray-600 block mt-1">{item.dueText}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── NEXT DUE MX ─── */}
      {nextDueMx.length > 0 && (
        <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#F08B46] mb-6">
          <div className="flex justify-between items-end mb-4">
            <h3 className="font-oswald text-lg font-bold uppercase text-navy leading-none">Next Due</h3>
            <button onClick={() => setActiveTab('mx')} className="text-[10px] font-bold uppercase tracking-widest text-[#F08B46] hover:underline flex items-center gap-1">View All <ChevronRight size={12} /></button>
          </div>
          <div className="space-y-2">
            {nextDueMx.map((item: any) => (
              <div key={item.id} className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded">
                <Wrench size={16} className="text-[#F08B46] shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-oswald font-bold text-navy text-sm uppercase block truncate">{item.item_name}</span>
                  <span className="text-xs text-gray-600">{item.dueText}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── ACTIVE SQUAWKS ─── */}
      {squawks.length > 0 && (
        <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#CE3732] mb-6">
          <div className="flex justify-between items-end mb-4">
            <h3 className="font-oswald text-lg font-bold uppercase text-navy leading-none">Active Squawks</h3>
            <button onClick={() => setActiveTab('mx')} className="text-[10px] font-bold uppercase tracking-widest text-[#CE3732] hover:underline flex items-center gap-1">View All <ChevronRight size={12} /></button>
          </div>
          <div className="space-y-2">
            {squawks.map((sq: any) => (
              <div key={sq.id} className={`p-3 border rounded ${sq.affects_airworthiness ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200'}`}>
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className={sq.affects_airworthiness ? 'text-[#CE3732] shrink-0 mt-0.5' : 'text-[#F08B46] shrink-0 mt-0.5'} />
                  <div className="min-w-0">
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${sq.affects_airworthiness ? 'text-[#CE3732]' : 'text-[#F08B46]'}`}>{sq.affects_airworthiness ? 'AOG' : 'Open'} — {sq.location}</span>
                    <p className="text-xs text-gray-700 mt-1 line-clamp-2">{sq.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── LATEST NOTE ─── */}
      {latestNote && (
        <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-gray-400 mb-6">
          <div className="flex justify-between items-end mb-4">
            <h3 className="font-oswald text-lg font-bold uppercase text-navy leading-none">Latest Note</h3>
            <button onClick={() => setActiveTab('notes')} className="text-[10px] font-bold uppercase tracking-widest text-[#525659] hover:underline flex items-center gap-1">View All <ChevronRight size={12} /></button>
          </div>
          <div className="bg-white border border-gray-200 rounded p-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{latestNote.author_initials || 'Pilot'} — {new Date(latestNote.created_at).toLocaleDateString()}</p>
            <p className="text-sm text-navy line-clamp-3">{latestNote.content}</p>
          </div>
        </div>
      )}

      {/* ─── CONTACTS ─── */}
      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-gray-300 mb-6">
        <h3 className="font-oswald text-lg font-bold uppercase text-navy mb-4 leading-none">Contacts</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {aircraft.main_contact && (
            <div className="bg-white border border-gray-200 rounded p-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Primary Contact</span>
              <span className="font-bold text-navy text-sm">{aircraft.main_contact}</span>
              {aircraft.main_contact_phone && <p className="text-xs text-gray-500 mt-0.5">{aircraft.main_contact_phone}</p>}
              {aircraft.main_contact_email && <a href={`mailto:${aircraft.main_contact_email}`} className="text-xs text-[#3AB0FF] block mt-0.5">{aircraft.main_contact_email}</a>}
            </div>
          )}
          {aircraft.mx_contact && (
            <div className="bg-white border border-gray-200 rounded p-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">MX Contact</span>
              <span className="font-bold text-navy text-sm">{aircraft.mx_contact}</span>
              {aircraft.mx_contact_phone && <p className="text-xs text-gray-500 mt-0.5">{aircraft.mx_contact_phone}</p>}
              {aircraft.mx_contact_email && <a href={`mailto:${aircraft.mx_contact_email}`} className="text-xs text-[#3AB0FF] block mt-0.5">{aircraft.mx_contact_email}</a>}
            </div>
          )}
        </div>
      </div>

      {/* ─── INVITE PILOT MODAL ─── */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowInviteModal(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-[#3AB0FF] animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><UserPlus size={20} className="text-[#3AB0FF]" /> Invite Pilot</h2>
              <button onClick={() => setShowInviteModal(false)} className="text-gray-400 hover:text-red-500"><X size={24} /></button>
            </div>
            <p className="text-xs text-gray-500 mb-4">Invite a user to <strong>{aircraft.tail_number}</strong>. They will be assigned to this aircraft and can log flights, report squawks, and make reservations.</p>
            <form onSubmit={handleInvitePilot} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email Address *</label>
                <input type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#3AB0FF] outline-none bg-white" placeholder="pilot@example.com" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Role for {aircraft.tail_number}</label>
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'admin' | 'pilot')} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#3AB0FF] outline-none bg-white">
                  <option value="pilot">Tailnumber Pilot — Can fly, log, and reserve</option>
                  <option value="admin">Tailnumber Admin — Can also edit aircraft and manage users</option>
                </select>
              </div>
              <div className="pt-2">
                <PrimaryButton disabled={isInviting}>
                  {isInviting ? <><Loader2 size={16} className="animate-spin" /> Sending...</> : "Send Invitation"}
                </PrimaryButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── DELETE CONFIRMATION ─── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-[#CE3732] animate-slide-up" onClick={e => e.stopPropagation()}>
            <h3 className="font-oswald text-xl font-bold uppercase text-navy mb-3">Delete {aircraft.tail_number}?</h3>
            <p className="text-sm text-gray-600 mb-6">This will permanently delete <strong>{aircraft.tail_number}</strong> and all its flight logs, maintenance items, squawks, notes, and reservations. This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 border border-gray-300 text-gray-600 font-oswald font-bold uppercase tracking-widest py-3 rounded text-xs active:scale-95">Cancel</button>
              <button onClick={handleDelete} className="flex-1 bg-[#CE3732] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded text-xs active:scale-95">Delete Aircraft</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

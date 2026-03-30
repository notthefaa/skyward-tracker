import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { processMxItem, getMxTextColor } from "@/lib/math";
import type { AircraftWithMetrics, SystemSettings, AppTab, AppRole, AircraftRole } from "@/lib/types";
import useSWR from "swr";
import { PlaneTakeoff, MapPin, Droplet, Phone, Mail, Wrench, AlertTriangle, FileText, Clock, X, Trash2, Edit2, UserPlus, Loader2 } from "lucide-react";
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

  const { data, isLoading } = useSWR(
    aircraft ? `summary-${aircraft.id}` : null,
    async () => {
      const [mxRes, sqRes, noteRes] = await Promise.all([
        supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraft!.id),
        supabase.from('aft_squawks').select('*').eq('aircraft_id', aircraft!.id).eq('status', 'open').order('created_at', { ascending: false }),
        supabase.from('aft_notes').select('*').eq('aircraft_id', aircraft!.id).order('created_at', { ascending: false }).limit(1)
      ]);

      let nextMx = null;
      if (mxRes.data && mxRes.data.length > 0) {
        const currentEngineTime = aircraft!.total_engine_time || 0;
        const processedMx = (mxRes.data || []).map(item => 
          processMxItem(item, currentEngineTime, aircraft!.burnRate, aircraft!.burnRateLow, aircraft!.burnRateHigh)
        );
        processedMx.sort((a, b) => a.remaining - b.remaining);
        nextMx = processedMx[0];
      }

      return {
        nextMx,
        activeSquawks: sqRes.data || [],
        latestNote: noteRes.data?.[0] || null
      };
    }
  );

  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<'admin' | 'pilot'>('pilot');
  const [isInviting, setIsInviting] = useState(false);

  // Toast
  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);
  const showSuccess = (msg: string) => { setToastMessage(msg); setShowToast(true); };

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

  if (!aircraft) return null;

  const isTurbine = aircraft.engine_type === 'Turbine';
  const weightPerGal = isTurbine ? 6.7 : 6.0;
  const fuelGals = aircraft.current_fuel_gallons || 0;
  const fuelLbs = Math.round(fuelGals * weightPerGal);

  const activeSquawks = data?.activeSquawks || [];
  const nextMx = data?.nextMx;
  const latestNote = data?.latestNote;

  const isGrounded = nextMx?.isExpired || activeSquawks.some(sq => sq.affects_airworthiness);
  const hasIssues = activeSquawks.length > 0;
  const statusBorderColor = isGrounded ? 'border-[#CE3732]' : hasIssues ? 'border-[#F08B46]' : 'border-success';
  const statusIconColor = isGrounded ? 'text-[#CE3732]' : hasIssues ? 'text-[#F08B46]' : 'text-success';

  const mxTextColor = nextMx ? getMxTextColor(nextMx, sysSettings) : 'text-gray-500';

  return (
    <div className="flex flex-col gap-4 animate-fade-in relative">

      <Toast message={toastMessage} show={showToast} onDismiss={() => setShowToast(false)} />
      
      {showDeleteModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 animate-fade-in" onClick={() => setShowDeleteModal(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-[#CE3732] animate-slide-up relative" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-oswald text-2xl font-bold uppercase text-[#CE3732] flex items-center gap-2"><AlertTriangle size={24} /> Delete Aircraft</h2>
              <button onClick={() => setShowDeleteModal(false)} className="text-gray-400 hover:text-red-500 transition-colors"><X size={24}/></button>
            </div>
            <p className="text-sm text-navy font-roboto mb-6 leading-relaxed">
              <strong>WARNING:</strong> This action is strictly irreversible.<br/><br/>
              Deleting <strong className="text-[#CE3732]">{aircraft.tail_number}</strong> will permanently erase all associated flight logs, maintenance items, squawks, and notes from the database.
            </p>
            <div className="flex gap-4">
              <button onClick={() => setShowDeleteModal(false)} className="flex-1 border border-gray-300 text-gray-600 font-bold uppercase tracking-widest text-[10px] py-3 rounded hover:bg-gray-50 transition-colors active:scale-95">Cancel</button>
              <button onClick={() => { setShowDeleteModal(false); onDeleteAircraft(aircraft.id); }} className="flex-1 bg-[#CE3732] text-white font-bold uppercase tracking-widest text-[10px] py-3 rounded hover:bg-red-700 transition-colors shadow-md active:scale-95">Confirm Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── INVITE PILOT MODAL ─── */}
      {showInviteModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 animate-fade-in" onClick={() => setShowInviteModal(false)}>
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

      <div className="bg-white shadow-lg rounded-sm overflow-hidden">
        <div className="relative h-40 md:h-56 bg-slateGray flex items-center justify-center">
          {aircraft.avatar_url ? <img src={aircraft.avatar_url} alt="Aircraft Avatar" className="w-full h-full object-cover" /> : <PlaneTakeoff size={64} className="text-white/20" />}
          
          {/* ─── OVERLAY BUTTONS: Invite, Edit, Delete (stacked vertically) ─── */}
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

        <div className="bg-cream px-4 py-3 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-gray-200 pb-3">
            <div className="flex items-center gap-3 text-navy">
              <MapPin size={18} className="text-brandOrange shrink-0" />
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">Home Base</span>
                <span className="font-roboto font-bold text-sm uppercase">{aircraft.home_airport || 'NOT ASSIGNED'}</span>
              </div>
            </div>
            {aircraft.home_airport && (
              <a href={`https://www.airnav.com/airport/${aircraft.home_airport}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-brandOrange hover:text-orange-600 bg-orange-50 border border-orange-200 px-3 py-1.5 rounded transition-colors active:scale-95">AirNav</a>
            )}
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

      <div className={`bg-white shadow-lg rounded-sm p-4 border-t-4 ${statusBorderColor} flex flex-col`}>
        <div className="flex justify-between items-center mb-3 border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2"><Clock size={20} className={statusIconColor} /><h3 className="font-oswald text-xl font-bold uppercase text-navy m-0 leading-none">Flight Times</h3></div>
          <span className="text-[10px] font-bold uppercase tracking-widest bg-gray-100 px-2 py-1 rounded text-gray-600">{isTurbine ? 'TURBINE' : 'PISTON'}</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">{isTurbine ? "Total Airframe" : "Current Hobbs"}</span>
            <p className="text-3xl font-roboto font-bold text-navy">{aircraft.total_airframe_time?.toFixed(1) || 0} <span className="text-sm text-gray-400">hrs</span></p>
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">{isTurbine ? "Total Flight" : "Current Tach"}</span>
            <p className="text-3xl font-roboto font-bold text-navy">{aircraft.total_engine_time?.toFixed(1) || 0} <span className="text-sm text-gray-400">hrs</span></p>
          </div>
        </div>
      </div>

      <div className="bg-white shadow-lg rounded-sm p-4 border-t-4 border-blue-500 flex flex-col">
        <div className="flex justify-between items-start mb-3 border-b border-gray-100 pb-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2"><Droplet size={20} className="text-blue-500" /><h3 className="font-oswald text-xl font-bold uppercase text-navy m-0 leading-none">Current Fuel</h3></div>
            {aircraft.fuel_last_updated && <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-1">Updated: {new Date(aircraft.fuel_last_updated).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' })}</span>}
          </div>
          <div className="text-right"><span className="text-[10px] font-bold uppercase tracking-widest bg-gray-100 px-2 py-1 rounded text-gray-600 block">{isTurbine ? 'Jet-A (6.7 lbs/gal)' : 'AvGas (6.0 lbs/gal)'}</span></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">Quantity</span><p className="text-3xl font-roboto font-bold text-navy">{fuelGals.toFixed(1)} <span className="text-sm text-gray-400">Gal</span></p></div>
          <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">Weight</span><p className="text-3xl font-roboto font-bold text-navy">{fuelLbs.toLocaleString()} <span className="text-sm text-gray-400">Lbs</span></p></div>
        </div>
      </div>

      {!isLoading && (
        <div className="grid grid-cols-1 gap-3 mb-6">
          <div onClick={() => setActiveTab('mx')} className={`bg-white border shadow-sm rounded-sm p-4 flex gap-4 items-center transition-colors cursor-pointer active:scale-[0.98] ${nextMx ? 'border-gray-200 hover:bg-orange-50' : 'border-gray-200 opacity-70 hover:bg-gray-50'}`}>
            <div className={`p-3 rounded-full shrink-0 ${nextMx ? 'bg-orange-50 text-[#F08B46]' : 'bg-gray-100 text-gray-400'}`}><Wrench size={20}/></div>
            <div className="flex-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Next Mx Due</span>
              {nextMx ? (
                <><p className="text-sm font-bold text-navy leading-tight">{nextMx.item_name}</p><p className={`text-xs font-bold mt-0.5 ${mxTextColor}`}>{nextMx.dueText}</p></>
              ) : <p className="text-sm font-bold text-gray-500 leading-tight">No Maintenance Tracked</p>}
            </div>
          </div>

          <div onClick={() => setActiveTab('mx')} className={`bg-white border shadow-sm rounded-sm p-4 flex gap-4 items-center transition-colors cursor-pointer active:scale-[0.98] ${activeSquawks.length > 0 ? 'border-red-200 hover:bg-red-50' : 'border-gray-200 opacity-70 hover:bg-gray-50'}`}>
            <div className={`p-3 rounded-full shrink-0 ${activeSquawks.length > 0 ? 'bg-red-50 text-[#CE3732]' : 'bg-gray-100 text-gray-400'}`}><AlertTriangle size={20}/></div>
            <div className="flex-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Active Squawks</span>
              {activeSquawks.length > 0 ? (
                <><p className="text-sm font-bold text-navy leading-tight">{activeSquawks.length} Open Issue{activeSquawks.length > 1 ? 's' : ''}</p>{activeSquawks.some(sq => sq.affects_airworthiness) && <p className="text-xs font-bold text-[#CE3732] mt-0.5">Aircraft Grounded</p>}</>
              ) : <p className="text-sm font-bold text-gray-500 leading-tight">No Active Squawks</p>}
            </div>
          </div>

          {latestNote && (
            <>
              <div onClick={() => setShowNoteModal(true)} className="bg-white border border-gray-200 shadow-sm rounded-sm p-4 flex gap-4 items-center cursor-pointer hover:bg-blue-50 transition-colors active:scale-[0.98]">
                <div className="bg-blue-50 p-3 rounded-full text-navy shrink-0"><FileText size={20}/></div>
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Latest Note</span>
                    <span className="text-[10px] text-gray-400 font-bold">{new Date(latestNote.created_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}</span>
                  </div>
                  <p className="text-sm font-bold text-navy leading-tight line-clamp-2">{latestNote.content}</p>
                </div>
              </div>
              {showNoteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-fade-in" onClick={() => setShowNoteModal(false)}>
                  <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-navy animate-slide-up relative" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setShowNoteModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500"><X size={20}/></button>
                    <div className="mb-4">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-navy block">{latestNote.author_email || 'Pilot'}</span>
                      <span className="text-[10px] uppercase text-gray-400 font-bold">{new Date(latestNote.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-navy font-roboto whitespace-pre-wrap leading-relaxed">{latestNote.content}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

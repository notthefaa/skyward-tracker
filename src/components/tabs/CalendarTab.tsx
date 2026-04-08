"use client";

import { useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import type { AircraftWithMetrics, Reservation, AircraftRole, AppRole } from "@/lib/types";
import useSWR from "swr";
import { Calendar, ChevronLeft, ChevronRight, Plus, X, Clock, MapPin, Plane, Wrench, Loader2, Users, Edit2 } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import CalendarDashboard from "@/components/tabs/CalendarDashboard";
import { useToast } from "@/components/ToastProvider";

type CalendarView = 'month' | 'week' | 'day';

const wb: React.CSSProperties = { backgroundColor: '#ffffff' };

export default function CalendarTab({
  aircraft, session, aircraftRole, role
}: {
  aircraft: AircraftWithMetrics | null,
  session: any,
  aircraftRole: AircraftRole | null,
  role: AppRole
}) {
  const [view, setView] = useState<CalendarView>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [bookingStartDate, setBookingStartDate] = useState("");
  const [bookingStartTime, setBookingStartTime] = useState("08:00");
  const [bookingEndDate, setBookingEndDate] = useState("");
  const [bookingEndTime, setBookingEndTime] = useState("17:00");
  const [bookingTitle, setBookingTitle] = useState("");
  const [bookingRoute, setBookingRoute] = useState("");
  const [bookingRepeat, setBookingRepeat] = useState<'none' | 'weekly' | 'biweekly'>('none');
  const [bookingRepeatCount, setBookingRepeatCount] = useState(4);

  const [editingReservationId, setEditingReservationId] = useState<string | null>(null);

  const [showMxBlockForm, setShowMxBlockForm] = useState(false);
  const [mxBlockStartDate, setMxBlockStartDate] = useState("");
  const [mxBlockEndDate, setMxBlockEndDate] = useState("");
  const [mxBlockNotes, setMxBlockNotes] = useState("");

  const { showSuccess, showError, showWarning } = useToast();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchKey = aircraft ? `calendar-${aircraft.id}-${currentDate.getFullYear()}-${currentDate.getMonth()}` : null;

  const { data: calendarData, mutate } = useSWR(fetchKey, async () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const rangeStart = new Date(year, month - 1, 1).toISOString();
    const rangeEnd = new Date(year, month + 2, 0).toISOString();
    const [resRes, mxRes] = await Promise.all([
      supabase.from('aft_reservations').select('*').eq('aircraft_id', aircraft!.id).eq('status', 'confirmed').gte('end_time', rangeStart).lte('start_time', rangeEnd).order('start_time'),
      supabase.from('aft_maintenance_events').select('confirmed_date, estimated_completion, status, mx_contact_name').eq('aircraft_id', aircraft!.id).in('status', ['confirmed', 'in_progress'])
    ]);
    return {
      reservations: (resRes.data || []) as Reservation[],
      mxBlocks: (mxRes.data || []).filter((e: any) => e.confirmed_date).map((e: any) => ({
        start: new Date(e.confirmed_date + 'T00:00:00'),
        end: e.estimated_completion ? new Date(e.estimated_completion + 'T23:59:59') : new Date(new Date(e.confirmed_date + 'T00:00:00').getTime() + 24 * 60 * 60 * 1000),
        label: `Maintenance${e.mx_contact_name ? ' — ' + e.mx_contact_name : ''}`,
      })),
    };
  }, { revalidateOnMount: true });

  const reservations = calendarData?.reservations || [];
  const mxBlocks = calendarData?.mxBlocks || [];

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const daysInMonth = monthEnd.getDate();
  const startDayOfWeek = monthStart.getDay();

  const navigate = (dir: number) => {
    const d = new Date(currentDate);
    if (view === 'month') d.setMonth(d.getMonth() + dir);
    else if (view === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCurrentDate(d);
  };

  const getWeekDates = () => {
    const d = new Date(currentDate); const day = d.getDay(); const start = new Date(d); start.setDate(d.getDate() - day);
    const dates: Date[] = []; for (let i = 0; i < 7; i++) { const dd = new Date(start); dd.setDate(start.getDate() + i); dates.push(dd); } return dates;
  };

  const getEventsForDate = (date: Date) => {
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
    return {
      reservations: reservations.filter(r => new Date(r.start_time) <= dayEnd && new Date(r.end_time) >= dayStart),
      mxBlocks: mxBlocks.filter((m: any) => m.start <= dayEnd && m.end >= dayStart),
    };
  };

  const isMxBlockedDate = (date: Date) => { const s = new Date(date); s.setHours(0,0,0,0); const e = new Date(date); e.setHours(23,59,59,999); return mxBlocks.some((m: any) => m.start <= e && m.end >= s); };
  const isFullDayOrMultiDay = (r: Reservation) => { const s = new Date(r.start_time); const e = new Date(r.end_time); if (s.toDateString() !== e.toDateString()) return true; return (e.getTime() - s.getTime()) / (1000*60*60) >= 12; };

  const getReservationDaySpan = (r: Reservation, weekDates: Date[]) => {
    const rStart = new Date(r.start_time); rStart.setHours(0,0,0,0); const rEnd = new Date(r.end_time); rEnd.setHours(0,0,0,0);
    const weekStart = new Date(weekDates[0]); weekStart.setHours(0,0,0,0); const weekEnd = new Date(weekDates[6]); weekEnd.setHours(23,59,59,999);
    const visibleStart = rStart < weekStart ? weekStart : rStart; const visibleEnd = rEnd > weekEnd ? weekEnd : rEnd;
    const startIdx = weekDates.findIndex(d => d.toDateString() === visibleStart.toDateString());
    const endIdx = weekDates.findIndex(d => d.toDateString() === visibleEnd.toDateString());
    return { startIdx: Math.max(0, startIdx), endIdx: Math.max(0, endIdx === -1 ? 6 : endIdx) };
  };

  const openBookingForm = (date?: Date) => {
    const d = date || new Date(); const dateStr = d.toISOString().split('T')[0];
    setEditingReservationId(null);
    setBookingStartDate(dateStr); setBookingEndDate(dateStr); setBookingStartTime("08:00"); setBookingEndTime("17:00"); setBookingTitle(""); setBookingRoute(""); setBookingRepeat('none'); setBookingRepeatCount(4); setShowBookingForm(true);
  };

  const openEditForm = (r: Reservation) => {
    const start = new Date(r.start_time);
    const end = new Date(r.end_time);
    setEditingReservationId(r.id);
    setBookingStartDate(start.toISOString().split('T')[0]);
    setBookingStartTime(start.toTimeString().slice(0, 5));
    setBookingEndDate(end.toISOString().split('T')[0]);
    setBookingEndTime(end.toTimeString().slice(0, 5));
    setBookingTitle(r.title || "");
    setBookingRoute(r.route || "");
    setShowBookingForm(true);
  };

  const handleSubmitReservation = async () => {
    if (!bookingStartDate || !bookingEndDate) return showWarning("Please select dates.");
    setIsSubmitting(true);
    try {
      const startTime = new Date(`${bookingStartDate}T${bookingStartTime}:00`).toISOString();
      const endTime = new Date(`${bookingEndDate}T${bookingEndTime}:00`).toISOString();

      if (editingReservationId) {
        const res = await authFetch('/api/reservations', { method: 'PUT', body: JSON.stringify({ reservationId: editingReservationId, startTime, endTime, title: bookingTitle || null, route: bookingRoute || null }) });
        const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Failed');
        await mutate(); setShowBookingForm(false); showSuccess("Reservation updated");
      } else {
        const recurrence = bookingRepeat !== 'none' ? { type: bookingRepeat, count: bookingRepeatCount } : undefined;
        const res = await authFetch('/api/reservations', { method: 'POST', body: JSON.stringify({ aircraftId: aircraft!.id, startTime, endTime, title: bookingTitle || null, route: bookingRoute || null, recurrence }) });
        const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Failed');
        await mutate(); setShowBookingForm(false);
        if (data.skipped > 0) {
          showWarning(`${data.created} of ${data.created + data.skipped} bookings created. ${data.skipped} skipped due to conflicts.`);
        } else if (data.created > 1) {
          showSuccess(`${data.created} recurring reservations confirmed`);
        } else {
          showSuccess("Reservation confirmed");
        }
      }
    } catch (err: any) { showError(err.message); }
    setIsSubmitting(false);
  };

  const handleCancelReservation = async (id: string) => {
    setIsSubmitting(true);
    try { const res = await authFetch('/api/reservations', { method: 'DELETE', body: JSON.stringify({ reservationId: id }) }); if (!res.ok) { const d = await res.json(); throw new Error(d.error); } await mutate(); setCancellingId(null); showSuccess("Reservation cancelled"); } catch (err: any) { showError(err.message); } setIsSubmitting(false);
  };

  const canAdmin = role === 'admin' || aircraftRole === 'admin';

  const openMxBlockForm = (date?: Date) => {
    const d = date || new Date(); const dateStr = d.toISOString().split('T')[0];
    setMxBlockStartDate(dateStr); setMxBlockEndDate(dateStr); setMxBlockNotes(""); setShowMxBlockForm(true);
  };

  const handleCreateMxBlock = async () => {
    if (!mxBlockStartDate) return showWarning("Please select a start date.");
    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/mx-events/block', { method: 'POST', body: JSON.stringify({ aircraftId: aircraft!.id, startDate: mxBlockStartDate, endDate: mxBlockEndDate || mxBlockStartDate, notes: mxBlockNotes || null }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Failed');
      await mutate(); setShowMxBlockForm(false); showSuccess("Maintenance block created");
    } catch (err: any) { showError(err.message); }
    setIsSubmitting(false);
  };

  const canManageReservation = (r: Reservation) => r.user_id === session?.user?.id || aircraftRole === 'admin';
  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const formatDateShort = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (!aircraft) return null;

  const monthLabel = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const weekLabel = (() => { const d = getWeekDates(); return `${d[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${d[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`; })();
  const dayLabel = currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const ReservationCard = ({ r }: { r: Reservation }) => {
    const isOwn = r.user_id === session?.user?.id; const multiDay = isFullDayOrMultiDay(r);
    return (
      <div className={`rounded border transition-all p-4 ${multiDay ? 'bg-sky-50 border-sky-200' : isOwn ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200'}`}>
        <div className="flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${multiDay ? 'bg-[#3AB0FF]/15 text-[#3AB0FF]' : isOwn ? 'bg-[#56B94A]/15 text-[#56B94A]' : 'bg-gray-100 text-gray-600'}`}>{r.pilot_initials || '—'}</span>
              <span className="text-xs text-gray-500 font-roboto">{r.pilot_name}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-navy font-bold font-roboto">
              <Clock size={13} className="text-gray-400 shrink-0" />
              {multiDay ? <span>{formatDateShort(r.start_time)} {formatTime(r.start_time)} — {formatDateShort(r.end_time)} {formatTime(r.end_time)}</span> : <span>{formatTime(r.start_time)} – {formatTime(r.end_time)}</span>}
            </div>
            {r.title && <p className="text-xs text-gray-600 mt-1.5 font-roboto">{r.title}</p>}
            {r.route && <p className="text-xs text-gray-500 mt-1 flex items-center gap-1 font-roboto"><MapPin size={11} className="text-[#56B94A] shrink-0" /> {r.route}</p>}
          </div>
          {canManageReservation(r) && cancellingId !== r.id && (
            <div className="flex items-center gap-1 shrink-0 ml-3">
              <button onClick={() => openEditForm(r)} className="text-gray-300 hover:text-[#3AB0FF] active:scale-95 p-1" title="Edit"><Edit2 size={14} /></button>
              <button onClick={() => setCancellingId(r.id)} className="text-gray-300 hover:text-[#CE3732] active:scale-95 p-1" title="Cancel"><X size={16} /></button>
            </div>
          )}
        </div>
        {cancellingId === r.id && (
          <div className="mt-3 pt-3 border-t border-gray-200 flex gap-2 animate-fade-in">
            <button onClick={() => setCancellingId(null)} className="flex-1 border border-gray-300 text-gray-600 font-oswald font-bold py-2 rounded text-[10px] uppercase tracking-widest active:scale-95">Keep</button>
            <button onClick={() => handleCancelReservation(r.id)} disabled={isSubmitting} className="flex-1 bg-[#CE3732] text-white font-oswald font-bold py-2 rounded text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-50">{isSubmitting ? "..." : "Cancel Booking"}</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {aircraft && session && <CalendarDashboard aircraft={aircraft} session={session} />}
      <div className={`mb-2 ${canAdmin ? 'grid grid-cols-2 gap-2' : ''}`}>
        <button onClick={() => openBookingForm()} className="w-full bg-[#56B94A] text-white font-oswald tracking-widest uppercase py-3 px-4 rounded hover:bg-opacity-90 active:scale-95 transition-all duration-150 ease-out flex justify-center items-center gap-2 text-sm"><Plus size={18} /> Reserve Aircraft</button>
        {canAdmin && <button onClick={() => openMxBlockForm()} className="w-full bg-[#F08B46] text-white font-oswald tracking-widest uppercase py-3 px-4 rounded hover:bg-opacity-90 active:scale-95 transition-all duration-150 ease-out flex justify-center items-center gap-2 text-sm"><Wrench size={18} /> Block for MX</button>}
      </div>

      <div className="bg-cream shadow-lg rounded-sm border-t-4 border-[#56B94A] mb-6">
        <div className="bg-white border-b border-gray-100 px-4 py-3 md:px-6">
          <div className="flex justify-between items-center">
            <div className="flex gap-1">{(['month', 'week', 'day'] as CalendarView[]).map(v => (<button key={v} onClick={() => setView(v)} className={`text-[10px] font-oswald font-bold uppercase tracking-widest px-3.5 py-1.5 rounded transition-colors active:scale-95 ${view === v ? 'bg-[#56B94A] text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{v}</button>))}</div>
            <div className="flex items-center gap-1">
              <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-navy active:scale-95 p-1.5 rounded hover:bg-gray-100 transition-colors"><ChevronLeft size={18} /></button>
              <button onClick={() => setCurrentDate(new Date())} className="text-[10px] font-oswald font-bold uppercase tracking-widest text-[#56B94A] hover:bg-emerald-50 px-3 py-1.5 rounded transition-colors">Today</button>
              <button onClick={() => navigate(1)} className="text-gray-400 hover:text-navy active:scale-95 p-1.5 rounded hover:bg-gray-100 transition-colors"><ChevronRight size={18} /></button>
            </div>
          </div>
          <h2 className="font-oswald text-xl font-bold uppercase text-navy mt-3 leading-none">{view === 'month' ? monthLabel : view === 'week' ? weekLabel : dayLabel}</h2>
        </div>

        <div className="p-4 md:p-6">
          {/* MONTH VIEW */}
          {view === 'month' && (
            <div>
              <div className="grid grid-cols-7 mb-2">{['S','M','T','W','T','F','S'].map((d,i) => (<div key={i} className="text-[10px] font-oswald font-bold uppercase tracking-widest text-gray-400 text-center py-1">{d}</div>))}</div>
              <div className="grid grid-cols-7 gap-px bg-gray-200 rounded overflow-hidden border border-gray-200">
                {Array.from({ length: startDayOfWeek }).map((_,i) => (<div key={`e-${i}`} className="bg-gray-50/80 min-h-[56px] md:min-h-[68px]" />))}
                {Array.from({ length: daysInMonth }).map((_,i) => {
                  const day = i+1; const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
                  const events = getEventsForDate(date); const isToday = date.toDateString() === today.toDateString(); const isPast = date < today; const hasMx = events.mxBlocks.length > 0;
                  return (
                    <button key={day} onClick={() => { setCurrentDate(date); setView('day'); }} className={`min-h-[56px] md:min-h-[68px] p-1 md:p-1.5 text-left transition-colors relative flex flex-col ${hasMx ? 'bg-orange-50' : isPast ? 'bg-gray-50/60' : 'bg-white'} ${isToday ? 'ring-2 ring-[#56B94A] ring-inset z-[1]' : ''} hover:bg-emerald-50/50`}>
                      <span className={`text-xs font-bold leading-none ${isToday ? 'bg-[#56B94A] text-white w-5 h-5 rounded-full flex items-center justify-center' : isPast ? 'text-gray-400' : 'text-navy'}`}>{day}</span>
                      <div className="mt-auto pt-0.5 space-y-0.5 w-full overflow-hidden">
                        {events.reservations.slice(0,2).map((r,idx) => { const multi = isFullDayOrMultiDay(r); return (<div key={idx} className={`text-[7px] font-bold px-1 py-px rounded truncate ${multi ? 'bg-[#3AB0FF] text-white' : 'bg-[#56B94A]/20 text-[#56B94A]'}`}>{r.pilot_initials || '—'}{!multi ? ` ${formatTime(r.start_time)}` : ''}</div>); })}
                        {events.reservations.length > 2 && <div className="text-[7px] font-bold text-gray-400 px-1">+{events.reservations.length - 2}</div>}
                        {hasMx && <div className="text-[7px] font-bold text-white bg-[#F08B46] px-1 py-px rounded truncate">MX</div>}
                      </div>
                    </button>
                  );
                })}
                {(() => { const t = startDayOfWeek + daysInMonth; const r = t % 7; if (r === 0) return null; return Array.from({ length: 7-r }).map((_,i) => (<div key={`t-${i}`} className="bg-gray-50/80 min-h-[56px] md:min-h-[68px]" />)); })()}
              </div>
              <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-100">
                <div className="flex items-center gap-1.5"><div className="w-3 h-2 rounded bg-[#3AB0FF]" /><span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Multi-Day</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-2 rounded bg-[#56B94A]" /><span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Day Trip</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-2 rounded bg-[#F08B46]" /><span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Maintenance</span></div>
              </div>
            </div>
          )}

          {/* WEEK VIEW */}
          {view === 'week' && (() => {
            const weekDates = getWeekDates();
            const multiDayRes = reservations.filter(r => { const ws = new Date(weekDates[0]); ws.setHours(0,0,0,0); const we = new Date(weekDates[6]); we.setHours(23,59,59,999); return isFullDayOrMultiDay(r) && new Date(r.start_time) <= we && new Date(r.end_time) >= ws; });
            return (
              <div className="space-y-0">
                {multiDayRes.length > 0 && (<div className="mb-4 space-y-1.5"><p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1">Multi-Day Bookings</p>
                  {multiDayRes.map(r => { const { startIdx, endIdx } = getReservationDaySpan(r, weekDates); return (<div key={r.id} className="grid grid-cols-7 gap-px">{startIdx > 0 && <div style={{ gridColumn: `span ${startIdx}` }} />}<div style={{ gridColumn: `span ${endIdx - startIdx + 1}` }} className="bg-[#3AB0FF] text-white rounded px-2.5 py-1.5 flex items-center gap-2 cursor-pointer active:scale-[0.99] transition-transform" onClick={() => { setCurrentDate(new Date(r.start_time)); setView('day'); }}><span className="text-[10px] font-bold uppercase tracking-widest">{r.pilot_initials}</span><span className="text-[10px] font-roboto opacity-90 truncate">{r.title || r.route || `${formatDateShort(r.start_time)} – ${formatDateShort(r.end_time)}`}</span></div></div>); })}
                </div>)}
                <div className="space-y-1">{weekDates.map(date => {
                  const events = getEventsForDate(date); const isToday = date.toDateString() === today.toDateString(); const isPast = date < today;
                  const singleDayRes = events.reservations.filter(r => !isFullDayOrMultiDay(r));
                  return (<div key={date.toISOString()} className={`rounded border transition-colors ${isToday ? 'border-[#56B94A] bg-emerald-50/30' : isPast ? 'border-gray-100 bg-gray-50/50' : 'border-gray-200 bg-white'}`}>
                    <button onClick={() => { setCurrentDate(date); setView('day'); }} className="w-full text-left p-3 active:scale-[0.99] transition-transform">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 text-center"><span className={`text-[10px] font-oswald font-bold uppercase block leading-none ${isPast ? 'text-gray-400' : 'text-gray-500'}`}>{date.toLocaleDateString('en-US', { weekday: 'short' })}</span><span className={`text-lg font-oswald font-bold leading-none ${isToday ? 'text-[#56B94A]' : isPast ? 'text-gray-400' : 'text-navy'}`}>{date.getDate()}</span></div>
                          <div className="flex flex-col gap-0.5">
                            {singleDayRes.map((r,idx) => (<div key={idx} className="text-xs text-gray-600 font-roboto"><span className="font-bold text-navy">{r.pilot_initials}</span> {formatTime(r.start_time)} – {formatTime(r.end_time)}{r.route && <span className="text-gray-400 ml-1.5">{r.route}</span>}</div>))}
                            {events.mxBlocks.map((m: any,idx: number) => (<div key={`mx-${idx}`} className="text-xs text-[#F08B46] font-bold font-roboto flex items-center gap-1"><Wrench size={10} /> {m.label}</div>))}
                            {singleDayRes.length === 0 && events.mxBlocks.length === 0 && <span className="text-[10px] text-gray-400 font-roboto">Available</span>}
                          </div>
                        </div>
                        {singleDayRes.length > 0 && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded shrink-0">{singleDayRes.length}</span>}
                      </div>
                    </button>
                  </div>);
                })}</div>
              </div>
            );
          })()}

          {/* DAY VIEW */}
          {view === 'day' && (() => {
            const events = getEventsForDate(currentDate); const hasMx = isMxBlockedDate(currentDate);
            const fullDayRes = events.reservations.filter(r => isFullDayOrMultiDay(r)); const timedRes = events.reservations.filter(r => !isFullDayOrMultiDay(r));
            return (
              <div className="space-y-3">
                {fullDayRes.map(r => (
                  <div key={r.id} className="bg-[#3AB0FF]/10 border-2 border-[#3AB0FF]/30 rounded-sm p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2"><span className="bg-[#3AB0FF] text-white text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded">{r.pilot_initials || '—'} — All Day</span><span className="text-xs text-gray-500 font-roboto">{r.pilot_name}</span></div>
                        <div className="flex items-center gap-2 text-sm text-navy font-bold font-roboto"><Calendar size={13} className="text-[#3AB0FF] shrink-0" />{formatDateShort(r.start_time)} {formatTime(r.start_time)} — {formatDateShort(r.end_time)} {formatTime(r.end_time)}</div>
                        {r.title && <p className="text-xs text-gray-600 mt-2 font-roboto">{r.title}</p>}
                        {r.route && <p className="text-xs text-gray-500 mt-1 flex items-center gap-1 font-roboto"><MapPin size={11} className="text-[#3AB0FF] shrink-0" /> {r.route}</p>}
                      </div>
                      {canManageReservation(r) && cancellingId !== r.id && (
                        <div className="flex items-center gap-1 shrink-0 ml-3">
                          <button onClick={() => openEditForm(r)} className="text-gray-300 hover:text-[#3AB0FF] active:scale-95 p-1" title="Edit"><Edit2 size={14} /></button>
                          <button onClick={() => setCancellingId(r.id)} className="text-gray-300 hover:text-[#CE3732] active:scale-95 p-1" title="Cancel"><X size={16} /></button>
                        </div>
                      )}
                    </div>
                    {cancellingId === r.id && (<div className="mt-3 pt-3 border-t border-sky-200 flex gap-2 animate-fade-in"><button onClick={() => setCancellingId(null)} className="flex-1 border border-gray-300 text-gray-600 font-oswald font-bold py-2 rounded text-[10px] uppercase tracking-widest active:scale-95">Keep</button><button onClick={() => handleCancelReservation(r.id)} disabled={isSubmitting} className="flex-1 bg-[#CE3732] text-white font-oswald font-bold py-2 rounded text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-50">{isSubmitting ? "..." : "Cancel Booking"}</button></div>)}
                  </div>
                ))}
                {hasMx && events.mxBlocks.map((m: any, idx: number) => (<div key={`mx-${idx}`} className="p-4 bg-orange-50 border border-orange-200 rounded flex items-center gap-3"><div className="bg-[#F08B46] text-white p-1.5 rounded shrink-0"><Wrench size={16} /></div><div className="min-w-0 flex-1"><p className="text-sm font-bold text-navy font-roboto truncate">{m.label}</p><p className="text-[10px] text-gray-500 font-roboto">{m.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {m.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p></div></div>))}
                {timedRes.map(r => <ReservationCard key={r.id} r={r} />)}
                {events.reservations.length === 0 && !hasMx && (
                  <div className="text-center py-12"><div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"><Plane size={28} className="text-gray-300" /></div><p className="text-sm text-gray-400 font-oswald font-bold uppercase tracking-widest">Available</p><p className="text-xs text-gray-400 font-roboto mt-1">No bookings for this day</p><button onClick={() => openBookingForm(currentDate)} className="mt-4 text-[10px] font-oswald font-bold uppercase tracking-widest text-[#56B94A] bg-emerald-50 border border-emerald-200 px-4 py-2 rounded hover:bg-emerald-100 active:scale-95 transition-all">+ Reserve this date</button></div>
                )}
                {!hasMx && events.reservations.length > 0 && <button onClick={() => openBookingForm(currentDate)} className="w-full border-2 border-dashed border-gray-200 text-gray-400 font-oswald font-bold py-3 rounded hover:bg-emerald-50 hover:border-[#56B94A] hover:text-[#56B94A] active:scale-95 transition-all text-[10px] uppercase tracking-widest">+ Add Booking</button>}
                {hasMx && <p className="text-[11px] font-roboto font-bold text-[#CE3732] text-center mt-2">Maintenance event scheduled — reservations blocked during this period.</p>}
              </div>
            );
          })()}
        </div>
      </div>

      {/* BOOKING FORM — z-[10000] to sit above nav bars */}
      {showBookingForm && (
        <div className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowBookingForm(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-5 border-t-4 border-[#56B94A] max-h-[85vh] overflow-y-auto animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><Calendar size={18} className="text-[#56B94A]" /> {editingReservationId ? 'Edit Reservation' : 'Reserve Aircraft'}</h2>
              <button onClick={() => setShowBookingForm(false)} className="text-gray-400 hover:text-red-500"><X size={22} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Departure</p>
                <div className="grid grid-cols-5 gap-2">
                  <div className="col-span-3"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Date *</label><input type="date" value={bookingStartDate} onChange={e => setBookingStartDate(e.target.value)} style={wb} className="w-full border border-gray-300 rounded p-2.5 text-sm mt-1 focus:border-[#56B94A] outline-none" /></div>
                  <div className="col-span-2"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Time *</label><input type="time" value={bookingStartTime} onChange={e => setBookingStartTime(e.target.value)} style={wb} className="w-full border border-gray-300 rounded p-2.5 text-sm mt-1 focus:border-[#56B94A] outline-none" /></div>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Return</p>
                <div className="grid grid-cols-5 gap-2">
                  <div className="col-span-3"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Date *</label><input type="date" value={bookingEndDate} onChange={e => setBookingEndDate(e.target.value)} style={wb} className="w-full border border-gray-300 rounded p-2.5 text-sm mt-1 focus:border-[#56B94A] outline-none" /></div>
                  <div className="col-span-2"><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Time *</label><input type="time" value={bookingEndTime} onChange={e => setBookingEndTime(e.target.value)} style={wb} className="w-full border border-gray-300 rounded p-2.5 text-sm mt-1 focus:border-[#56B94A] outline-none" /></div>
                </div>
              </div>
              <div className="border-t border-gray-100 pt-4">
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Purpose (Optional)</label>
                <input type="text" value={bookingTitle} onChange={e => setBookingTitle(e.target.value)} style={wb} className="w-full border border-gray-300 rounded p-2.5 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="Weekend trip, Business travel..." />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Route of Flight (Optional)</label>
                <input type="text" value={bookingRoute} onChange={e => setBookingRoute(e.target.value)} style={wb} className="w-full border border-gray-300 rounded p-2.5 text-sm mt-1 focus:border-[#56B94A] outline-none uppercase" placeholder="KDAL → KAUS → KDAL" />
              </div>
              {!editingReservationId && (
                <div className="border-t border-gray-100 pt-4">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Repeat</label>
                  <div className="flex gap-1.5 mt-1.5">
                    {([['none', 'None'], ['weekly', 'Weekly'], ['biweekly', 'Biweekly']] as const).map(([val, label]) => (
                      <button key={val} type="button" onClick={() => setBookingRepeat(val)}
                        className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded transition-colors active:scale-95 ${bookingRepeat === val ? 'bg-[#56B94A] text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                      >{label}</button>
                    ))}
                  </div>
                  {bookingRepeat !== 'none' && (
                    <div className="mt-3 flex items-center gap-2 animate-fade-in">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 shrink-0">For</label>
                      <select value={bookingRepeatCount} onChange={e => setBookingRepeatCount(parseInt(e.target.value))} className="border border-gray-300 rounded px-2.5 py-1.5 text-sm bg-white focus:border-[#56B94A] outline-none">
                        {[2, 3, 4, 5, 6, 7, 8, 10, 12].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{bookingRepeat === 'biweekly' ? 'occurrences (every 2 weeks)' : 'weeks'}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="pt-2"><button onClick={handleSubmitReservation} disabled={isSubmitting} className="w-full bg-[#56B94A] text-white font-oswald tracking-widest uppercase py-3 px-4 rounded hover:bg-opacity-90 active:scale-95 transition-all text-sm disabled:opacity-50">{isSubmitting ? <><Loader2 size={16} className="animate-spin" /> {editingReservationId ? 'Updating...' : 'Booking...'}</> : editingReservationId ? "Update Reservation" : "Confirm Reservation"}</button></div>
            </div>
          </div>
        </div>
      )}

      {/* MX BLOCK FORM */}
      {showMxBlockForm && (
        <div className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowMxBlockForm(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-5 border-t-4 border-[#F08B46] max-h-[85vh] overflow-y-auto animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><Wrench size={18} className="text-[#F08B46]" /> Block for Maintenance</h2>
              <button onClick={() => setShowMxBlockForm(false)} className="text-gray-400 hover:text-red-500"><X size={22} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Start Date *</label>
                <input type="date" value={mxBlockStartDate} onChange={e => setMxBlockStartDate(e.target.value)} style={wb} className="w-full border border-gray-300 rounded p-2.5 text-sm mt-1 focus:border-[#F08B46] outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">End Date *</label>
                <input type="date" value={mxBlockEndDate} onChange={e => setMxBlockEndDate(e.target.value)} style={wb} className="w-full border border-gray-300 rounded p-2.5 text-sm mt-1 focus:border-[#F08B46] outline-none" />
              </div>
              <div className="border-t border-gray-100 pt-4">
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Notes (Optional)</label>
                <input type="text" value={mxBlockNotes} onChange={e => setMxBlockNotes(e.target.value)} style={wb} className="w-full border border-gray-300 rounded p-2.5 text-sm mt-1 focus:border-[#F08B46] outline-none" placeholder="Annual inspection, oil change..." />
              </div>
              <div className="pt-2"><button onClick={handleCreateMxBlock} disabled={isSubmitting} className="w-full bg-[#F08B46] text-white font-oswald tracking-widest uppercase py-3 px-4 rounded hover:bg-opacity-90 active:scale-95 transition-all text-sm disabled:opacity-50">{isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Creating...</> : "Block Aircraft"}</button></div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

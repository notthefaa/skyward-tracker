"use client";

import { useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import type { AircraftWithMetrics, Reservation, AircraftRole } from "@/lib/types";
import useSWR from "swr";
import { Calendar, ChevronLeft, ChevronRight, Plus, X, Clock, MapPin, Plane, Wrench, Loader2 } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import Toast from "@/components/Toast";

type CalendarView = 'month' | 'week' | 'day';

export default function CalendarTab({ 
  aircraft, session, aircraftRole 
}: { 
  aircraft: AircraftWithMetrics | null, 
  session: any,
  aircraftRole: AircraftRole | null
}) {
  const [view, setView] = useState<CalendarView>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Booking form
  const [bookingStartDate, setBookingStartDate] = useState("");
  const [bookingStartTime, setBookingStartTime] = useState("08:00");
  const [bookingEndDate, setBookingEndDate] = useState("");
  const [bookingEndTime, setBookingEndTime] = useState("17:00");
  const [bookingTitle, setBookingTitle] = useState("");
  const [bookingRoute, setBookingRoute] = useState("");

  // Toast
  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);
  const showSuccess = (msg: string) => { setToastMessage(msg); setShowToast(true); };

  // Confirm cancel
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Fetch reservations for the current month range (with buffer for week view)
  const fetchKey = aircraft ? `calendar-${aircraft.id}-${currentDate.getFullYear()}-${currentDate.getMonth()}` : null;

  const { data: calendarData, mutate } = useSWR(
    fetchKey,
    async () => {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      // Fetch a wide range to cover month + adjacent weeks
      const rangeStart = new Date(year, month - 1, 1).toISOString();
      const rangeEnd = new Date(year, month + 2, 0).toISOString();

      const [resRes, mxRes] = await Promise.all([
        supabase
          .from('aft_reservations')
          .select('*')
          .eq('aircraft_id', aircraft!.id)
          .eq('status', 'confirmed')
          .gte('end_time', rangeStart)
          .lte('start_time', rangeEnd)
          .order('start_time'),
        supabase
          .from('aft_maintenance_events')
          .select('confirmed_date, estimated_completion, status, mx_contact_name')
          .eq('aircraft_id', aircraft!.id)
          .in('status', ['confirmed', 'in_progress'])
      ]);

      return {
        reservations: (resRes.data || []) as Reservation[],
        mxBlocks: (mxRes.data || []).filter((e: any) => e.confirmed_date).map((e: any) => ({
          start: new Date(e.confirmed_date + 'T00:00:00'),
          end: e.estimated_completion 
            ? new Date(e.estimated_completion + 'T23:59:59') 
            : new Date(new Date(e.confirmed_date + 'T00:00:00').getTime() + 24 * 60 * 60 * 1000),
          label: `In Maintenance${e.mx_contact_name ? ' — ' + e.mx_contact_name : ''}`,
        })),
      };
    }
  );

  const reservations = calendarData?.reservations || [];
  const mxBlocks = calendarData?.mxBlocks || [];

  // ── Date helpers ──
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const daysInMonth = monthEnd.getDate();
  const startDayOfWeek = monthStart.getDay(); // 0=Sun

  const navigate = (dir: number) => {
    const d = new Date(currentDate);
    if (view === 'month') d.setMonth(d.getMonth() + dir);
    else if (view === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCurrentDate(d);
  };

  const getWeekDates = () => {
    const d = new Date(currentDate);
    const day = d.getDay();
    const start = new Date(d);
    start.setDate(d.getDate() - day);
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const dd = new Date(start);
      dd.setDate(start.getDate() + i);
      dates.push(dd);
    }
    return dates;
  };

  const getEventsForDate = (date: Date) => {
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);

    const dayReservations = reservations.filter(r => {
      const rStart = new Date(r.start_time);
      const rEnd = new Date(r.end_time);
      return rStart <= dayEnd && rEnd >= dayStart;
    });

    const dayMx = mxBlocks.filter((m: any) => m.start <= dayEnd && m.end >= dayStart);

    return { reservations: dayReservations, mxBlocks: dayMx };
  };

  const isMxBlockedDate = (date: Date) => {
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
    return mxBlocks.some((m: any) => m.start <= dayEnd && m.end >= dayStart);
  };

  // ── Booking ──
  const openBookingForm = (date?: Date) => {
    const d = date || new Date();
    const dateStr = d.toISOString().split('T')[0];
    setBookingStartDate(dateStr);
    setBookingEndDate(dateStr);
    setBookingStartTime("08:00");
    setBookingEndTime("17:00");
    setBookingTitle("");
    setBookingRoute("");
    setShowBookingForm(true);
  };

  const handleCreateReservation = async () => {
    if (!bookingStartDate || !bookingEndDate) return alert("Please select dates.");
    setIsSubmitting(true);

    const startTime = new Date(`${bookingStartDate}T${bookingStartTime}:00`).toISOString();
    const endTime = new Date(`${bookingEndDate}T${bookingEndTime}:00`).toISOString();

    try {
      const res = await authFetch('/api/reservations', {
        method: 'POST',
        body: JSON.stringify({
          aircraftId: aircraft!.id,
          startTime,
          endTime,
          title: bookingTitle || null,
          route: bookingRoute || null,
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create reservation');

      await mutate();
      setShowBookingForm(false);
      showSuccess("Reservation confirmed");
    } catch (err: any) {
      alert(err.message);
    }
    setIsSubmitting(false);
  };

  const handleCancelReservation = async (id: string) => {
    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/reservations', {
        method: 'DELETE',
        body: JSON.stringify({ reservationId: id })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to cancel');
      }
      await mutate();
      setCancellingId(null);
      showSuccess("Reservation cancelled");
    } catch (err: any) {
      alert(err.message);
    }
    setIsSubmitting(false);
  };

  const canManageReservation = (reservation: Reservation) => {
    if (reservation.user_id === session?.user?.id) return true;
    if (aircraftRole === 'admin') return true;
    return false;
  };

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const formatDateShort = (iso: string) => {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (!aircraft) return null;

  // ── Month header ──
  const monthLabel = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const weekLabel = (() => {
    const dates = getWeekDates();
    return `${dates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${dates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  })();
  const dayLabel = currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <>
      <Toast message={toastMessage} show={showToast} onDismiss={() => setShowToast(false)} />

      <div className="mb-2">
        <PrimaryButton onClick={() => openBookingForm()}>
          <Plus size={18} /> Book Aircraft
        </PrimaryButton>
      </div>

      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#3AB0FF] mb-6">

        {/* View Toggle + Navigation */}
        <div className="flex justify-between items-center mb-4">
          <div className="flex gap-1">
            {(['month', 'week', 'day'] as CalendarView[]).map(v => (
              <button 
                key={v} 
                onClick={() => setView(v)} 
                className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded transition-colors active:scale-95 ${view === v ? 'bg-[#3AB0FF] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-navy active:scale-95 p-1"><ChevronLeft size={20} /></button>
            <button onClick={() => setCurrentDate(new Date())} className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] hover:underline px-2">Today</button>
            <button onClick={() => navigate(1)} className="text-gray-400 hover:text-navy active:scale-95 p-1"><ChevronRight size={20} /></button>
          </div>
        </div>

        {/* Date Header */}
        <h2 className="font-oswald text-xl font-bold uppercase text-navy mb-4 leading-none">
          {view === 'month' ? monthLabel : view === 'week' ? weekLabel : dayLabel}
        </h2>

        {/* ═══ MONTH VIEW ═══ */}
        {view === 'month' && (
          <div>
            <div className="grid grid-cols-7 gap-px mb-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className="text-[10px] font-bold uppercase tracking-widest text-gray-400 text-center py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-gray-200 rounded overflow-hidden">
              {/* Empty cells before month starts */}
              {Array.from({ length: startDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} className="bg-gray-50 min-h-[60px] p-1" />
              ))}
              {/* Day cells */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
                const events = getEventsForDate(date);
                const isToday = date.toDateString() === today.toDateString();
                const hasMx = events.mxBlocks.length > 0;
                const hasRes = events.reservations.length > 0;

                return (
                  <button 
                    key={day} 
                    onClick={() => { setCurrentDate(date); setView('day'); }}
                    className={`bg-white min-h-[60px] p-1 text-left hover:bg-blue-50 transition-colors relative ${isToday ? 'ring-2 ring-[#3AB0FF] ring-inset' : ''}`}
                  >
                    <span className={`text-xs font-bold ${isToday ? 'text-[#3AB0FF]' : 'text-navy'}`}>{day}</span>
                    <div className="mt-1 space-y-0.5">
                      {events.reservations.slice(0, 2).map((r, idx) => (
                        <div key={idx} className="bg-[#3AB0FF]/15 text-[7px] font-bold text-[#3AB0FF] px-1 rounded truncate">
                          {r.pilot_initials || '—'} {formatTime(r.start_time)}
                        </div>
                      ))}
                      {events.reservations.length > 2 && (
                        <div className="text-[7px] font-bold text-gray-400">+{events.reservations.length - 2} more</div>
                      )}
                      {hasMx && (
                        <div className="bg-[#F08B46]/15 text-[7px] font-bold text-[#F08B46] px-1 rounded truncate">
                          MX
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ WEEK VIEW ═══ */}
        {view === 'week' && (
          <div className="space-y-1">
            {getWeekDates().map(date => {
              const events = getEventsForDate(date);
              const isToday = date.toDateString() === today.toDateString();

              return (
                <button 
                  key={date.toISOString()} 
                  onClick={() => { setCurrentDate(date); setView('day'); }}
                  className={`w-full text-left p-3 rounded border transition-colors active:scale-[0.99] ${isToday ? 'border-[#3AB0FF] bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className={`text-xs font-bold uppercase ${isToday ? 'text-[#3AB0FF]' : 'text-navy'}`}>
                      {date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    {events.reservations.length > 0 && (
                      <span className="text-[10px] font-bold text-[#3AB0FF] bg-[#3AB0FF]/10 px-2 py-0.5 rounded">{events.reservations.length} booking{events.reservations.length > 1 ? 's' : ''}</span>
                    )}
                  </div>
                  {events.reservations.map((r, idx) => (
                    <div key={idx} className="text-xs text-gray-600 ml-2 mt-1">
                      <span className="font-bold text-navy">{r.pilot_initials}</span> {formatTime(r.start_time)} – {formatTime(r.end_time)}
                      {r.route && <span className="text-gray-400 ml-2">{r.route}</span>}
                    </div>
                  ))}
                  {events.mxBlocks.map((m: any, idx: number) => (
                    <div key={`mx-${idx}`} className="text-xs text-[#F08B46] font-bold ml-2 mt-1 flex items-center gap-1">
                      <Wrench size={10} /> {m.label}
                    </div>
                  ))}
                  {events.reservations.length === 0 && events.mxBlocks.length === 0 && (
                    <p className="text-[10px] text-gray-400 ml-2 mt-1">Available</p>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ═══ DAY VIEW ═══ */}
        {view === 'day' && (() => {
          const events = getEventsForDate(currentDate);
          const hasMx = isMxBlockedDate(currentDate);

          return (
            <div className="space-y-3">
              {hasMx && events.mxBlocks.map((m: any, idx: number) => (
                <div key={`mx-${idx}`} className="p-4 bg-orange-50 border border-orange-200 rounded flex items-center gap-3">
                  <Wrench size={18} className="text-[#F08B46] shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-navy">{m.label}</p>
                    <p className="text-[10px] text-gray-500">{m.start.toLocaleDateString()} — {m.end.toLocaleDateString()}</p>
                    <p className="text-[10px] text-[#F08B46] font-bold uppercase mt-1">Aircraft unavailable</p>
                  </div>
                </div>
              ))}

              {events.reservations.length === 0 && !hasMx && (
                <div className="text-center py-8">
                  <Plane size={32} className="mx-auto text-gray-300 mb-3" />
                  <p className="text-sm text-gray-400 font-bold">No bookings this day</p>
                  <button onClick={() => openBookingForm(currentDate)} className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] hover:underline mt-2">
                    + Book this date
                  </button>
                </div>
              )}

              {events.reservations.map(r => (
                <div key={r.id} className={`p-4 border rounded ${r.user_id === session?.user?.id ? 'bg-blue-50 border-[#3AB0FF]/30' : 'bg-white border-gray-200'}`}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] bg-[#3AB0FF]/10 px-2 py-0.5 rounded">{r.pilot_initials || '—'}</span>
                        <span className="text-xs text-gray-500">{r.pilot_name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-navy font-bold">
                        <Clock size={14} className="text-gray-400" />
                        {formatTime(r.start_time)} – {formatTime(r.end_time)}
                        {r.start_time.split('T')[0] !== r.end_time.split('T')[0] && (
                          <span className="text-[10px] text-gray-400 font-normal">({formatDateShort(r.start_time)} – {formatDateShort(r.end_time)})</span>
                        )}
                      </div>
                      {r.title && <p className="text-xs text-gray-600 mt-1">{r.title}</p>}
                      {r.route && (
                        <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                          <MapPin size={12} className="text-[#3AB0FF]" /> {r.route}
                        </p>
                      )}
                    </div>
                    {canManageReservation(r) && cancellingId !== r.id && (
                      <button onClick={() => setCancellingId(r.id)} className="text-gray-400 hover:text-[#CE3732] active:scale-95 shrink-0 ml-3">
                        <X size={18} />
                      </button>
                    )}
                  </div>
                  {cancellingId === r.id && (
                    <div className="mt-3 pt-3 border-t border-gray-200 flex gap-2 animate-fade-in">
                      <button onClick={() => setCancellingId(null)} className="flex-1 border border-gray-300 text-gray-600 font-bold py-2 rounded text-xs uppercase tracking-widest active:scale-95">Keep</button>
                      <button onClick={() => handleCancelReservation(r.id)} disabled={isSubmitting} className="flex-1 bg-[#CE3732] text-white font-bold py-2 rounded text-xs uppercase tracking-widest active:scale-95 disabled:opacity-50">
                        {isSubmitting ? "..." : "Cancel Reservation"}
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {!hasMx && events.reservations.length > 0 && (
                <button onClick={() => openBookingForm(currentDate)} className="w-full border-2 border-dashed border-gray-300 text-gray-500 font-bold py-3 rounded hover:bg-gray-50 hover:border-[#3AB0FF] active:scale-95 transition-all text-sm uppercase tracking-widest">
                  + Book this date
                </button>
              )}
            </div>
          );
        })()}

      </div>

      {/* ═══ BOOKING FORM MODAL ═══ */}
      {showBookingForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowBookingForm(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-[#3AB0FF] max-h-[90vh] overflow-y-auto animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2">
                <Calendar size={20} className="text-[#3AB0FF]" /> Book Aircraft
              </h2>
              <button onClick={() => setShowBookingForm(false)} className="text-gray-400 hover:text-red-500"><X size={24} /></button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Start Date *</label>
                  <input type="date" value={bookingStartDate} onChange={e => setBookingStartDate(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#3AB0FF] outline-none bg-white" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Start Time *</label>
                  <input type="time" value={bookingStartTime} onChange={e => setBookingStartTime(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#3AB0FF] outline-none bg-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">End Date *</label>
                  <input type="date" value={bookingEndDate} onChange={e => setBookingEndDate(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#3AB0FF] outline-none bg-white" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">End Time *</label>
                  <input type="time" value={bookingEndTime} onChange={e => setBookingEndTime(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#3AB0FF] outline-none bg-white" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Purpose (Optional)</label>
                <input type="text" value={bookingTitle} onChange={e => setBookingTitle(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#3AB0FF] outline-none bg-white" placeholder="e.g. Weekend trip, Business travel" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Route of Flight (Optional)</label>
                <input type="text" value={bookingRoute} onChange={e => setBookingRoute(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#3AB0FF] outline-none bg-white uppercase" placeholder="e.g. KDAL → KAUS → KDAL" />
              </div>
              <div className="pt-4">
                <PrimaryButton onClick={handleCreateReservation} disabled={isSubmitting}>
                  {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Booking...</> : "Confirm Reservation"}
                </PrimaryButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

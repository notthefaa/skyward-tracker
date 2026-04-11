"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { supabase } from "@/lib/supabase";
import type { AircraftWithMetrics, Reservation } from "@/lib/types";
import { ChevronLeft, ChevronRight, Wrench, Plane, MapPin, Clock, Filter } from "lucide-react";

type CalendarView = 'month' | 'week' | 'day';

/** Stable tail-number palette (indexed off position in aircraft list). */
const TAIL_PALETTE = [
  '#3AB0FF', // sky
  '#56B94A', // emerald
  '#A855F7', // purple
  '#F5B05B', // amber
  '#14B8A6', // teal
  '#F43F5E', // rose
  '#6366F1', // indigo
  '#06B6D4', // cyan
  '#EAB308', // yellow
  '#EC4899', // pink
];

/** Hex → rgba with alpha — used for the soft tail-color header backgrounds
 *  in the day view. */
function hexAlpha(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map(c => c + c).join('') : m, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

interface MxBlockRow { aircraft_id: string; start: Date; end: Date; label: string }

interface TailMeta { id: string; tail_number: string; color: string }

export default function FleetSchedule({
  aircraftList,
  onSelectAircraftDate,
}: {
  aircraftList: AircraftWithMetrics[];
  onSelectAircraftDate: (tail: string, date: Date, view: CalendarView) => void;
}) {
  const [view, setView] = useState<CalendarView>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());
  const [selectedTails, setSelectedTails] = useState<Set<string>>(
    () => new Set(aircraftList.map(a => a.id))
  );

  // Tail metadata (stable color assignment by position in the aircraft list).
  const tailMeta = useMemo<Record<string, TailMeta>>(() => {
    const out: Record<string, TailMeta> = {};
    aircraftList.forEach((a, i) => {
      out[a.id] = {
        id: a.id,
        tail_number: a.tail_number,
        color: TAIL_PALETTE[i % TAIL_PALETTE.length],
      };
    });
    return out;
  }, [aircraftList]);

  // Fetch reservations + MX blocks for all aircraft in the visible month range.
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const aircraftIdsKey = aircraftList.map(a => a.id).sort().join(',');
  const fetchKey = aircraftList.length > 0
    ? `fleet-schedule-${aircraftIdsKey}-${year}-${month}`
    : null;

  const { data: calendarData } = useSWR(fetchKey, async () => {
    const rangeStart = new Date(year, month - 1, 1).toISOString();
    const rangeEnd = new Date(year, month + 2, 0).toISOString();
    const ids = aircraftList.map(a => a.id);
    const [resRes, mxRes] = await Promise.all([
      supabase.from('aft_reservations')
        .select('*')
        .in('aircraft_id', ids)
        .eq('status', 'confirmed')
        .gte('end_time', rangeStart)
        .lte('start_time', rangeEnd)
        .order('start_time'),
      supabase.from('aft_maintenance_events')
        .select('aircraft_id, confirmed_date, estimated_completion, status, mx_contact_name')
        .in('aircraft_id', ids)
        .in('status', ['confirmed', 'in_progress']),
    ]);
    const reservations = (resRes.data || []) as Reservation[];
    const mxBlocks: MxBlockRow[] = (mxRes.data || [])
      .filter((e: any) => e.confirmed_date)
      .map((e: any) => ({
        aircraft_id: e.aircraft_id,
        start: new Date(e.confirmed_date + 'T00:00:00'),
        end: e.estimated_completion
          ? new Date(e.estimated_completion + 'T23:59:59')
          : new Date(new Date(e.confirmed_date + 'T00:00:00').getTime() + 24 * 60 * 60 * 1000),
        label: `Maintenance${e.mx_contact_name ? ' — ' + e.mx_contact_name : ''}`,
      }));
    return { reservations, mxBlocks };
  });

  const reservations = calendarData?.reservations || [];
  const mxBlocks = calendarData?.mxBlocks || [];

  // Filter by selected tails.
  const visibleReservations = useMemo(
    () => reservations.filter(r => selectedTails.has(r.aircraft_id)),
    [reservations, selectedTails]
  );
  const visibleMxBlocks = useMemo(
    () => mxBlocks.filter(m => selectedTails.has(m.aircraft_id)),
    [mxBlocks, selectedTails]
  );

  // Viewer's timezone for rendering reservation times in the booker's zone when different.
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const useBookerTz = (r: Reservation) => !!r.time_zone && r.time_zone !== viewerTz;
  const formatTime = (iso: string, r?: Reservation) => {
    if (r && useBookerTz(r)) {
      return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: r.time_zone!, timeZoneName: 'short' });
    }
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const isFullDayOrMultiDay = (r: Reservation) => {
    const s = new Date(r.start_time); const e = new Date(r.end_time);
    if (s.toDateString() !== e.toDateString()) return true;
    return (e.getTime() - s.getTime()) / (1000 * 60 * 60) >= 12;
  };

  const getEventsForDate = (date: Date) => {
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
    return {
      reservations: visibleReservations.filter(r => new Date(r.start_time) <= dayEnd && new Date(r.end_time) >= dayStart),
      mxBlocks: visibleMxBlocks.filter(m => m.start <= dayEnd && m.end >= dayStart),
    };
  };

  const navigate = (dir: number) => {
    const d = new Date(currentDate);
    if (view === 'month') d.setMonth(d.getMonth() + dir);
    else if (view === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCurrentDate(d);
  };

  const getWeekDates = () => {
    const d = new Date(currentDate); const day = d.getDay();
    const start = new Date(d); start.setDate(d.getDate() - day);
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) { const dd = new Date(start); dd.setDate(start.getDate() + i); dates.push(dd); }
    return dates;
  };

  const toggleTail = (id: string) => {
    setSelectedTails(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = selectedTails.size === aircraftList.length;
  const toggleAll = () => {
    setSelectedTails(allSelected ? new Set() : new Set(aircraftList.map(a => a.id)));
  };

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const daysInMonth = monthEnd.getDate();
  const startDayOfWeek = monthStart.getDay();

  const monthLabel = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const weekLabel = (() => {
    const d = getWeekDates();
    return `${d[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${d[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  })();
  const dayLabel = currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // ──────────────────────────────────────────────────────────────
  // Unified event pill — every cell item is styled the same way:
  // filled tail color with white text. Reservations and MX blocks only
  // differ in the label text; no visual differentiation between single-day,
  // multi-day, or maintenance.
  // ──────────────────────────────────────────────────────────────
  const EventPill = ({
    meta, label, title, targetDate,
  }: {
    meta: TailMeta;
    label: string;
    title: string;
    targetDate: Date;
  }) => (
    <div
      onClick={(e) => {
        // On mobile (<md), let the tap fall through to the day cell so users
        // always get the day overview — individual pills are too small to
        // target reliably on touch. On desktop, the pill still jumps straight
        // to that tail's day view.
        if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) return;
        e.stopPropagation();
        onSelectAircraftDate(meta.tail_number, targetDate, 'day');
      }}
      className="text-[7px] font-bold px-1 py-px rounded truncate text-white md:cursor-pointer"
      style={{ backgroundColor: meta.color }}
      title={title}
    >
      {meta.tail_number} {label}
    </div>
  );

  return (
    <div className="bg-cream shadow-lg rounded-sm border-t-4 border-[#56B94A]">
      {/* Header: view toggle + navigation */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 md:px-6">
        <div className="flex justify-between items-center">
          <div className="flex gap-1">
            {(['month', 'week', 'day'] as CalendarView[]).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`text-[10px] font-oswald font-bold uppercase tracking-widest px-3.5 py-1.5 rounded transition-colors active:scale-95 ${view === v ? 'bg-[#56B94A] text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                {v}
              </button>
            ))}
          </div>
          <button onClick={() => setCurrentDate(new Date())} className="text-[10px] font-oswald font-bold uppercase tracking-widest text-[#56B94A] hover:bg-emerald-50 px-3 py-1.5 rounded transition-colors">Today</button>
        </div>
        <div className="flex items-center justify-center gap-2 mt-3">
          <button onClick={() => navigate(-1)} aria-label="Previous" className="text-gray-400 hover:text-navy active:scale-95 p-1.5 rounded hover:bg-gray-100 transition-colors shrink-0"><ChevronLeft size={20} /></button>
          <button
            type="button"
            onClick={() => { setPickerYear(currentDate.getFullYear()); setShowDatePicker(true); }}
            className="font-oswald text-xl font-bold uppercase text-navy leading-none px-3 py-1 rounded hover:bg-gray-100 active:scale-95 transition-colors"
            aria-label="Jump to a different month"
          >
            {view === 'month' ? monthLabel : view === 'week' ? weekLabel : dayLabel}
          </button>
          <button onClick={() => navigate(1)} aria-label="Next" className="text-gray-400 hover:text-navy active:scale-95 p-1.5 rounded hover:bg-gray-100 transition-colors shrink-0"><ChevronRight size={20} /></button>
        </div>
      </div>

      {/* Tail filter chips */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 md:px-6">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 flex items-center gap-1 shrink-0">
            <Filter size={11} /> Filter
          </span>
          <button
            onClick={toggleAll}
            className={`text-[10px] font-oswald font-bold uppercase tracking-widest px-2.5 py-1 rounded border transition-colors active:scale-95 ${allSelected ? 'bg-navy text-white border-navy' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
          >
            All
          </button>
          {aircraftList.map(a => {
            const meta = tailMeta[a.id];
            const on = selectedTails.has(a.id);
            return (
              <button
                key={a.id}
                onClick={() => toggleTail(a.id)}
                className="text-[10px] font-oswald font-bold uppercase tracking-widest px-2.5 py-1 rounded border transition-all active:scale-95"
                style={{
                  backgroundColor: on ? meta.color : '#fff',
                  color: on ? '#fff' : meta.color,
                  borderColor: meta.color,
                  opacity: on ? 1 : 0.75,
                }}
              >
                {a.tail_number}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4 md:p-6">
        {/* ─────────── MONTH VIEW ─────────── */}
        {view === 'month' && (
          <div>
            <div className="grid grid-cols-7 mb-2">
              {['S','M','T','W','T','F','S'].map((d,i) => (
                <div key={i} className="text-[10px] font-oswald font-bold uppercase tracking-widest text-gray-400 text-center py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-gray-200 rounded overflow-hidden border border-gray-200">
              {Array.from({ length: startDayOfWeek }).map((_,i) => (
                <div key={`e-${i}`} className="bg-gray-50/80 min-h-[72px] md:min-h-[88px]" />
              ))}
              {Array.from({ length: daysInMonth }).map((_,i) => {
                const day = i + 1;
                const date = new Date(year, month, day);
                const events = getEventsForDate(date);
                const isToday = date.toDateString() === today.toDateString();
                const isPast = date < today;

                // Flatten reservations + MX blocks into a single event list so
                // the cell honors a uniform 3-item cap + overflow counter.
                type DayItem =
                  | { kind: 'res'; id: string; meta: TailMeta; label: string; title: string }
                  | { kind: 'mx'; id: string; meta: TailMeta; label: string; title: string };
                const items: DayItem[] = [];
                for (const r of events.reservations) {
                  const meta = tailMeta[r.aircraft_id];
                  if (!meta) continue;
                  items.push({
                    kind: 'res',
                    id: `r-${r.id}`,
                    meta,
                    label: r.pilot_initials || '—',
                    title: `${meta.tail_number} · ${r.pilot_initials || '—'}${r.route ? ' · ' + r.route : ''}`,
                  });
                }
                for (let mi = 0; mi < events.mxBlocks.length; mi++) {
                  const m = events.mxBlocks[mi];
                  const meta = tailMeta[m.aircraft_id];
                  if (!meta) continue;
                  items.push({
                    kind: 'mx',
                    id: `mx-${m.aircraft_id}-${mi}`,
                    meta,
                    label: 'MX',
                    title: `${meta.tail_number} · ${m.label}`,
                  });
                }
                const shown = items.slice(0, 3);
                const overflow = items.length - shown.length;
                return (
                  <button
                    key={day}
                    onClick={() => { setCurrentDate(date); setView('day'); }}
                    className={`min-h-[72px] md:min-h-[88px] p-1 md:p-1.5 text-left transition-colors relative flex flex-col ${isPast ? 'bg-gray-50/60' : 'bg-white'} ${isToday ? 'ring-2 ring-[#56B94A] ring-inset z-[1]' : ''} hover:bg-emerald-50/50`}
                  >
                    <span className={`text-xs font-bold leading-none ${isToday ? 'bg-[#56B94A] text-white w-5 h-5 rounded-full flex items-center justify-center' : isPast ? 'text-gray-400' : 'text-navy'}`}>{day}</span>
                    <div className="mt-auto pt-0.5 space-y-0.5 w-full overflow-hidden">
                      {shown.map(it => (
                        <EventPill key={it.id} meta={it.meta} label={it.label} title={it.title} targetDate={date} />
                      ))}
                      {overflow > 0 && <div className="text-[7px] font-bold text-gray-400 px-1">+{overflow} more</div>}
                    </div>
                  </button>
                );
              })}
              {(() => {
                const t = startDayOfWeek + daysInMonth;
                const r = t % 7;
                if (r === 0) return null;
                return Array.from({ length: 7 - r }).map((_,i) => (
                  <div key={`t-${i}`} className="bg-gray-50/80 min-h-[72px] md:min-h-[88px]" />
                ));
              })()}
            </div>
          </div>
        )}

        {/* ─────────── WEEK VIEW ─────────── */}
        {view === 'week' && (() => {
          const weekDates = getWeekDates();
          return (
            <div className="space-y-1">
              {weekDates.map(date => {
                const events = getEventsForDate(date);
                const isToday = date.toDateString() === today.toDateString();
                const isPast = date < today;
                return (
                  <div key={date.toISOString()} className={`rounded border transition-colors ${isToday ? 'border-[#56B94A] bg-emerald-50/30' : isPast ? 'border-gray-100 bg-gray-50/50' : 'border-gray-200 bg-white'}`}>
                    <button onClick={() => { setCurrentDate(date); setView('day'); }} className="w-full text-left p-3 active:scale-[0.99] transition-transform">
                      <div className="flex justify-between items-start gap-3">
                        <div className="w-10 text-center shrink-0">
                          <span className={`text-[10px] font-oswald font-bold uppercase block leading-none ${isPast ? 'text-gray-400' : 'text-gray-500'}`}>{date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                          <span className={`text-lg font-oswald font-bold leading-none ${isToday ? 'text-[#56B94A]' : isPast ? 'text-gray-400' : 'text-navy'}`}>{date.getDate()}</span>
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col gap-1">
                          {events.reservations.length === 0 && events.mxBlocks.length === 0 && (
                            <span className="text-[10px] text-gray-400 font-roboto italic">Available</span>
                          )}
                          {events.reservations.map(r => {
                            const meta = tailMeta[r.aircraft_id];
                            const multi = isFullDayOrMultiDay(r);
                            return (
                              <div
                                key={r.id}
                                onClick={(e) => { e.stopPropagation(); onSelectAircraftDate(meta.tail_number, date, 'day'); }}
                                className="text-xs text-gray-600 font-roboto flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1 py-0.5"
                              >
                                <span
                                  className="text-[9px] font-oswald font-bold uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0"
                                  style={{ backgroundColor: meta.color, color: '#fff' }}
                                >
                                  {meta.tail_number}
                                </span>
                                <span className="font-bold text-navy">{r.pilot_initials}</span>
                                <span className="truncate">
                                  {multi
                                    ? 'All day'
                                    : `${formatTime(r.start_time, r)} – ${formatTime(r.end_time, r)}`}
                                </span>
                                {r.route && <span className="text-gray-400 truncate hidden sm:inline">{r.route}</span>}
                              </div>
                            );
                          })}
                          {events.mxBlocks.map((m, idx) => {
                            const meta = tailMeta[m.aircraft_id];
                            return (
                              <div
                                key={`mx-${idx}`}
                                onClick={(e) => { e.stopPropagation(); onSelectAircraftDate(meta.tail_number, date, 'day'); }}
                                className="text-xs text-gray-600 font-roboto flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1 py-0.5"
                              >
                                <span
                                  className="text-[9px] font-oswald font-bold uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0"
                                  style={{ backgroundColor: meta.color, color: '#fff' }}
                                >
                                  {meta.tail_number}
                                </span>
                                <Wrench size={10} className="text-gray-400" /> <span className="truncate">{m.label}</span>
                              </div>
                            );
                          })}
                        </div>
                        {events.reservations.length > 0 && (
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded shrink-0">{events.reservations.length}</span>
                        )}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* ─────────── DAY VIEW (fleet grouped by aircraft) ─────────── */}
        {view === 'day' && (() => {
          const events = getEventsForDate(currentDate);
          // Group reservations by aircraft so we can show a tail-colored header per plane.
          const byAircraft: Record<string, { reservations: Reservation[]; mx: MxBlockRow[] }> = {};
          for (const a of aircraftList) {
            if (!selectedTails.has(a.id)) continue;
            byAircraft[a.id] = { reservations: [], mx: [] };
          }
          for (const r of events.reservations) {
            if (byAircraft[r.aircraft_id]) byAircraft[r.aircraft_id].reservations.push(r);
          }
          for (const m of events.mxBlocks) {
            if (byAircraft[m.aircraft_id]) byAircraft[m.aircraft_id].mx.push(m);
          }
          const orderedIds = aircraftList.map(a => a.id).filter(id => selectedTails.has(id));
          const hasAny = events.reservations.length > 0 || events.mxBlocks.length > 0;
          return (
            <div className="space-y-3">
              {!hasAny && (
                <div className="text-center py-12">
                  <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Plane size={28} className="text-gray-300" />
                  </div>
                  <p className="text-sm text-gray-400 font-oswald font-bold uppercase tracking-widest">Fleet Available</p>
                  <p className="text-xs text-gray-400 font-roboto mt-1">No bookings for this day</p>
                </div>
              )}
              {hasAny && orderedIds.map(id => {
                const group = byAircraft[id];
                const meta = tailMeta[id];
                const isFree = group.reservations.length === 0 && group.mx.length === 0;
                return (
                  <div key={id} className="rounded border border-gray-200 bg-white overflow-hidden">
                    <button
                      onClick={() => onSelectAircraftDate(meta.tail_number, currentDate, 'day')}
                      className="w-full flex items-center justify-between px-3 py-2 text-left active:scale-[0.99] transition-transform"
                      style={{ backgroundColor: hexAlpha(meta.color, 0.12) }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[10px] font-oswald font-bold uppercase tracking-widest px-2 py-0.5 rounded"
                          style={{ backgroundColor: meta.color, color: '#fff' }}
                        >
                          {meta.tail_number}
                        </span>
                        {isFree && (
                          <span className="text-[10px] font-roboto italic text-gray-500">Available all day</span>
                        )}
                      </div>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Open →</span>
                    </button>
                    {(group.reservations.length > 0 || group.mx.length > 0) && (
                      <div className="divide-y divide-gray-100">
                        {group.reservations.map(r => {
                          const multi = isFullDayOrMultiDay(r);
                          return (
                            <div
                              key={r.id}
                              onClick={() => onSelectAircraftDate(meta.tail_number, currentDate, 'day')}
                              className="p-3 cursor-pointer hover:bg-gray-50"
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                                  {r.pilot_initials || '—'}
                                </span>
                                {r.pilot_name && <span className="text-xs text-gray-500 font-roboto truncate">{r.pilot_name}</span>}
                              </div>
                              <div className="flex items-center gap-2 text-sm text-navy font-bold font-roboto">
                                <Clock size={12} className="text-gray-400 shrink-0" />
                                {multi ? <span>All day</span> : <span>{formatTime(r.start_time, r)} – {formatTime(r.end_time, r)}</span>}
                              </div>
                              {r.title && <p className="text-xs text-gray-600 mt-1 font-roboto">{r.title}</p>}
                              {r.route && <p className="text-xs text-gray-500 mt-1 flex items-center gap-1 font-roboto"><MapPin size={11} className="text-[#56B94A] shrink-0" /> {r.route}</p>}
                            </div>
                          );
                        })}
                        {group.mx.map((m, idx) => (
                          <div
                            key={`mx-${idx}`}
                            onClick={() => onSelectAircraftDate(meta.tail_number, currentDate, 'day')}
                            className="p-3 flex items-center gap-2 cursor-pointer hover:bg-gray-50"
                          >
                            <Wrench size={14} className="text-gray-400 shrink-0" />
                            <span className="text-xs font-bold text-navy font-roboto truncate">{m.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* MONTH / YEAR JUMP PICKER */}
      {showDatePicker && (() => {
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const monthsLong = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const todayRef = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth();
        const pickMonth = (monthIdx: number) => {
          const next = new Date(currentDate);
          next.setFullYear(pickerYear);
          next.setMonth(monthIdx);
          if (view === 'month') next.setDate(1);
          setCurrentDate(next);
          setShowDatePicker(false);
        };
        return (
          <div
            className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center p-4 animate-fade-in"
            onClick={() => setShowDatePicker(false)}
          >
            <div
              role="dialog"
              aria-label="Jump to month"
              className="bg-white rounded shadow-2xl w-full max-w-xs p-5 border-t-4 border-[#56B94A] animate-slide-up"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <button
                  type="button"
                  onClick={() => setPickerYear(y => y - 1)}
                  aria-label="Previous year"
                  className="text-gray-400 hover:text-navy active:scale-95 p-1.5 rounded hover:bg-gray-100 transition-colors"
                >
                  <ChevronLeft size={20} />
                </button>
                <span className="font-oswald text-2xl font-bold uppercase tracking-widest text-navy">{pickerYear}</span>
                <button
                  type="button"
                  onClick={() => setPickerYear(y => y + 1)}
                  aria-label="Next year"
                  className="text-gray-400 hover:text-navy active:scale-95 p-1.5 rounded hover:bg-gray-100 transition-colors"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {months.map((m, idx) => {
                  const isCurrent = pickerYear === currentYear && idx === currentMonth;
                  const isThisMonth = pickerYear === todayRef.getFullYear() && idx === todayRef.getMonth();
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => pickMonth(idx)}
                      title={`${monthsLong[idx]} ${pickerYear}`}
                      className={`text-xs font-oswald font-bold uppercase tracking-widest py-3 rounded transition-colors active:scale-95 ${
                        isCurrent
                          ? 'bg-[#56B94A] text-white shadow-sm'
                          : isThisMonth
                            ? 'bg-emerald-50 text-[#56B94A] border border-[#56B94A]/40'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => { setCurrentDate(new Date()); setShowDatePicker(false); }}
                className="w-full mt-4 text-[10px] font-oswald font-bold uppercase tracking-widest text-[#56B94A] hover:bg-emerald-50 py-2 rounded transition-colors"
              >
                Jump to Today
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

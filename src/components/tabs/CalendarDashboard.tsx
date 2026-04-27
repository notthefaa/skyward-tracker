import { useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics, Reservation } from "@/lib/types";
import useSWR from "swr";
import { ChevronDown } from "lucide-react";
import { toLocalYmd } from "@/lib/dateFormat";

const WINDOW = 30;

interface CalendarDashboardProps {
  aircraft: AircraftWithMetrics;
  session: any;
}

function RingGauge({ 
  value, max, label, sublabel, color, size = 90, strokeWidth = 8, suffix = '', children
}: { 
  value: number; max: number; label: string; sublabel: string; 
  color: string; size?: number; strokeWidth?: number; suffix?: string;
  children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const dashOffset = circumference * (1 - pct);

  return (
    <div className="flex flex-col items-center flex-1 min-w-0">
      {/* Floating gauge with drop shadow */}
      <div 
        className="rounded-full bg-white"
        style={{ 
          width: size + 12, height: size + 12, 
          padding: 6,
          boxShadow: `0 4px 16px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06), 0 8px 24px ${color}15`
        }}
      >
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#f0f0f0" strokeWidth={strokeWidth} />
            <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashOffset} style={{ transition: 'stroke-dashoffset 0.6s ease-out' }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-oswald text-xl font-bold leading-none" style={{ color }}>
              {typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(1) : value}
            </span>
            {suffix && <span className="text-[8px] font-bold uppercase tracking-widest text-gray-400 mt-px">{suffix}</span>}
          </div>
        </div>
      </div>
      <span className="text-[9px] font-oswald font-bold uppercase tracking-widest text-navy mt-2 text-center leading-tight">{label}</span>
      <span className="text-[8px] font-bold uppercase tracking-widest text-gray-400 text-center leading-tight">{sublabel}</span>
      {children}
    </div>
  );
}

function countUniqueDays(reservations: Reservation[], startDate: Date, endDate: Date, userId?: string): number {
  const days = new Set<string>();
  const filtered = userId ? reservations.filter(r => r.user_id === userId) : reservations;
  for (const r of filtered) {
    const rStart = new Date(r.start_time); const rEnd = new Date(r.end_time);
    const cursor = new Date(Math.max(rStart.getTime(), startDate.getTime())); cursor.setHours(0,0,0,0);
    const limit = new Date(Math.min(rEnd.getTime(), endDate.getTime()));
    while (cursor <= limit) { days.add(toLocalYmd(cursor)); cursor.setDate(cursor.getDate() + 1); }
  }
  return days.size;
}

export default function CalendarDashboard({ aircraft, session }: CalendarDashboardProps) {
  const [hoursPeriod, setHoursPeriod] = useState(30);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const showCustom = hoursPeriod === -1;
  const isTurbine = aircraft.engine_type === 'Turbine';

  const { data: dashData } = useSWR(
    aircraft ? swrKeys.calDash(aircraft.id) : null,
    async () => {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + WINDOW * 86400000);
      const [resRes, mxRes] = await Promise.all([
        supabase.from('aft_reservations').select('*').eq('aircraft_id', aircraft.id).eq('status', 'confirmed').gte('end_time', now.toISOString()).lte('start_time', windowEnd.toISOString()),
        supabase.from('aft_maintenance_events').select('confirmed_date, estimated_completion, status').eq('aircraft_id', aircraft.id).is('deleted_at', null).in('status', ['confirmed', 'in_progress']),
      ]);
      return {
        reservations: (resRes.data || []) as Reservation[],
        mxBlocks: (mxRes.data || []).filter((e: any) => e.confirmed_date).map((e: any) => ({
          start: new Date(e.confirmed_date + 'T00:00:00'),
          end: e.estimated_completion ? new Date(e.estimated_completion + 'T23:59:59') : new Date(new Date(e.confirmed_date + 'T00:00:00').getTime() + 86400000),
        })),
      };
    },
  );

  const hoursRange = useMemo(() => {
    if (showCustom && customFrom && customTo) return { from: new Date(customFrom + 'T00:00:00'), to: new Date(customTo + 'T23:59:59') };
    const to = new Date(); const from = new Date(); from.setDate(from.getDate() - (showCustom ? 30 : hoursPeriod));
    return { from, to };
  }, [hoursPeriod, customFrom, customTo, showCustom]);

  const { data: flightHours } = useSWR(
    aircraft ? swrKeys.calHours(aircraft.id, hoursRange.from.getTime(), hoursRange.to.getTime()) : null,
    async () => {
      // Hours-flown windows key off occurred_at (when the flight was
      // physically performed), not created_at (when the server saw it).
      // Otherwise an offline-queued flight from yesterday flushed today
      // would land in today's window instead of yesterday's.
      const { data: baseline } = await supabase.from('aft_flight_logs').select('aftt, ftt, hobbs, tach').eq('aircraft_id', aircraft.id).is('deleted_at', null).lt('occurred_at', hoursRange.from.toISOString()).order('occurred_at', { ascending: false }).order('created_at', { ascending: false }).limit(1);
      const { data: current } = await supabase.from('aft_flight_logs').select('aftt, ftt, hobbs, tach').eq('aircraft_id', aircraft.id).is('deleted_at', null).lte('occurred_at', hoursRange.to.toISOString()).order('occurred_at', { ascending: false }).order('created_at', { ascending: false }).limit(1);
      if (!current || current.length === 0) return 0;
      const endLog = current[0] as any;
      // Pick a consistent metric for both endpoints — only use hobbs/aftt
      // if BOTH the start and end logs have it, otherwise fall back to tach/ftt.
      let startLog = (baseline && baseline.length > 0) ? baseline[0] as any : null;
      const canUseAftt = endLog.aftt && (startLog ? startLog.aftt : (aircraft.setup_aftt != null));
      const canUseHobbs = endLog.hobbs && (startLog ? startLog.hobbs : (aircraft.setup_hobbs != null));

      const endVal = isTurbine
        ? (canUseAftt ? endLog.aftt : (endLog.ftt || 0))
        : (canUseHobbs ? endLog.hobbs : (endLog.tach || 0));
      let startVal = 0;
      if (startLog) {
        startVal = isTurbine
          ? (canUseAftt ? (startLog.aftt || 0) : (startLog.ftt || 0))
          : (canUseHobbs ? (startLog.hobbs || 0) : (startLog.tach || 0));
      } else {
        startVal = isTurbine
          ? (canUseAftt ? (aircraft.setup_aftt || 0) : (aircraft.setup_ftt ?? 0))
          : (canUseHobbs ? (aircraft.setup_hobbs || 0) : (aircraft.setup_tach ?? 0));
      }
      return Math.max(0, endVal - startVal);
    }
  );

  const reservations = dashData?.reservations || [];
  const mxBlocks = dashData?.mxBlocks || [];
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const windowEnd = new Date(now.getTime() + WINDOW * 86400000);

  const myDays = countUniqueDays(reservations, now, windowEnd, session?.user?.id);

  const unavailableDays = new Set<string>();
  for (const r of reservations) {
    const cursor = new Date(Math.max(new Date(r.start_time).getTime(), now.getTime())); cursor.setHours(0,0,0,0);
    const limit = new Date(Math.min(new Date(r.end_time).getTime(), windowEnd.getTime()));
    while (cursor <= limit) { unavailableDays.add(toLocalYmd(cursor)); cursor.setDate(cursor.getDate() + 1); }
  }
  for (const m of mxBlocks) {
    const cursor = new Date(Math.max(new Date(m.start).getTime(), now.getTime())); cursor.setHours(0,0,0,0);
    const limit = new Date(Math.min(new Date(m.end).getTime(), windowEnd.getTime()));
    while (cursor <= limit) { unavailableDays.add(toLocalYmd(cursor)); cursor.setDate(cursor.getDate() + 1); }
  }
  const availableDays = WINDOW - unavailableDays.size;
  const availColor = availableDays <= 5 ? '#CE3732' : availableDays <= 15 ? '#F08B46' : '#3AB0FF';

  const hours = flightHours ?? 0;
  const hoursMax = Math.max(hours * 1.5, (showCustom ? 50 : hoursPeriod <= 30 ? 30 : hoursPeriod <= 60 ? 60 : hoursPeriod <= 90 ? 100 : 150));
  
  const periodLabel = showCustom 
    ? (customFrom && customTo ? `${new Date(customFrom).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(customTo).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Select range')
    : `Last ${hoursPeriod}d`;

  return (
    <div className="mt-2 -mb-3">
      {/* Three floating gauges */}
      <div className="flex items-start justify-around gap-3 px-1">
        <RingGauge value={myDays} max={WINDOW} label="My Bookings" sublabel={`Next ${WINDOW}d`} color="#56B94A" suffix="days" />
        <RingGauge value={availableDays} max={WINDOW} label="Available" sublabel={`of ${WINDOW}d`} color={availColor} suffix="days" />
        <RingGauge value={hours} max={hoursMax} label="ACFT Hrs" sublabel={periodLabel} color="#091F3C" suffix="hrs">
          {/* Period selector nested directly under the flight hours gauge */}
          <button 
            onClick={() => setShowPeriodPicker(!showPeriodPicker)}
            className="mt-1.5 flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-widest text-navy/60 hover:text-navy transition-colors active:scale-95"
          >
            Change <ChevronDown size={10} className={`transition-transform ${showPeriodPicker ? 'rotate-180' : ''}`} />
          </button>
        </RingGauge>
      </div>

      {/* Period picker — expands below the flight hours gauge, right-aligned */}
      {showPeriodPicker && (
        <div className="mt-2 flex flex-col items-end pr-1 animate-fade-in">
          <div className="flex gap-1 flex-wrap justify-end">
            {[30, 60, 90, 120].map(d => (
              <button 
                key={d} onClick={() => { setHoursPeriod(d); if (d !== -1) setShowPeriodPicker(false); }}
                className={`text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded transition-colors active:scale-95 ${
                  hoursPeriod === d && !showCustom ? 'bg-navy text-white' : 'bg-white text-gray-500 hover:bg-gray-100 shadow-sm'
                }`}
              >{d}d</button>
            ))}
            <button 
              onClick={() => setHoursPeriod(-1)}
              className={`text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded transition-colors active:scale-95 ${
                showCustom ? 'bg-navy text-white' : 'bg-white text-gray-500 hover:bg-gray-100 shadow-sm'
              }`}
            >Custom</button>
          </div>
          {showCustom && (
            <div className="flex gap-2 mt-1.5 items-center animate-fade-in">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="min-w-[110px] border border-gray-300 rounded px-2.5 py-1.5 text-[10px] focus:border-navy outline-none text-center bg-white shadow-sm" />
              <span className="text-gray-400 text-[9px] font-bold shrink-0">to</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="min-w-[110px] border border-gray-300 rounded px-2.5 py-1.5 text-[10px] focus:border-navy outline-none text-center bg-white shadow-sm" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

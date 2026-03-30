import { useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import type { AircraftWithMetrics, Reservation } from "@/lib/types";
import useSWR from "swr";

const WINDOW = 30; // 30-day forward visibility

interface CalendarDashboardProps {
  aircraft: AircraftWithMetrics;
  session: any;
}

// ─── SVG Ring Gauge ───
function RingGauge({ 
  value, max, label, sublabel, color, size = 120, strokeWidth = 10, suffix = ''
}: { 
  value: number; max: number; label: string; sublabel: string; 
  color: string; size?: number; strokeWidth?: number; suffix?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const dashOffset = circumference * (1 - pct);

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Background track */}
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth}
          />
          {/* Filled arc */}
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-oswald text-2xl font-bold leading-none" style={{ color }}>
            {typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(1) : value}
          </span>
          {suffix && <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">{suffix}</span>}
        </div>
      </div>
      <span className="text-[10px] font-oswald font-bold uppercase tracking-widest text-navy mt-2 text-center leading-tight">{label}</span>
      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 text-center leading-tight">{sublabel}</span>
    </div>
  );
}

// ─── Helpers ───
function countUniqueDays(reservations: Reservation[], startDate: Date, endDate: Date, userId?: string): number {
  const days = new Set<string>();
  const filtered = userId 
    ? reservations.filter(r => r.user_id === userId) 
    : reservations;
  
  for (const r of filtered) {
    const rStart = new Date(r.start_time);
    const rEnd = new Date(r.end_time);
    // Walk each day the reservation covers
    const cursor = new Date(Math.max(rStart.getTime(), startDate.getTime()));
    cursor.setHours(0, 0, 0, 0);
    const limit = new Date(Math.min(rEnd.getTime(), endDate.getTime()));
    while (cursor <= limit) {
      days.add(cursor.toISOString().split('T')[0]);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return days.size;
}

function countMxBlockedDays(mxBlocks: { start: Date; end: Date }[], startDate: Date, endDate: Date): number {
  const days = new Set<string>();
  for (const m of mxBlocks) {
    const cursor = new Date(Math.max(m.start.getTime(), startDate.getTime()));
    cursor.setHours(0, 0, 0, 0);
    const limit = new Date(Math.min(m.end.getTime(), endDate.getTime()));
    while (cursor <= limit) {
      days.add(cursor.toISOString().split('T')[0]);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return days.size;
}

export default function CalendarDashboard({ aircraft, session }: CalendarDashboardProps) {
  const [hoursPeriod, setHoursPeriod] = useState(30);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const showCustom = hoursPeriod === -1;

  const isTurbine = aircraft.engine_type === 'Turbine';

  // Fetch next-30-day reservations + MX blocks for the dashboard
  const { data: dashData } = useSWR(
    aircraft ? `cal-dash-${aircraft.id}` : null,
    async () => {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + WINDOW * 24 * 60 * 60 * 1000);

      const [resRes, mxRes] = await Promise.all([
        supabase.from('aft_reservations').select('*')
          .eq('aircraft_id', aircraft.id).eq('status', 'confirmed')
          .gte('end_time', now.toISOString()).lte('start_time', windowEnd.toISOString()),
        supabase.from('aft_maintenance_events')
          .select('confirmed_date, estimated_completion, status')
          .eq('aircraft_id', aircraft.id).in('status', ['confirmed', 'in_progress']),
      ]);

      const reservations = (resRes.data || []) as Reservation[];
      const mxBlocks = (mxRes.data || [])
        .filter((e: any) => e.confirmed_date)
        .map((e: any) => ({
          start: new Date(e.confirmed_date + 'T00:00:00'),
          end: e.estimated_completion 
            ? new Date(e.estimated_completion + 'T23:59:59') 
            : new Date(new Date(e.confirmed_date + 'T00:00:00').getTime() + 24 * 60 * 60 * 1000),
        }));

      return { reservations, mxBlocks };
    },
    { revalidateOnMount: true }
  );

  // Flight hours query — based on selected period
  const hoursRange = useMemo(() => {
    if (showCustom && customFrom && customTo) {
      return { from: new Date(customFrom + 'T00:00:00'), to: new Date(customTo + 'T23:59:59') };
    }
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (showCustom ? 30 : hoursPeriod));
    return { from, to };
  }, [hoursPeriod, customFrom, customTo, showCustom]);

  const { data: flightHours } = useSWR(
    aircraft ? `cal-hours-${aircraft.id}-${hoursRange.from.getTime()}-${hoursRange.to.getTime()}` : null,
    async () => {
      // Get the last log BEFORE the range start (baseline)
      const { data: baseline } = await supabase
        .from('aft_flight_logs')
        .select('aftt, hobbs, tach')
        .eq('aircraft_id', aircraft.id)
        .lt('created_at', hoursRange.from.toISOString())
        .order('created_at', { ascending: false })
        .limit(1);

      // Get the last log WITHIN or before the range end (current)
      const { data: current } = await supabase
        .from('aft_flight_logs')
        .select('aftt, hobbs, tach')
        .eq('aircraft_id', aircraft.id)
        .lte('created_at', hoursRange.to.toISOString())
        .order('created_at', { ascending: false })
        .limit(1);

      if (!current || current.length === 0) return 0;

      const endLog = current[0] as any;
      const endVal = isTurbine 
        ? (endLog.aftt || 0)
        : (endLog.hobbs || endLog.tach || 0);

      let startVal = 0;
      if (baseline && baseline.length > 0) {
        const startLog = baseline[0] as any;
        startVal = isTurbine 
          ? (startLog.aftt || 0)
          : (startLog.hobbs || startLog.tach || 0);
      } else {
        // No log before range — use setup values
        startVal = isTurbine
          ? (aircraft.setup_aftt || 0)
          : (aircraft.setup_hobbs || aircraft.setup_tach || 0);
      }

      return Math.max(0, endVal - startVal);
    }
  );

  const reservations = dashData?.reservations || [];
  const mxBlocks = dashData?.mxBlocks || [];
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const windowEnd = new Date(now.getTime() + WINDOW * 24 * 60 * 60 * 1000);

  const myDays = countUniqueDays(reservations, now, windowEnd, session?.user?.id);
  const totalBookedDays = countUniqueDays(reservations, now, windowEnd);
  const mxDays = countMxBlockedDays(mxBlocks, now, windowEnd);
  const unavailableDays = new Set<string>();
  
  // Merge booked + MX days for availability calc
  for (const r of reservations) {
    const rStart = new Date(r.start_time); const rEnd = new Date(r.end_time);
    const cursor = new Date(Math.max(rStart.getTime(), now.getTime())); cursor.setHours(0,0,0,0);
    const limit = new Date(Math.min(rEnd.getTime(), windowEnd.getTime()));
    while (cursor <= limit) { unavailableDays.add(cursor.toISOString().split('T')[0]); cursor.setDate(cursor.getDate() + 1); }
  }
  for (const m of mxBlocks) {
    const cursor = new Date(Math.max(m.start.getTime(), now.getTime())); cursor.setHours(0,0,0,0);
    const limit = new Date(Math.min(m.end.getTime(), windowEnd.getTime()));
    while (cursor <= limit) { unavailableDays.add(cursor.toISOString().split('T')[0]); cursor.setDate(cursor.getDate() + 1); }
  }
  const availableDays = WINDOW - unavailableDays.size;

  const hours = flightHours ?? 0;
  // Max for the hours gauge — scale based on period for visual context
  const hoursMax = Math.max(hours * 1.5, (showCustom ? 50 : hoursPeriod <= 30 ? 30 : hoursPeriod <= 60 ? 60 : hoursPeriod <= 90 ? 100 : 150));

  const periodLabel = showCustom 
    ? (customFrom && customTo ? `${new Date(customFrom).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(customTo).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Select dates')
    : `Last ${hoursPeriod} days`;

  return (
    <div className="bg-cream shadow-lg rounded-sm p-4 border-t-4 border-navy mb-4">
      {/* Top row: booking gauges */}
      <div className="flex justify-around items-start mb-4">
        <RingGauge 
          value={myDays} max={WINDOW} 
          label="My Bookings" sublabel={`Next ${WINDOW} days`}
          color="#56B94A" suffix="days"
        />
        <RingGauge 
          value={availableDays} max={WINDOW}
          label="Available" sublabel={`of ${WINDOW} days`}
          color="#3AB0FF" suffix="days"
        />
      </div>

      {/* Flight hours section */}
      <div className="border-t border-gray-200 pt-4">
        <div className="flex justify-center mb-3">
          <RingGauge
            value={hours} max={hoursMax}
            label="Flight Hours" sublabel={periodLabel}
            color="#091F3C" suffix="hrs" size={130} strokeWidth={12}
          />
        </div>

        {/* Period selector */}
        <div className="flex justify-center gap-1.5 flex-wrap">
          {[30, 60, 90, 120].map(d => (
            <button 
              key={d} 
              onClick={() => setHoursPeriod(d)}
              className={`text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded transition-colors active:scale-95 ${
                hoursPeriod === d && !showCustom
                  ? 'bg-navy text-white' 
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {d}d
            </button>
          ))}
          <button 
            onClick={() => setHoursPeriod(-1)}
            className={`text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded transition-colors active:scale-95 ${
              showCustom ? 'bg-navy text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Custom
          </button>
        </div>

        {/* Custom date range */}
        {showCustom && (
          <div className="flex gap-2 mt-3 justify-center animate-fade-in">
            <input 
              type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-xs focus:border-navy outline-none"
            />
            <span className="text-gray-400 text-xs self-center">to</span>
            <input 
              type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-xs focus:border-navy outline-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}

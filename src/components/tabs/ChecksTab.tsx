"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics, VorCheck, TireCheck, OilLog } from "@/lib/types";
import useSWR from "swr";
import dynamic from "next/dynamic";
import { AlertTriangle, Droplets, Compass } from "lucide-react";
import { TireIcon } from "@/components/shell/TrayIcons";
import { TabSkeleton } from "@/components/Skeletons";

// Embed the individual tab surfaces inline. Each one keeps its own
// form/modal/pagination — we're not re-implementing, we're orchestrating.
const VorTab = dynamic(() => import("@/components/tabs/VorTab"), { loading: () => <TabSkeleton /> });
const OilTab = dynamic(() => import("@/components/tabs/OilTab"), { loading: () => <TabSkeleton /> });
const TireTab = dynamic(() => import("@/components/tabs/TireTab"), { loading: () => <TabSkeleton /> });

// ─── Shared ring-gauge (matches CalendarDashboard's visual so the two
// dashboards read as a family). ───

interface RingGaugeProps {
  value: number | string;
  progress: number; // 0..1 — how much of the arc to fill
  label: string;
  sublabel: string;
  color: string;
  warning?: string; // amber/red warning text shown below sublabel
  onClick?: () => void;
  size?: number;
  strokeWidth?: number;
  suffix?: string;
  /** Optional content rendered below the warning (e.g., a compact
   * action button). Clicks inside should stopPropagation so the
   * dial's onClick doesn't re-fire. */
  children?: React.ReactNode;
}

function RingGauge({
  value, progress, label, sublabel, color, warning, onClick,
  size = 90, strokeWidth = 8, suffix, children,
}: RingGaugeProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(Math.max(progress, 0), 1);
  const dashOffset = circumference * (1 - pct);

  const wrapperClass = `flex flex-col items-center flex-1 min-w-0 ${onClick ? 'cursor-pointer active:scale-95 transition-transform' : ''}`;

  return (
    <div className={wrapperClass} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      <div
        className="rounded-full bg-white"
        style={{
          width: size + 12, height: size + 12, padding: 6,
          boxShadow: `0 4px 16px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06), 0 8px 24px ${color}15`,
        }}
      >
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f0f0f0" strokeWidth={strokeWidth} />
            <circle
              cx={size / 2} cy={size / 2} r={radius}
              fill="none" stroke={color} strokeWidth={strokeWidth}
              strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-oswald text-xl font-bold leading-none" style={{ color }}>
              {typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(1) : value}
            </span>
            {suffix && <span className="text-[8px] font-bold uppercase tracking-widest text-gray-400 mt-px">{suffix}</span>}
          </div>
        </div>
      </div>
      <span className="text-[9px] font-oswald font-bold uppercase tracking-widest text-navy mt-2 text-center leading-tight">
        {label}
      </span>
      <span className="text-[8px] font-bold uppercase tracking-widest text-gray-400 text-center leading-tight">
        {sublabel}
      </span>
      {warning && (
        <span
          className="text-[8px] font-bold uppercase tracking-widest text-center leading-tight mt-0.5 max-w-[120px]"
          style={{ color }}
        >
          {warning}
        </span>
      )}
      {children}
    </div>
  );
}

// ─── Status logic — separated from rendering for clarity and testability. ───

const COLOR_GREEN = '#56B94A';
const COLOR_ORANGE = '#F08B46';
const COLOR_RED = '#CE3732';
const COLOR_GRAY = '#9CA3AF';

interface DialState {
  value: number | string;
  progress: number;
  color: string;
  sublabel: string;
  warning?: string;
  suffix?: string;
}

function vorDial(latest: VorCheck | null, now: Date): DialState {
  if (!latest) {
    return {
      value: '—', progress: 0, color: COLOR_GRAY,
      sublabel: 'No check on file', suffix: 'days',
    };
  }
  const checked = new Date(latest.created_at);
  const expires = new Date(checked);
  expires.setDate(expires.getDate() + 30);
  const daysRemaining = Math.ceil((expires.getTime() - now.getTime()) / 86400_000);
  const daysSince = Math.floor((now.getTime() - checked.getTime()) / 86400_000);

  // Arc fills as we approach expiry (days_since / 30).
  const progress = Math.min(Math.max(daysSince / 30, 0), 1);

  if (daysRemaining <= 0) {
    return {
      value: 'EXP', progress: 1, color: COLOR_RED,
      sublabel: `Expired ${Math.abs(daysRemaining)}d ago`,
      warning: 'VOR Check Expired',
    };
  }
  if (daysRemaining <= 10) {
    return {
      value: daysRemaining, progress, color: COLOR_ORANGE,
      sublabel: 'Days remaining', suffix: 'days',
      warning: 'VOR Check Due Soon',
    };
  }
  return {
    value: daysRemaining, progress, color: COLOR_GREEN,
    sublabel: 'Days remaining', suffix: 'days',
  };
}

function tireDial(latest: TireCheck | null, now: Date): DialState {
  if (!latest) {
    return {
      value: '—', progress: 0, color: COLOR_GRAY,
      sublabel: 'No check on file',
      warning: 'Check Tire Pressures',
    };
  }
  const checked = new Date(latest.created_at);
  const daysSince = Math.floor((now.getTime() - checked.getTime()) / 86400_000);
  const progress = Math.min(Math.max(daysSince / 30, 0), 1);

  if (daysSince >= 30) {
    return {
      value: daysSince, progress: 1, color: COLOR_RED,
      sublabel: 'Days since', suffix: 'days',
      warning: 'Check Tire Pressures',
    };
  }
  if (daysSince >= 15) {
    return {
      value: daysSince, progress, color: COLOR_ORANGE,
      sublabel: 'Days since', suffix: 'days',
      warning: 'Check Tire Pressures',
    };
  }
  return {
    value: daysSince, progress, color: COLOR_GREEN,
    sublabel: 'Days since', suffix: 'days',
  };
}

/** Oil dial — tracks engine HOURS since the most recent oil addition
 * (not just any oil-log entry, since a zero-add level-check shouldn't
 * reset the counter). Short interval between adds = high consumption. */
function oilDial(lastAdded: OilLog | null, currentEngineHours: number): DialState {
  if (!lastAdded) {
    return {
      value: '—', progress: 0, color: COLOR_GRAY,
      sublabel: 'No oil additions logged', suffix: 'hrs',
    };
  }
  const hoursSince = Math.max(0, currentEngineHours - lastAdded.engine_hours);

  // Arc grows as hours accumulate, capped at 20 for visual consistency
  // (10+ hrs = healthy; show headroom up to 20 before the arc saturates).
  const progress = Math.min(hoursSince / 20, 1);

  if (hoursSince < 5) {
    return {
      value: hoursSince, progress, color: COLOR_RED,
      sublabel: 'Hrs since add', suffix: 'hrs',
      warning: 'Check Oil Consumption',
    };
  }
  if (hoursSince < 10) {
    return {
      value: hoursSince, progress, color: COLOR_ORANGE,
      sublabel: 'Hrs since add', suffix: 'hrs',
      warning: 'Slightly Higher Consumption',
    };
  }
  return {
    value: hoursSince, progress, color: COLOR_GREEN,
    sublabel: 'Hrs since add', suffix: 'hrs',
  };
}

// ─── Main component ───

interface Props {
  aircraft: AircraftWithMetrics | null;
  session: any;
  role: string;
  userInitials: string;
}

export default function ChecksTab({ aircraft, session, role, userInitials }: Props) {
  const vorRef = useRef<HTMLDivElement>(null);
  const oilRef = useRef<HTMLDivElement>(null);
  const tireRef = useRef<HTMLDivElement>(null);

  // Incrementing counters used to signal the embedded sub-tabs to open
  // their own log-entry form. Using a counter (not a boolean) so
  // repeated taps fire repeatedly even if the state value doesn't
  // change shape. Each sub-tab watches its prop via useEffect.
  const [vorOpenSignal, setVorOpenSignal] = useState(0);
  const [oilOpenSignal, setOilOpenSignal] = useState(0);
  const [tireOpenSignal, setTireOpenSignal] = useState(0);

  // Reuse the SWR keys the embedded tabs already populate. When any
  // sub-tab submits a new log, it calls mutate() on these same keys,
  // so the dashboard refreshes automatically without any cross-tab
  // coupling. One exception: oil tracks "hours since last ADDED" (not
  // last log), which needs its own small query — we still key it by
  // aircraft so matchesAircraft(id) invalidates it on any aircraft
  // write.
  const { data: vorLatest } = useSWR<VorCheck | null>(
    aircraft ? swrKeys.vorLatest(aircraft.id) : null,
    async () => {
      const { data } = await supabase
        .from('aft_vor_checks').select('*').eq('aircraft_id', aircraft!.id).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(1);
      return (data?.[0] as VorCheck | undefined) || null;
    },
  );
  const { data: tirePage1 } = useSWR(
    aircraft ? swrKeys.tire(aircraft.id, 1) : null,
    async () => {
      const { data } = await supabase
        .from('aft_tire_checks').select('*').eq('aircraft_id', aircraft!.id).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(10);
      return { checks: (data || []) as TireCheck[] };
    },
  );
  // Oil: we want the most recent entry where oil_added > 0. A pure
  // level-check with oil_added null/0 shouldn't reset the "hours since
  // last add" consumption indicator.
  const { data: oilLastAdded } = useSWR<OilLog | null>(
    aircraft ? swrKeys.oilLastAdded(aircraft.id) : null,
    async () => {
      const { data } = await supabase
        .from('aft_oil_logs').select('*').eq('aircraft_id', aircraft!.id).is('deleted_at', null)
        .gt('oil_added', 0).order('created_at', { ascending: false }).limit(1);
      return (data?.[0] as OilLog | undefined) || null;
    },
  );

  if (!aircraft) return null;

  const now = new Date();
  const vor = vorDial(vorLatest ?? null, now);
  const tire = tireDial(tirePage1?.checks?.[0] ?? null, now);
  const oil = oilDial(oilLastAdded ?? null, aircraft.total_engine_time || 0);

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (!ref.current) return;
    // Use the section header as the anchor target so the dial + sticky
    // nav don't occlude the top of the section on scroll.
    ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Compact button that sits under each dial. Taps scroll to the
  // matching section AND signal the sub-tab to open its log-entry
  // modal. stopPropagation so the dial's onClick doesn't double-fire.
  const DialAction = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onPress(); }}
      className="mt-2 text-[9px] font-bold uppercase tracking-widest text-navy/70 hover:text-navy active:scale-95 transition-all px-2 py-0.5 rounded border border-gray-300 bg-white shadow-sm"
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Dashboard dials — styled to match the Calendar dashboard: no
       * container card, just the floating gauges on the page with a
       * lightweight header row above. */}
      <div className="mt-1">
        <div className="flex items-baseline justify-between px-1 mb-3">
          <h2 className="font-oswald text-xl md:text-2xl font-bold uppercase text-navy m-0 leading-none">
            Operational Checks
          </h2>
          <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">
            Tap a dial to jump
          </span>
        </div>
        <div className="flex items-start justify-around gap-3 px-1">
          <RingGauge
            value={vor.value}
            progress={vor.progress}
            color={vor.color}
            label="VOR"
            sublabel={vor.sublabel}
            warning={vor.warning}
            suffix={vor.suffix}
            onClick={() => scrollTo(vorRef)}
          >
            <DialAction label="Log VOR" onPress={() => { scrollTo(vorRef); setVorOpenSignal(n => n + 1); }} />
          </RingGauge>
          <RingGauge
            value={oil.value}
            progress={oil.progress}
            color={oil.color}
            label="Oil"
            sublabel={oil.sublabel}
            warning={oil.warning}
            suffix={oil.suffix}
            onClick={() => scrollTo(oilRef)}
          >
            <DialAction label="Log Oil" onPress={() => { scrollTo(oilRef); setOilOpenSignal(n => n + 1); }} />
          </RingGauge>
          <RingGauge
            value={tire.value}
            progress={tire.progress}
            color={tire.color}
            label="Tires"
            sublabel={tire.sublabel}
            warning={tire.warning}
            suffix={tire.suffix}
            onClick={() => scrollTo(tireRef)}
          >
            <DialAction label="Log Tires" onPress={() => { scrollTo(tireRef); setTireOpenSignal(n => n + 1); }} />
          </RingGauge>
        </div>
      </div>

      {/* VOR section */}
      <section ref={vorRef} className="scroll-mt-20">
        <div className="flex items-center gap-2 mb-2 pl-1">
          <Compass size={16} className="text-[#F08B46]" />
          <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy m-0 leading-none">
            VOR
          </h3>
          {vor.warning && (
            <span
              className="text-[9px] font-bold uppercase tracking-widest inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
              style={{ color: vor.color, backgroundColor: `${vor.color}14` }}
            >
              <AlertTriangle size={10} /> {vor.warning}
            </span>
          )}
        </div>
        <VorTab aircraft={aircraft} session={session} role={role} userInitials={userInitials} openFormSignal={vorOpenSignal} />
      </section>

      {/* Oil section (includes the consumption graph already baked into OilTab) */}
      <section ref={oilRef} className="scroll-mt-20">
        <div className="flex items-center gap-2 mb-2 pl-1">
          <Droplets size={16} className="text-[#CE3732]" />
          <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy m-0 leading-none">
            Oil
          </h3>
          {oil.warning && (
            <span
              className="text-[9px] font-bold uppercase tracking-widest inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
              style={{ color: oil.color, backgroundColor: `${oil.color}14` }}
            >
              <AlertTriangle size={10} /> {oil.warning}
            </span>
          )}
        </div>
        <OilTab aircraft={aircraft} session={session} role={role} userInitials={userInitials} openFormSignal={oilOpenSignal} />
      </section>

      {/* Tire section */}
      <section ref={tireRef} className="scroll-mt-20">
        <div className="flex items-center gap-2 mb-2 pl-1">
          <TireIcon size={16} style={{ color: '#525659' }} />
          <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy m-0 leading-none">
            Tires
          </h3>
          {tire.warning && (
            <span
              className="text-[9px] font-bold uppercase tracking-widest inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
              style={{ color: tire.color, backgroundColor: `${tire.color}14` }}
            >
              <AlertTriangle size={10} /> {tire.warning}
            </span>
          )}
        </div>
        <TireTab aircraft={aircraft} session={session} role={role} userInitials={userInitials} openFormSignal={tireOpenSignal} />
      </section>
    </div>
  );
}

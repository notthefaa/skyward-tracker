import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { processMxItem } from "@/lib/math";
import type { AircraftWithMetrics } from "@/lib/types";
import useSWR from "swr";
import dynamic from "next/dynamic";
import { PlaneTakeoff, Wrench, AlertTriangle, Droplet, Clock, LayoutGrid, Calendar } from "lucide-react";
import { FleetSkeleton } from "@/components/Skeletons";

const FleetSchedule = dynamic(() => import("@/components/tabs/FleetSchedule"));

type FleetView = 'fleet' | 'schedule';

/** Check if an MX item has been set up (has a due value) */
function isItemSetUp(item: any): boolean {
  if (item.tracking_type === 'time') return item.due_time !== null && item.due_time !== undefined;
  if (item.tracking_type === 'date') return item.due_date !== null && item.due_date !== undefined;
  return true;
}

/** Format a "last flown" label from a date and initials */
function formatLastFlown(createdAt: string, initials: string | null): string {
  const flightDate = new Date(createdAt);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - flightDate.getTime()) / (1000 * 60 * 60 * 24));
  const timeAgo = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Yesterday' : `${diffDays}d ago`;
  return `${timeAgo}${initials ? ` by ${initials}` : ''}`;
}

/** Build a short "Due in ..." label for the fleet card. */
function formatNextMxDue(item: { tracking_type: string; remaining: number; isExpired: boolean }): string {
  if (item.tracking_type === 'time') {
    const hrs = Math.abs(item.remaining).toFixed(1);
    return item.isExpired ? `Overdue by ${hrs} hrs` : `Due in ${hrs} hrs`;
  }
  // date
  const days = Math.abs(item.remaining);
  if (item.isExpired) return days === 1 ? 'Overdue by 1 day' : `Overdue by ${days} days`;
  if (item.remaining === 0) return 'Due today';
  if (item.remaining === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

export default function FleetSummary({
  aircraftList, onSelectAircraft, onSelectAircraftDate
}: {
  aircraftList: AircraftWithMetrics[],
  onSelectAircraft: (tail: string) => void,
  onSelectAircraftDate?: (tail: string, date: Date, view: 'month' | 'week' | 'day') => void,
}) {
  const [fleetView, setFleetView] = useState<FleetView>('fleet');
  const { data: fleetData = [], isLoading } = useSWR(
    aircraftList.length > 0 ? `fleet-${aircraftList.length}-${aircraftList.map(a => a.id).join(',')}` : null,
    async () => {
      const aircraftIds = aircraftList.map(a => a.id);

      const [mxRes, sqRes, logRes] = await Promise.all([
        supabase.from('aft_maintenance_items')
          .select('aircraft_id, item_name, tracking_type, is_required, due_time, due_date, time_interval')
          .in('aircraft_id', aircraftIds),
        supabase.from('aft_squawks')
          .select('aircraft_id, affects_airworthiness')
          .in('aircraft_id', aircraftIds)
          .eq('status', 'open'),
        supabase.from('aft_flight_logs')
          .select('aircraft_id, created_at, initials')
          .in('aircraft_id', aircraftIds)
          .order('created_at', { ascending: false }),
      ]);
      const mxData = mxRes.data || [];
      const sqData = sqRes.data || [];
      const logData = logRes.data || [];

      // Pre-index by aircraft_id
      const mxByAircraft: Record<string, any[]> = {};
      const sqByAircraft: Record<string, any[]> = {};
      const lastFlightByAircraft: Record<string, { created_at: string; initials: string | null }> = {};
      
      for (const m of mxData) {
        if (!mxByAircraft[m.aircraft_id]) mxByAircraft[m.aircraft_id] = [];
        mxByAircraft[m.aircraft_id].push(m);
      }
      for (const s of sqData) {
        if (!sqByAircraft[s.aircraft_id]) sqByAircraft[s.aircraft_id] = [];
        sqByAircraft[s.aircraft_id].push(s);
      }
      // Logs are sorted descending — first occurrence per aircraft_id is the latest
      for (const log of logData) {
        if (!lastFlightByAircraft[log.aircraft_id]) {
          lastFlightByAircraft[log.aircraft_id] = { created_at: log.created_at, initials: log.initials };
        }
      }

      return aircraftList.map(ac => {
        const acMx = mxByAircraft[ac.id] || [];
        const acSq = sqByAircraft[ac.id] || [];
        const lastFlight = lastFlightByAircraft[ac.id] || null;
        let isGrounded = false;
        let hasIssues = acSq.length > 0;

        // Only check items that have been set up (non-null due values)
        const activeItems = acMx.filter(isItemSetUp);

        for (const item of activeItems) {
          if (!item.is_required) continue;
          if (item.tracking_type === 'time' && (item.due_time ?? 0) <= (ac.total_engine_time || 0)) { isGrounded = true; break; }
          if (item.tracking_type === 'date' && new Date((item.due_date ?? '') + 'T00:00:00') < new Date(new Date().setHours(0,0,0,0))) { isGrounded = true; break; }
        }
        if (acSq.some((sq: any) => sq.affects_airworthiness)) isGrounded = true;

        // Find next MX due — only from active (set up) items
        const processedMx = activeItems.map(item => processMxItem(item, ac.total_engine_time || 0, ac.burnRate, ac.burnRateLow, ac.burnRateHigh));
        processedMx.sort((a, b) => a.remaining - b.remaining);
        const nextMx = processedMx[0];

        // Count needs-setup items
        const needsSetupCount = acMx.length - activeItems.length;

        return {
          ...ac,
          status: isGrounded ? 'grounded' as const : (hasIssues ? 'issues' as const : 'airworthy' as const),
          squawkCount: acSq.length,
          nextMxName: nextMx ? nextMx.item_name : (needsSetupCount > 0 ? `${needsSetupCount} Need Setup` : 'No MX Tracked'),
          nextMxDueLabel: nextMx ? formatNextMxDue(nextMx) : null,
          nextMxIsExpired: nextMx ? nextMx.isExpired : false,
          lastFlownLabel: lastFlight ? formatLastFlown(lastFlight.created_at, lastFlight.initials) : null,
        };
      });
    },
  );

  if (isLoading && fleetData.length === 0) {
    return <FleetSkeleton count={aircraftList.length || 2} />;
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="bg-navy p-6 rounded-sm shadow-lg text-white border-t-4 border-[#F5B05B]">
        <div className="flex justify-between items-center gap-4">
          <h2 className="font-oswald text-3xl md:text-4xl font-bold uppercase tracking-widest leading-none min-w-0">My Fleet</h2>
          {onSelectAircraftDate && (
            <div className="flex flex-col gap-1.5 shrink-0">
              <button
                onClick={() => setFleetView('fleet')}
                className={`text-[10px] font-oswald font-bold uppercase tracking-widest px-3 py-1.5 rounded flex items-center gap-1.5 justify-start transition-colors active:scale-95 ${fleetView === 'fleet' ? 'bg-[#F5B05B] text-navy shadow-sm' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
              >
                <LayoutGrid size={12} /> Fleet Summary
              </button>
              <button
                onClick={() => setFleetView('schedule')}
                className={`text-[10px] font-oswald font-bold uppercase tracking-widest px-3 py-1.5 rounded flex items-center gap-1.5 justify-start transition-colors active:scale-95 ${fleetView === 'schedule' ? 'bg-[#F5B05B] text-navy shadow-sm' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
              >
                <Calendar size={12} /> Fleet Schedule
              </button>
            </div>
          )}
        </div>
      </div>
      {fleetView === 'schedule' && onSelectAircraftDate ? (
        <FleetSchedule
          aircraftList={aircraftList}
          onSelectAircraftDate={onSelectAircraftDate}
        />
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-4">
        {fleetData.map(ac => {
          const fuelGals = ac.current_fuel_gallons || 0;
          const statusColor = ac.status === 'grounded' ? 'bg-[#CE3732]' : ac.status === 'issues' ? 'bg-[#F08B46]' : 'bg-success';
          const borderColor = ac.status === 'grounded' ? 'border-[#CE3732]' : ac.status === 'issues' ? 'border-[#F08B46]' : 'border-success';
          return (
            <div key={ac.id} onClick={() => onSelectAircraft(ac.tail_number)} className={`bg-white shadow-md rounded-sm border-t-4 ${borderColor} overflow-hidden cursor-pointer hover:shadow-xl transition-all active:scale-[0.98] flex flex-col`}>
              <div className="flex justify-between items-center p-4 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-4">
                  {ac.avatar_url ? <img src={ac.avatar_url} alt="Avatar" className="w-12 h-12 object-cover rounded-full border-2 border-white shadow-sm" /> : <div className="w-12 h-12 rounded-full bg-slateGray flex items-center justify-center text-white shadow-sm"><PlaneTakeoff size={20}/></div>}
                  <div>
                    <h3 className="font-oswald text-2xl font-bold text-navy leading-none uppercase">{ac.tail_number}</h3>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-1">{ac.aircraft_type}</p>
                  </div>
                </div>
                <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest text-white shadow-inner ${statusColor}`}>
                  {ac.status === 'grounded' ? 'Grounded' : 'Airworthy'}
                </div>
              </div>
              {(() => {
                const isTurb = ac.engine_type === 'Turbine';
                const hasAirframe = isTurb ? (ac.setup_aftt != null) : (ac.setup_hobbs != null);
                return (
                  <div className={`p-4 grid ${hasAirframe ? 'grid-cols-3' : 'grid-cols-2'} gap-4`}>
                    {hasAirframe && (
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex items-center gap-1 mb-1"><Clock size={12}/> {isTurb ? 'AFTT' : 'Hobbs'}</span>
                        <p className="text-xl font-roboto font-bold text-navy">{ac.total_airframe_time?.toFixed(1) || 0} <span className="text-xs text-gray-400">hrs</span></p>
                      </div>
                    )}
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex items-center gap-1 mb-1"><Clock size={12}/> {isTurb ? 'FTT' : 'Tach'}</span>
                      <p className="text-xl font-roboto font-bold text-navy">{ac.total_engine_time?.toFixed(1) || 0} <span className="text-xs text-gray-400">hrs</span></p>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex items-center gap-1 mb-1"><Droplet size={12} className="text-blue-500"/> Fuel State</span>
                      <p className="text-xl font-roboto font-bold text-navy">{fuelGals.toFixed(0)} <span className="text-xs text-gray-400">gal</span></p>
                    </div>
                  </div>
                );
              })()}
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                {(ac.nextMxDueLabel || ac.squawkCount > 0) && (
                  <div className="flex items-center justify-between mb-2">
                    {ac.nextMxDueLabel ? (
                      <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${ac.nextMxIsExpired ? 'bg-[#CE3732] text-white' : 'bg-[#F08B46]/15 text-[#F08B46]'}`}>
                        {ac.nextMxIsExpired ? 'Overdue' : 'Next Up'}
                      </span>
                    ) : <span />}
                    {ac.squawkCount > 0 && (
                      <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-[#CE3732]/15 text-[#CE3732] flex items-center gap-1">
                        <AlertTriangle size={10} /> {ac.squawkCount} Open
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-start gap-2.5">
                  <Wrench size={14} className="text-[#F08B46] shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-navy truncate leading-tight">{ac.nextMxName}</p>
                    {ac.nextMxDueLabel && (
                      <p className={`text-[10px] font-bold uppercase tracking-widest mt-0.5 ${ac.nextMxIsExpired ? 'text-[#CE3732]' : 'text-gray-500'}`}>
                        {ac.nextMxDueLabel}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              {ac.lastFlownLabel && (
                <div className="px-4 py-2 border-t border-gray-100 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Last Flown: {ac.lastFlownLabel}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

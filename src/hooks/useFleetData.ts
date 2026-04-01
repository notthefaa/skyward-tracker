"use client";

import { useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { enrichAircraftWithMetrics } from "@/lib/math";
import { useSWRConfig } from "swr";
import { FLIGHT_DATA_LOOKBACK_DAYS } from "@/lib/constants";
import type { AircraftWithMetrics, SystemSettings, AppRole } from "@/lib/types";

/**
 * Default metric values for aircraft that haven't had their metrics computed yet.
 * These are safe defaults that won't trigger false alarms or broken UI.
 */
const DEFAULT_METRICS = {
  burnRate: 0,
  confidenceScore: 0,
  burnRateCV: 1.0,
  burnRateLow: 0,
  burnRateHigh: 0,
};

export function useFleetData() {
  const [role, setRole] = useState<AppRole>('pilot');
  const [userInitials, setUserInitials] = useState("");
  const [allAircraftList, setAllAircraftList] = useState<AircraftWithMetrics[]>([]);
  const [aircraftList, setAircraftList] = useState<AircraftWithMetrics[]>([]);
  const [allAccessRecords, setAllAccessRecords] = useState<any[]>([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [sysSettings, setSysSettings] = useState<SystemSettings>({
    id: 1, reminder_1: 30, reminder_2: 15, reminder_3: 5,
    reminder_hours_1: 30, reminder_hours_2: 15, reminder_hours_3: 5,
    sched_time: 10, sched_days: 30, predictive_sched_days: 45,
  });
  const dataFetchTriggeredRef = useRef(false);
  const { mutate: globalMutate } = useSWRConfig();

  // Cache of flight logs per aircraft to avoid re-fetching for metrics
  const flightLogCacheRef = useRef<Record<string, any[]>>({});

  const fetchAircraftData = useCallback(async (userId: string) => {
    const ago = new Date();
    ago.setDate(ago.getDate() - FLIGHT_DATA_LOOKBACK_DAYS);

    const [sR, rR, pR, aR] = await Promise.all([
      supabase.from('aft_system_settings').select('*').eq('id', 1).single(),
      supabase.from('aft_user_roles').select('role, initials').eq('user_id', userId).single(),
      supabase.from('aft_aircraft').select('*').order('tail_number'),
      supabase.from('aft_user_aircraft_access').select('aircraft_id, aircraft_role, user_id').eq('user_id', userId),
    ]);

    if (sR.data) setSysSettings(sR.data as SystemSettings);
    if (rR.data) {
      setRole(rR.data.role as AppRole);
      setUserInitials(rR.data.initials || "");
    }

    // For 100+ aircraft: assign default metrics without computing burn rates.
    // Metrics are computed lazily per-aircraft when needed (via enrichSingleAircraft).
    const allPlanes: AircraftWithMetrics[] = (pR.data || []).map((plane: any) => ({
      ...plane,
      ...DEFAULT_METRICS,
    }));

    setAllAircraftList(allPlanes);

    const accessData = aR.data || [];
    setAllAccessRecords(accessData);

    const assignedIds = accessData.map((a: any) => a.aircraft_id);
    const assigned = allPlanes.filter(a => assignedIds.includes(a.id));
    setAircraftList(assigned);

    setIsDataLoaded(true);

    // Return data needed by the caller to set activeTail
    return { allPlanes, assigned };
  }, []);

  /**
   * Computes full metrics (burn rate, confidence, projections) for a single aircraft.
   * Called when an aircraft becomes the active tail, or when its data changes.
   * Results are cached and merged into the aircraft lists.
   */
  const enrichSingleAircraft = useCallback(async (aircraftId: string) => {
    const ago = new Date();
    ago.setDate(ago.getDate() - FLIGHT_DATA_LOOKBACK_DAYS);

    // Fetch flight logs for this specific aircraft
    const { data: logs } = await supabase
      .from('aft_flight_logs')
      .select('aircraft_id, ftt, tach, created_at')
      .eq('aircraft_id', aircraftId)
      .gte('created_at', ago.toISOString())
      .order('created_at', { ascending: true });

    const planeLogs = logs || [];
    flightLogCacheRef.current[aircraftId] = planeLogs;

    // Find the raw aircraft data from current state
    const rawAircraft = allAircraftList.find(a => a.id === aircraftId);
    if (!rawAircraft) return;

    // Compute metrics for this single aircraft
    const enriched = enrichAircraftWithMetrics([rawAircraft], planeLogs)[0];

    // Update both lists
    setAllAircraftList(prev => prev.map(a => a.id === aircraftId ? enriched : a));
    setAircraftList(prev => prev.map(a => a.id === aircraftId ? enriched : a));
  }, [allAircraftList]);

  const refreshForAircraft = useCallback(async (aircraftId: string, sessionUserId: string) => {
    const ago = new Date();
    ago.setDate(ago.getDate() - FLIGHT_DATA_LOOKBACK_DAYS);

    const [pR, lR] = await Promise.all([
      supabase.from('aft_aircraft').select('*').eq('id', aircraftId).single(),
      supabase.from('aft_flight_logs').select('aircraft_id, ftt, tach, created_at').eq('aircraft_id', aircraftId).gte('created_at', ago.toISOString()).order('created_at', { ascending: true }),
    ]);

    if (pR.data) {
      const planeLogs = lR.data || [];
      flightLogCacheRef.current[aircraftId] = planeLogs;
      const up = enrichAircraftWithMetrics([pR.data], planeLogs)[0];
      setAllAircraftList(prev => prev.map(a => a.id === aircraftId ? up : a));
      setAircraftList(prev => prev.map(a => a.id === aircraftId ? up : a));
    }

    globalMutate(
      (key: any) => typeof key === 'string' && key.includes(aircraftId),
      undefined,
      { revalidate: true }
    );
  }, [globalMutate]);

  return {
    role,
    userInitials,
    allAircraftList,
    aircraftList,
    allAccessRecords,
    isDataLoaded,
    sysSettings,
    setSysSettings,
    dataFetchTriggeredRef,
    fetchAircraftData,
    enrichSingleAircraft,
    refreshForAircraft,
    globalMutate,
  };
}

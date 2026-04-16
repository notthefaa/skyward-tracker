"use client";

import { useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { enrichAircraftWithMetrics } from "@/lib/math";
import { useSWRConfig } from "swr";
import { FLIGHT_DATA_LOOKBACK_DAYS } from "@/lib/constants";
import { matchesAircraft } from "@/lib/swrKeys";
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

/** Lightweight record used only for the Global Fleet search/select modal */
export interface FleetIndexEntry {
  id: string;
  tail_number: string;
  aircraft_type: string;
}

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

  // Lightweight global fleet index for admin search modal (id, tail, type only)
  const [globalFleetIndex, setGlobalFleetIndex] = useState<FleetIndexEntry[]>([]);

  const fetchAircraftData = useCallback(async (userId: string) => {
    // ─── PHASE 1: Fetch user identity + access in parallel ───
    // These are small, fast queries that tell us WHO the user is
    // and WHICH aircraft they can see.
    const [sR, rR, aR] = await Promise.all([
      supabase.from('aft_system_settings').select('*').eq('id', 1).single(),
      supabase.from('aft_user_roles').select('role, initials').eq('user_id', userId).single(),
      supabase.from('aft_user_aircraft_access').select('aircraft_id, aircraft_role, user_id').eq('user_id', userId),
    ]);

    if (sR.data) setSysSettings(sR.data as SystemSettings);

    const userRole = (rR.data?.role || 'pilot') as AppRole;
    setRole(userRole);
    setUserInitials(rR.data?.initials || "");

    const accessData = aR.data || [];
    setAllAccessRecords(accessData);

    const assignedIds = accessData.map((a: any) => a.aircraft_id);

    // ─── PHASE 2: Fetch only assigned aircraft (both admins and pilots) ───
    // Admins lazy-load unassigned aircraft on demand from the Global Fleet modal.
    let allPlanes: AircraftWithMetrics[];

    if (assignedIds.length > 0) {
      const { data: aircraftData } = await supabase
        .from('aft_aircraft')
        .select('*')
        .in('id', assignedIds)
        .is('deleted_at', null)
        .order('tail_number');

      allPlanes = (aircraftData || []).map((plane: any) => ({
        ...plane,
        ...DEFAULT_METRICS,
      }));
    } else {
      allPlanes = [];
    }

    setAllAircraftList(allPlanes);
    setAircraftList(allPlanes);

    setIsDataLoaded(true);

    // Return data needed by the caller to set activeTail
    return { allPlanes, assigned: allPlanes };
  }, []);

  /**
   * Fetches a lightweight index of ALL aircraft in the system (id, tail, type only).
   * Used by the admin Global Fleet modal for search and selection.
   * Called on-demand when the admin opens the modal, not on initial load.
   */
  const fetchGlobalFleetIndex = useCallback(async (): Promise<FleetIndexEntry[]> => {
    // Return cached index if we already fetched it this session
    if (globalFleetIndex.length > 0) return globalFleetIndex;

    const { data } = await supabase
      .from('aft_aircraft')
      .select('id, tail_number, aircraft_type')
      .is('deleted_at', null)
      .order('tail_number');

    const index = (data || []) as FleetIndexEntry[];
    setGlobalFleetIndex(index);
    return index;
  }, [globalFleetIndex]);

  /**
   * Fetches a single aircraft's full record and adds it to the local lists.
   * Used when an admin selects an aircraft from Global Fleet that isn't
   * in their assigned set. If it's already loaded, returns it immediately.
   */
  const fetchSingleAircraft = useCallback(async (aircraftId: string): Promise<AircraftWithMetrics | null> => {
    // If already in our lists, return it
    const existing = allAircraftList.find(a => a.id === aircraftId);
    if (existing) return existing;

    const { data, error } = await supabase
      .from('aft_aircraft')
      .select('*')
      .eq('id', aircraftId)
      .single();

    if (error || !data) return null;

    const aircraft: AircraftWithMetrics = {
      ...data,
      ...DEFAULT_METRICS,
    };

    // Add to the all-aircraft list so it's available for the session
    setAllAircraftList(prev => {
      // Prevent duplicates in case of race conditions
      if (prev.some(a => a.id === aircraftId)) return prev;
      return [...prev, aircraft].sort((a, b) => a.tail_number.localeCompare(b.tail_number));
    });

    return aircraft;
  }, [allAircraftList]);

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
      supabase.from('aft_aircraft').select('*').eq('id', aircraftId).is('deleted_at', null).maybeSingle(),
      supabase.from('aft_flight_logs').select('aircraft_id, ftt, tach, created_at').eq('aircraft_id', aircraftId).is('deleted_at', null).gte('created_at', ago.toISOString()).order('created_at', { ascending: true }),
    ]);

    if (pR.data) {
      const planeLogs = lR.data || [];
      flightLogCacheRef.current[aircraftId] = planeLogs;
      const up = enrichAircraftWithMetrics([pR.data], planeLogs)[0];
      setAllAircraftList(prev => prev.map(a => a.id === aircraftId ? up : a));
      setAircraftList(prev => prev.map(a => a.id === aircraftId ? up : a));
    }

    globalMutate(matchesAircraft(aircraftId), undefined, { revalidate: true });
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
    // New: admin global fleet support
    globalFleetIndex,
    fetchGlobalFleetIndex,
    fetchSingleAircraft,
  };
}

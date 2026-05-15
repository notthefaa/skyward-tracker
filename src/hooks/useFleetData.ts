"use client";

import { useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
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
  make?: string | null;
}

export function useFleetData() {
  const [role, setRole] = useState<AppRole>('pilot');
  const [userInitials, setUserInitials] = useState("");
  // Onboarding gate — flipped true after either onboarding path (Howard-
  // guided or classic form) finishes. Starts undefined so the shell can
  // distinguish "still loading" from "new user."
  const [completedOnboarding, setCompletedOnboarding] = useState<boolean | null>(null);
  const [tourCompleted, setTourCompleted] = useState<boolean | null>(null);
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
    // Bootstrap the shell with one cookie-bearing fetch instead of four
    // direct supabase.from() calls. The /api/me/bootstrap endpoint
    // performs the same parallel reads server-side and returns one
    // payload — eliminating four trips through supabase-js's GoTrue
    // mutex on the iOS-suspend-prone client. `userId` is no longer
    // strictly needed (the server reads identity from the cookie) but
    // we keep the param to avoid a breaking change to existing callers.
    void userId;
    const res = await authFetch('/api/me/bootstrap');
    if (!res.ok) {
      let detail = `${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) detail = body.error;
      } catch { /* non-JSON body */ }
      throw new Error(`Bootstrap failed: ${detail}`);
    }
    const payload = await res.json() as {
      sysSettings: SystemSettings | null;
      role: string;
      userInitials: string;
      completedOnboarding: boolean;
      tourCompleted: boolean;
      access: Array<{ aircraft_id: string; aircraft_role: string; user_id: string }>;
      aircraft: any[];
    };

    if (payload.sysSettings) setSysSettings(payload.sysSettings);

    const userRole = (payload.role || 'pilot') as AppRole;
    setRole(userRole);
    setUserInitials(payload.userInitials || '');
    setCompletedOnboarding(!!payload.completedOnboarding);
    setTourCompleted(!!payload.tourCompleted);

    setAllAccessRecords(payload.access);

    const allPlanes: AircraftWithMetrics[] = (payload.aircraft || []).map((plane: any) => ({
      ...plane,
      ...DEFAULT_METRICS,
    }));

    setAllAircraftList(allPlanes);
    setAircraftList(allPlanes);

    setIsDataLoaded(true);

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

    const { data, error } = await supabase
      .from('aft_aircraft')
      .select('id, tail_number, aircraft_type, make')
      .is('deleted_at', null)
      .order('tail_number');

    // Throw rather than caching an empty list — admin would otherwise
    // see "no aircraft" on a transient failure and stay stuck there
    // because globalFleetIndex.length === 0 still hits this branch.
    if (error) throw error;

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

    // Fetch flight logs for this specific aircraft. Filter + order by
    // occurred_at (physical flight time) rather than created_at (server
    // write time) so the companion app's offline queue doesn't skew
    // burn-rate projections when old flights flush late.
    //
    // Bail on error rather than treating "no logs" and "fetch failed"
    // identically — the latter would lock the aircraft into the
    // DEFAULT_METRICS zero state set by fetchAircraftData and look like
    // "this plane has no flight history."
    const { data: logs, error: logsErr } = await supabase
      .from('aft_flight_logs')
      .select('aircraft_id, ftt, tach, created_at, occurred_at')
      .eq('aircraft_id', aircraftId)
      .gte('occurred_at', ago.toISOString())
      .order('occurred_at', { ascending: true })
      .order('created_at', { ascending: true });
    if (logsErr) {
      console.error('[enrichSingleAircraft] flight-log fetch failed', logsErr);
      return;
    }

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
      // 180-day burn-rate lookback: filter + order by occurred_at so
      // an offline-queued flight from 170 days ago counts as a
      // 170-day-old data point, not a fresh one.
      supabase.from('aft_flight_logs').select('aircraft_id, ftt, tach, created_at, occurred_at').eq('aircraft_id', aircraftId).is('deleted_at', null).gte('occurred_at', ago.toISOString()).order('occurred_at', { ascending: true }).order('created_at', { ascending: true }),
    ]);

    // If either fetch errored, leave the in-memory aircraft state alone
    // (callers see stale-but-correct rather than partially-rebuilt) and
    // skip the SWR invalidation — there's nothing fresher to revalidate
    // from. Realtime will fire again on the next change.
    if (pR.error || lR.error) {
      console.error('[refreshForAircraft] fetch failed', { p: pR.error, l: lR.error });
      return;
    }

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
    completedOnboarding,
    tourCompleted,
    setCompletedOnboarding,
    setTourCompleted,
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

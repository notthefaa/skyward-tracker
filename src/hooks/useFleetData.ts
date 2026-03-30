"use client";

import { useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { enrichAircraftWithMetrics } from "@/lib/math";
import { useSWRConfig } from "swr";
import type { AircraftWithMetrics, SystemSettings, AppRole } from "@/lib/types";

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

  const fetchAircraftData = useCallback(async (userId: string, currentActiveTail?: string) => {
    const ago = new Date();
    ago.setDate(ago.getDate() - 180);

    const [sR, rR, pR, lR, aR] = await Promise.all([
      supabase.from('aft_system_settings').select('*').eq('id', 1).single(),
      supabase.from('aft_user_roles').select('role, initials').eq('user_id', userId).single(),
      supabase.from('aft_aircraft').select('*').order('tail_number'),
      supabase.from('aft_flight_logs').select('aircraft_id, ftt, tach, created_at').gte('created_at', ago.toISOString()).order('created_at', { ascending: true }),
      supabase.from('aft_user_aircraft_access').select('aircraft_id, aircraft_role, user_id').eq('user_id', userId),
    ]);

    if (sR.data) setSysSettings(sR.data as SystemSettings);
    if (rR.data) {
      setRole(rR.data.role as AppRole);
      setUserInitials(rR.data.initials || "");
    }

    const allPlanes = enrichAircraftWithMetrics(pR.data || [], lR.data || []);
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

  const refreshForAircraft = useCallback(async (aircraftId: string, sessionUserId: string) => {
    const ago = new Date();
    ago.setDate(ago.getDate() - 180);

    const [pR, lR] = await Promise.all([
      supabase.from('aft_aircraft').select('*').eq('id', aircraftId).single(),
      supabase.from('aft_flight_logs').select('aircraft_id, ftt, tach, created_at').eq('aircraft_id', aircraftId).gte('created_at', ago.toISOString()).order('created_at', { ascending: true }),
    ]);

    if (pR.data) {
      const up = enrichAircraftWithMetrics([pR.data], lR.data || [])[0];
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
    refreshForAircraft,
    globalMutate,
  };
}

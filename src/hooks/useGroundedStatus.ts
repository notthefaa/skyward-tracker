"use client";

import { useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { computeAirworthinessStatus, applyOpenSquawkOverride } from "@/lib/airworthiness";
import type { AircraftWithMetrics, AircraftStatus } from "@/lib/types";

export function useGroundedStatus(allAircraftList: AircraftWithMetrics[]) {
  const [aircraftStatus, setAircraftStatus] = useState<AircraftStatus>('airworthy');
  const [groundedReason, setGroundedReason] = useState<string>("");

  const checkGroundedStatus = useCallback(async (tail: string) => {
    const ac = allAircraftList.find(a => a.tail_number === tail);
    if (!ac) return;

    // Pull everything needed for the explicit 91.205/.411/.413/.207/.417
    // regulatory check in a single parallel round-trip.
    const [mxRes, sqRes, eqRes, adRes] = await Promise.all([
      supabase.from('aft_maintenance_items')
        .select('item_name, tracking_type, is_required, due_time, due_date')
        .eq('aircraft_id', ac.id).is('deleted_at', null),
      supabase.from('aft_squawks')
        .select('affects_airworthiness, location, status')
        .eq('aircraft_id', ac.id).eq('status', 'open').is('deleted_at', null),
      supabase.from('aft_aircraft_equipment')
        .select('*')
        .eq('aircraft_id', ac.id).is('deleted_at', null).is('removed_at', null),
      supabase.from('aft_airworthiness_directives')
        .select('*')
        .eq('aircraft_id', ac.id).is('deleted_at', null).eq('is_superseded', false),
    ]);

    const verdict = computeAirworthinessStatus({
      aircraft: {
        id: ac.id,
        tail_number: ac.tail_number,
        total_engine_time: ac.total_engine_time,
        is_ifr_equipped: (ac as any).is_ifr_equipped,
        is_for_hire: (ac as any).is_for_hire,
      },
      equipment: (eqRes.data || []) as any,
      mxItems: mxRes.data || [],
      squawks: (sqRes.data || []) as any,
      ads: (adRes.data || []) as any,
    });

    const openSquawkCount = (sqRes.data || []).length;
    setGroundedReason(verdict.reason || "");
    setAircraftStatus(applyOpenSquawkOverride(verdict.status, openSquawkCount));
  }, [allAircraftList]);

  return { aircraftStatus, groundedReason, checkGroundedStatus };
}

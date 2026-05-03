"use client";

import { useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { computeAirworthinessStatus, applyOpenSquawkOverride } from "@/lib/airworthiness";
import type { AircraftWithMetrics, AircraftStatus } from "@/lib/types";

// Each of the 4 supabase reads gets its own deadline. The supabase
// client's global fetchWithTimeout is 15s — too long for a UI status
// dot. If one of the four wedges, the others land first and the
// verdict resolves rather than the whole check timing out as a unit.
const PER_QUERY_TIMEOUT_MS = 6_000;

// One automatic retry on failure. iOS PWA tail-switch can leave a
// half-warm socket that fails the first request but succeeds on the
// next — giving the verdict one quiet retry means a transient blip
// resolves to 'airworthy/issues/grounded' instead of stranding the
// header at gray until the user pulls to refresh.
const RETRY_DELAY_MS = 2_500;

const LABELS = ['mx', 'squawks', 'equipment', 'ads'] as const;

function withDeadline<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`grounded_status_timeout_${label}`));
    }, ms);
    Promise.resolve(p).then(
      v => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function useGroundedStatus(allAircraftList: AircraftWithMetrics[]) {
  // Start as 'unknown' so a first-fetch failure doesn't render the
  // header dot green for an aircraft we haven't actually verified.
  // The UI maps 'unknown' to a neutral gray dot + suppresses the
  // grounded banner; once a fetch lands the verdict resolves to one
  // of airworthy/issues/grounded.
  const [aircraftStatus, setAircraftStatus] = useState<AircraftStatus>('unknown');
  const [groundedReason, setGroundedReason] = useState<string>("");
  const lastTailRef = useRef<string>("");
  // Track the last in-flight tail so a retry that lost a race
  // against a tail switch doesn't write the wrong aircraft's verdict.
  const inflightTailRef = useRef<string>("");
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runOnce = useCallback(async (tail: string): Promise<boolean> => {
    const ac = allAircraftList.find(a => a.tail_number === tail);
    if (!ac) return true;
    const queries = [
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
    ] as const;

    const results = await Promise.allSettled(
      queries.map((q, i) => withDeadline(q, PER_QUERY_TIMEOUT_MS, LABELS[i]))
    );

    // If a tail switch happened mid-query, drop this run — the new
    // tail's run is in flight (or already landed) and we don't want
    // to write stale results into the verdict for the wrong aircraft.
    if (inflightTailRef.current !== tail || lastTailRef.current !== tail) {
      return true;
    }

    const failures: Record<string, unknown> = {};
    results.forEach((r, i) => {
      if (r.status === 'rejected') failures[LABELS[i]] = (r.reason as Error)?.message || r.reason;
      else if (r.value.error) failures[LABELS[i]] = r.value.error;
    });

    if (Object.keys(failures).length > 0) {
      console.warn('[useGroundedStatus] partial failure', failures);
      return false;
    }

    const [mxRes, sqRes, eqRes, adRes] = results.map(r =>
      r.status === 'fulfilled' ? r.value : { data: null, error: null }
    ) as any;

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
    return true;
  }, [allAircraftList]);

  const checkGroundedStatus = useCallback(async (tail: string) => {
    // Tail switch: reset to 'unknown' immediately so the previous
    // aircraft's verdict can't bleed into this one. The fail-closed
    // policy below preserves the current verdict on fetch error,
    // which is correct for transient blips on the same tail (don't
    // flip a grounded plane to green) but wrong on tail switch
    // (would show A's red/orange/green next to B's tail number).
    if (tail !== lastTailRef.current) {
      lastTailRef.current = tail;
      setAircraftStatus('unknown');
      setGroundedReason("");
      // Cancel any pending retry from the previous tail — its
      // results would land on the wrong aircraft.
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    }
    inflightTailRef.current = tail;

    const ok = await runOnce(tail);
    if (ok) return;

    // First attempt failed — schedule one quiet retry. The user
    // doesn't see anything different (still gray dot during the
    // retry window), but a successful retry resolves to a real
    // verdict without requiring a manual pull-to-refresh.
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      if (lastTailRef.current !== tail) return;
      void runOnce(tail);
    }, RETRY_DELAY_MS);
  }, [runOnce]);

  return { aircraftStatus, groundedReason, checkGroundedStatus };
}

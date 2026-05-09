"use client";

import { useCallback, useState } from "react";
import { useSWRConfig } from "swr";
import { supabase } from "@/lib/supabase";
import { computeAirworthinessStatus, applyOpenSquawkOverride } from "@/lib/airworthiness";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics, AircraftStatus } from "@/lib/types";

export function useGroundedStatus(allAircraftList: AircraftWithMetrics[], activeTail: string) {
  // Status keyed by tail — the previous shape stored a single
  // `aircraftStatus` value that lingered when the AppShell-level
  // throttle (per-tail, 30s) skipped a fresh checkGroundedStatus on
  // tail switch. The header would then render the OLD tail's verdict
  // under the NEW tail's tail-number until either the throttle elapsed
  // or some other write fired a refresh. Keying by tail means the
  // displayed value always tracks the active selection, even when the
  // throttle suppresses the actual fetch.
  const [statusByTail, setStatusByTail] = useState<Record<string, AircraftStatus>>({});
  const [reasonByTail, setReasonByTail] = useState<Record<string, string>>({});
  const { cache: swrCache } = useSWRConfig();

  // Default 'unknown' so first-paint after a tail switch (before any
  // fetch lands) renders a neutral gray dot — never a stale green.
  const aircraftStatus: AircraftStatus = activeTail ? (statusByTail[activeTail] ?? 'unknown') : 'unknown';
  const groundedReason: string = activeTail ? (reasonByTail[activeTail] ?? '') : '';

  const checkGroundedStatus = useCallback(async (tail: string) => {
    const ac = allAircraftList.find(a => a.tail_number === tail);
    if (!ac) return;

    // ─── Primary path: fleet cache ───
    // FleetSummary's fetcher already pulls all 4 airworthiness tables
    // in one batch on app open and computes a verdict per aircraft.
    // Reading that pre-computed verdict means the status dot resolves
    // INSTANTLY on tail switch without firing 4 fresh queries that
    // compete for iOS WKWebView's shallow socket pool. The fleet
    // cache key shape is `fleet-${count}-${idsCsv}` — match by
    // membership of the active aircraft id, since the count/idsCsv
    // can drift if the list updates mid-session.
    const ids = allAircraftList.map(a => a.id).join(',');
    const fleetKey = swrKeys.fleet(allAircraftList.length, ids);
    const fleetEntry = swrCache.get(fleetKey);
    const fleetData = (fleetEntry as any)?.data;
    if (Array.isArray(fleetData)) {
      const cached = fleetData.find((entry: any) => entry?.id === ac.id);
      if (cached?.status) {
        setStatusByTail(prev => ({ ...prev, [tail]: cached.status as AircraftStatus }));
        // Fleet cache holds the verdict but not the reason string.
        // Empty string suppresses the banner; the next fresh fetch
        // (below) populates it if grounded.
        setReasonByTail(prev => ({ ...prev, [tail]: "" }));
      }
    }

    // ─── Authoritative fetch (also runs when cache hit) ───
    // Pull everything needed for the explicit 91.205/.411/.413/.207/.417
    // regulatory check in a single parallel round-trip. Stays on the
    // supabase client's 15s per-request deadline; we don't wrap each
    // query in our own shorter deadline because rejecting the JS
    // promise early doesn't abort the underlying socket and a retry
    // would just queue more work behind the still-running originals.
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

    // No mid-fetch drop needed any more — verdicts are tail-keyed,
    // so writing to setStatusByTail[tail] for an inactive tail still
    // doesn't bleed into the header (which reads statusByTail[activeTail]).
    // The check below keeps the previous shape's robustness against
    // partial-failure clobbering, just per-tail now.

    if (mxRes.error || sqRes.error || eqRes.error || adRes.error) {
      console.warn('[useGroundedStatus] fetch failed', {
        mx: mxRes.error?.message, sq: sqRes.error?.message,
        eq: eqRes.error?.message, ad: adRes.error?.message,
      });
      // Keep whatever the fleet-cache pass already wrote for this
      // tail (or 'unknown' if the cache was empty). Don't clobber a
      // good verdict with a transient blip.
      return;
    }

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
    const finalStatus = applyOpenSquawkOverride(verdict.status, openSquawkCount);
    setReasonByTail(prev => ({ ...prev, [tail]: verdict.reason || "" }));
    setStatusByTail(prev => ({ ...prev, [tail]: finalStatus }));
  }, [allAircraftList, swrCache]);

  return { aircraftStatus, groundedReason, checkGroundedStatus };
}

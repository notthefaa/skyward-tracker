"use client";

import { useCallback, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { authFetch } from "@/lib/authFetch";
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
  // Generation counter — `useCallback` deps `[allAircraftList, swrCache]`
  // change frequently (new array refs from setState), so each render
  // gets a new closure. On rapid tail switches multiple in-flight
  // copies of `checkGroundedStatus` can be racing; without a guard
  // a stale earlier call's authFetch that resolves *after* a newer
  // call would overwrite the freshly-computed verdict for the same or
  // a different tail. Bumping `genRef.current` on entry and bailing
  // when it no longer matches stops the stale write.
  const genRef = useRef(0);

  // Default 'unknown' so first-paint after a tail switch (before any
  // fetch lands) renders a neutral gray dot — never a stale green.
  const aircraftStatus: AircraftStatus = activeTail ? (statusByTail[activeTail] ?? 'unknown') : 'unknown';
  const groundedReason: string = activeTail ? (reasonByTail[activeTail] ?? '') : '';

  const checkGroundedStatus = useCallback(async (tail: string) => {
    const myGen = ++genRef.current;
    const ac = allAircraftList.find(a => a.tail_number === tail);
    if (!ac) return;

    // ─── Primary path: fleet cache ───
    // FleetSummary's fetcher already pulls all 4 airworthiness tables
    // in one batch on app open and computes a verdict per aircraft.
    // Reading that pre-computed verdict means the status dot resolves
    // INSTANTLY on tail switch without firing a fresh roundtrip. The
    // fleet cache key shape is `fleet-${count}-${idsCsv}` — match by
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
    // Single cookie-bearing call to /api/aircraft/[id]/airworthiness.
    // Server pulls the 4 regulatory tables in parallel (with the
    // service-role key, no per-call GoTrue mutex) and returns the
    // computed verdict. Replaces 4 direct supabase.from() reads that
    // each had to attach a Bearer via supabase-js's auth lock.
    let verdictPayload: { status: AircraftStatus; reason: string; openSquawkCount: number } | null = null;
    try {
      const res = await authFetch(`/api/aircraft/${ac.id}/airworthiness`);
      if (!res.ok) {
        console.warn('[useGroundedStatus] fetch failed', res.status);
        return;
      }
      verdictPayload = await res.json();
    } catch (err) {
      console.warn('[useGroundedStatus] fetch error', err);
      return;
    }

    // A newer checkGroundedStatus call has started since this one
    // dispatched its query — bail before touching state so a slow
    // prior tail's verdict can't land on top of a fresh active tail's
    // value.
    if (myGen !== genRef.current) return;
    if (!verdictPayload) return;

    setReasonByTail(prev => ({ ...prev, [tail]: verdictPayload!.reason }));
    setStatusByTail(prev => ({ ...prev, [tail]: verdictPayload!.status }));
  }, [allAircraftList, swrCache]);

  return { aircraftStatus, groundedReason, checkGroundedStatus };
}

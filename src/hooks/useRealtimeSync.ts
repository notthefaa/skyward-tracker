"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import { supabase } from "@/lib/supabase";

/**
 * Subscribes to Supabase Realtime changes across fleet tables.
 * Debounces per-aircraft refreshes and skips events caused by the current user.
 *
 * Returns `cancelPendingTimers` so callers (e.g., AppShell tail-switch
 * effect) can drop in-flight debounces alongside the abort calls.
 * Without this, a 1.5s debounce armed for tail A keeps ticking and
 * fires `refreshForAircraft(A_id)` after the user has already switched
 * to B — wasted fetches that compound into the iOS pool wedge described
 * in `project_swr_retry_storm_fix_2026_05_10`.
 */
export function useRealtimeSync(
  session: any,
  refreshForAircraft: (aircraftId: string, userId: string) => void,
): { cancelPendingTimers: () => void } {
  // Pull cache + per-key mutate from context. Filter-form mutate
  // (`globalMutate(() => true, ...)`) hits two SWR-internal traps that
  // leave hydrated-but-not-yet-resubscribed entries stuck (the `_k`
  // matcher) and stranded FETCH[key] promises pinned forever (the
  // FETCH map clear is per-key only). Walking cache.keys() + per-key
  // mutate sidesteps both. See `feedback_swr_filter_mutate_gotcha`.
  const { cache: swrCache, mutate: keyedMutate } = useSWRConfig();
  const timersRef = useRef<Record<string, NodeJS.Timeout>>({});

  const cancelPendingTimers = useCallback(() => {
    for (const t of Object.values(timersRef.current)) clearTimeout(t);
    timersRef.current = {};
  }, []);

  useEffect(() => {
    if (!session) return;

    const timers = timersRef.current;

    const handle = (payload: any) => {
      const nr = payload.new;
      // For aft_reservations the `user_id` column is the BOOKER, not the
      // mutator — an admin or mxConflicts cancelling pilot A's reservation
      // sends a payload with `new.user_id === A.id`. If A is also the
      // current session, the old logic skipped the refresh and A's
      // calendar showed the dead reservation until manual reload. Same
      // class of bug for any table where the user_id-like column is
      // ownership, not authorship. Refresh unconditionally on
      // aft_reservations; for the other tables the user_id-style skip
      // is still safe because the column means "who did the write."
      const table: string = payload.table || '';
      if (nr && table !== 'aft_reservations') {
        if (
          nr.user_id === session.user.id ||
          nr.reported_by === session.user.id ||
          nr.author_id === session.user.id
        ) {
          return;
        }
      }

      const aid = nr?.aircraft_id || null;

      if (aid) {
        // Aircraft-scoped refresh with 1.5s debounce
        if (timers[aid]) clearTimeout(timers[aid]);
        timers[aid] = setTimeout(() => {
          refreshForAircraft(aid, session.user.id);
          delete timers[aid];
        }, 1500);
      } else {
        // Global SWR revalidation for events without aircraft_id.
        // Walk cache.keys() and call single-arg keyedMutate per key —
        // `globalMutate(() => true, undefined, { revalidate: true })`
        // skips entries with `_k === undefined` (hydrated from
        // localStorage but not yet resubscribed) AND can't clear
        // stranded FETCH[key] promises from iOS-suspended fetches.
        if (timers['__g']) clearTimeout(timers['__g']);
        timers['__g'] = setTimeout(() => {
          // Snapshot keys before mutating — iterating a Map while
          // changing it is undefined behavior.
          const keys: string[] = [];
          for (const k of Array.from(swrCache.keys())) {
            if (typeof k === 'string') keys.push(k);
          }
          for (const k of keys) {
            keyedMutate(k);
          }
          delete timers['__g'];
        }, 1500);
      }
    };

    // Namespace the channel per user so two mounted trees (devtools,
    // tab duplication) don't collide on a single global channel name.
    const ch = supabase
      .channel(`fleet-updates:${session.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'aft_flight_logs' }, handle)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'aft_squawks' }, handle)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'aft_squawks' }, handle)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aft_maintenance_items' }, handle)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'aft_notes' }, handle)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aft_maintenance_events' }, handle)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aft_event_messages' }, handle)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aft_reservations' }, handle)
      .subscribe();

    return () => {
      cancelPendingTimers();
      supabase.removeChannel(ch);
    };
  }, [session, refreshForAircraft, swrCache, keyedMutate, cancelPendingTimers]);

  return { cancelPendingTimers };
}

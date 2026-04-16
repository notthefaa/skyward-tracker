"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Subscribes to Supabase Realtime changes across fleet tables.
 * Debounces per-aircraft refreshes and skips events caused by the current user.
 */
export function useRealtimeSync(
  session: any,
  refreshForAircraft: (aircraftId: string, userId: string) => void,
  globalMutate: (matcher: any, data: any, opts: any) => void
) {
  useEffect(() => {
    if (!session) return;

    const timers: Record<string, NodeJS.Timeout> = {};

    const handle = (payload: any) => {
      const nr = payload.new;
      if (nr) {
        // Skip events caused by the current user to avoid redundant refreshes
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
        // Global SWR revalidation for events without aircraft_id
        if (timers['__g']) clearTimeout(timers['__g']);
        timers['__g'] = setTimeout(() => {
          globalMutate(() => true, undefined, { revalidate: true });
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
      Object.values(timers).forEach(t => clearTimeout(t));
      supabase.removeChannel(ch);
    };
  }, [session, refreshForAircraft, globalMutate]);
}

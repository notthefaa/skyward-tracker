"use client";

import { useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { AircraftWithMetrics, AircraftStatus } from "@/lib/types";

export function useGroundedStatus(allAircraftList: AircraftWithMetrics[]) {
  const [aircraftStatus, setAircraftStatus] = useState<AircraftStatus>('airworthy');
  const [groundedReason, setGroundedReason] = useState<string>("");

  const checkGroundedStatus = useCallback(async (tail: string) => {
    const ac = allAircraftList.find(a => a.tail_number === tail);
    if (!ac) return;

    let isGrounded = false;
    let hasOpen = false;
    let reason = "";

    // Fetch MX items and squawks in parallel (single round trip)
    const [{ data: mx }, { data: sq }] = await Promise.all([
      supabase.from('aft_maintenance_items').select('item_name, tracking_type, is_required, due_time, due_date').eq('aircraft_id', ac.id),
      supabase.from('aft_squawks').select('affects_airworthiness, location, status').eq('aircraft_id', ac.id).eq('status', 'open'),
    ]);

    // Check MX items
    if (mx) {
      const et = ac.total_engine_time || 0;
      for (const item of mx) {
        if (!item.is_required) continue;
        if (item.tracking_type === 'time' && item.due_time <= et) {
          isGrounded = true;
          reason = `${item.item_name} expired by ${(et - item.due_time).toFixed(1)} hrs`;
          break;
        }
        if (item.tracking_type === 'date' && new Date(item.due_date + 'T00:00:00') < new Date(new Date().setHours(0, 0, 0, 0))) {
          isGrounded = true;
          const d = Math.ceil((Date.now() - new Date(item.due_date + 'T00:00:00').getTime()) / 86400000);
          reason = `${item.item_name} expired ${d} day${d > 1 ? 's' : ''} ago`;
          break;
        }
      }
    }

    // Check squawks (only if not already grounded by MX)
    if (!isGrounded && sq && sq.length > 0) {
      const g = sq.find(s => s.affects_airworthiness);
      if (g) {
        isGrounded = true;
        reason = `AOG squawk${g.location ? ' at ' + g.location : ''}`;
      } else {
        hasOpen = true;
      }
    }

    setGroundedReason(reason);
    if (isGrounded) setAircraftStatus('grounded');
    else if (hasOpen) setAircraftStatus('issues');
    else setAircraftStatus('airworthy');
  }, [allAircraftList]);

  return { aircraftStatus, groundedReason, checkGroundedStatus };
}

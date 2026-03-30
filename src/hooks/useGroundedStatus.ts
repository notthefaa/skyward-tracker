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

    const { data: mx } = await supabase
      .from('aft_maintenance_items')
      .select('*')
      .eq('aircraft_id', ac.id);

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

    if (!isGrounded) {
      const { data: sq } = await supabase
        .from('aft_squawks')
        .select('*')
        .eq('aircraft_id', ac.id)
        .eq('status', 'open');
      if (sq && sq.length > 0) {
        const g = sq.find(s => s.affects_airworthiness);
        if (g) {
          isGrounded = true;
          reason = `AOG squawk${g.location ? ' at ' + g.location : ''}`;
        } else {
          hasOpen = true;
        }
      }
    }

    setGroundedReason(reason);
    if (isGrounded) setAircraftStatus('grounded');
    else if (hasOpen) setAircraftStatus('issues');
    else setAircraftStatus('airworthy');
  }, [allAircraftList]);

  return { aircraftStatus, groundedReason, checkGroundedStatus };
}

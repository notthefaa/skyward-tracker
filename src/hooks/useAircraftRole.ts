"use client";

import { useState, useEffect } from "react";
import type { AircraftWithMetrics, AircraftRole } from "@/lib/types";

/**
 * Derives the current user's aircraft-level role (admin/pilot/null)
 * for the active tail number from the access records.
 */
export function useAircraftRole(
  activeTail: string,
  allAircraftList: AircraftWithMetrics[],
  allAccessRecords: any[],
  session: any
): AircraftRole | null {
  const [currentAircraftRole, setCurrentAircraftRole] = useState<AircraftRole | null>(null);

  useEffect(() => {
    if (!activeTail || !session || allAccessRecords.length === 0) {
      setCurrentAircraftRole(null);
      return;
    }

    const ac = allAircraftList.find(a => a.tail_number === activeTail);
    if (!ac) {
      setCurrentAircraftRole(null);
      return;
    }

    const access = allAccessRecords.find(
      (a: any) => a.aircraft_id === ac.id && a.user_id === session.user.id
    );
    setCurrentAircraftRole(access?.aircraft_role || null);
  }, [activeTail, allAccessRecords, allAircraftList, session]);

  return currentAircraftRole;
}

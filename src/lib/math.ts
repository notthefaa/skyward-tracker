// =============================================================
// SHARED MATH UTILITIES — Single source of truth for all
// burn rate, confidence, and maintenance projection logic
// =============================================================

import type { AircraftWithMetrics, ProcessedMxItem } from './types';

interface MinimalFlightLog {
  aircraft_id: string;
  ftt: number | null;
  tach: number | null;
  created_at: string;
}

/**
 * Computes the 60-day adaptive burn rate and 180-day confidence score
 * for a single aircraft based on its recent flight logs.
 */
export function computeMetrics(
  plane: any,
  planeLogs: MinimalFlightLog[]
): { burnRate: number; confidenceScore: number } {
  let burnRate = 0;
  let confidenceScore = 0;

  if (planeLogs.length === 0) return { burnRate, confidenceScore };

  const isTurbine = plane.engine_type === 'Turbine';
  const currentTime = plane.total_engine_time || 0;

  // 1. 60-Day Adaptive Burn Rate
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const logs60 = planeLogs.filter(l => new Date(l.created_at) >= sixtyDaysAgo);

  if (logs60.length > 0) {
    const oldest60 = logs60[0]; // Logs are sorted ascending (oldest first)
    const oldestTime = isTurbine ? oldest60.ftt : oldest60.tach;
    const daysElapsed = Math.max(
      1,
      (Date.now() - new Date(oldest60.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (oldestTime !== null && oldestTime !== undefined && currentTime > oldestTime) {
      burnRate = (currentTime - oldestTime) / daysElapsed;
    }
  }

  // 2. 180-Day Reliability / Confidence Score
  const oldestLog = planeLogs[0];
  const daysSpan = Math.max(
    1,
    (Date.now() - new Date(oldestLog.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );
  const historyScore = Math.min(50, (daysSpan / 180) * 50);
  const targetLogs = (daysSpan / 30) * 4; // Target 4 flights per month
  const densityScore = targetLogs > 0 ? Math.min(50, (planeLogs.length / targetLogs) * 50) : 0;
  confidenceScore = Math.round(historyScore + densityScore);

  return { burnRate, confidenceScore };
}

/**
 * Attaches burn rate and confidence metrics to an array of aircraft
 * using the provided flight logs (which should be sorted ascending by created_at).
 */
export function enrichAircraftWithMetrics(
  planes: any[],
  allLogs: MinimalFlightLog[]
): AircraftWithMetrics[] {
  return planes.map(plane => {
    const planeLogs = allLogs.filter(l => l.aircraft_id === plane.id);
    const { burnRate, confidenceScore } = computeMetrics(plane, planeLogs);
    return { ...plane, burnRate, confidenceScore };
  });
}

/**
 * Processes a maintenance item into a display-ready object with
 * remaining time/days, projected days, expiry status, and display text.
 */
export function processMxItem(
  item: any,
  currentEngineTime: number,
  burnRate: number
): ProcessedMxItem {
  let remaining = 0;
  let isExpired = false;
  let dueText = '';
  let projectedDays = Infinity;

  if (item.tracking_type === 'time') {
    remaining = (item.due_time ?? 0) - currentEngineTime;
    isExpired = remaining <= 0;
    dueText = isExpired
      ? `Expired by ${Math.abs(remaining).toFixed(1)} hrs`
      : `Due in ${remaining.toFixed(1)} hrs (@ ${item.due_time})`;

    if (burnRate > 0) {
      projectedDays = remaining / burnRate;
      if (!isExpired) dueText += ` (~${Math.ceil(projectedDays)} days)`;
    }
  } else {
    const diffTime =
      new Date((item.due_date ?? '') + 'T00:00:00').getTime() -
      new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    remaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    isExpired = remaining < 0;
    projectedDays = remaining;
    dueText = isExpired
      ? `Expired ${Math.abs(remaining)} days ago`
      : `Due in ${remaining} days (${item.due_date})`;
  }

  return { ...item, remaining, projectedDays, isExpired, dueText };
}

/**
 * Returns the appropriate Tailwind text color class for a maintenance item
 * based on its remaining time/days and the global system settings.
 */
export function getMxTextColor(
  item: ProcessedMxItem,
  settings: { reminder_1?: number; reminder_3?: number; reminder_hours_1?: number; reminder_hours_3?: number; [key: string]: any }
): string {
  if (
    item.isExpired ||
    item.remaining <= (settings.reminder_hours_3 ?? 5) ||
    item.projectedDays <= (settings.reminder_3 ?? 5)
  ) {
    return 'text-[#CE3732]';
  }
  if (
    item.remaining <= (settings.reminder_hours_1 ?? 30) ||
    item.projectedDays <= (settings.reminder_1 ?? 30)
  ) {
    return 'text-[#F08B46]';
  }
  return 'text-success';
}

/**
 * Checks whether a required maintenance item has expired.
 */
export function isMxExpired(item: any, currentEngineTime: number): boolean {
  if (!item.is_required) return false;
  if (item.tracking_type === 'time') return (item.due_time ?? 0) <= currentEngineTime;
  if (item.tracking_type === 'date') {
    return new Date((item.due_date ?? '') + 'T00:00:00') < new Date(new Date().setHours(0, 0, 0, 0));
  }
  return false;
}

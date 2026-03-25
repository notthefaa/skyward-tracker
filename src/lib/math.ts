// =============================================================
// PREDICTIVE MAINTENANCE ENGINE v3
//
// Designed for operational accuracy in a maintenance shop context.
//
// Key design decisions:
// - Burn rate is computed on ACTIVE DAYS ONLY (days the plane actually flew),
//   then combined with an activity ratio (what % of days have flights) to
//   produce the calendar burn rate. This correctly handles idle gaps.
// - Variance is measured on 7-day rolling windows of hours accumulated,
//   not per-flight increments. This avoids penalizing legitimate patterns
//   like mixed short hops and long repositioning flights.
// - Confidence decays with recency: having no flights in the last 30 days
//   aggressively drops confidence regardless of historical data quality.
// - Projection range uses a proper percentile-style spread based on
//   the weekly variance, not just the CV.
//
// Backward-compatible: same function signatures, same return shape.
// =============================================================

import type { AircraftWithMetrics, ProcessedMxItem } from './types';

interface MinimalFlightLog {
  aircraft_id: string;
  ftt: number | null;
  tach: number | null;
  created_at: string;
}

// ---------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Exponential half-life for burn rate weighting (days) */
const BURN_RATE_HALF_LIFE = 30;

/** How far back to look for flight data (days) */
const MAX_LOOKBACK_DAYS = 180;

/** Width of rolling window for variance calculation (days) */
const VARIANCE_WINDOW_DAYS = 7;

/** Days of inactivity before confidence starts decaying */
const RECENCY_GRACE_PERIOD = 14;

/** Days of inactivity where confidence hits zero from recency alone */
const RECENCY_KILL_DAYS = 90;

// ---------------------------------------------------------------
// CORE: Extract per-flight data
// ---------------------------------------------------------------

interface FlightEvent {
  hoursFlown: number;       // Engine hours consumed this flight
  timestamp: number;        // Epoch ms of this flight
  daysAgo: number;          // Calendar days from now
  dailyRate: number;        // hours / daysSincePrevFlight
  daysSincePrev: number;    // Gap since previous flight
}

/**
 * Converts sequential logs into flight events with computed rates.
 * Logs MUST be sorted ascending by created_at.
 */
function extractFlightEvents(
  planeLogs: MinimalFlightLog[],
  isTurbine: boolean
): FlightEvent[] {
  if (planeLogs.length < 2) return [];

  const events: FlightEvent[] = [];
  const now = Date.now();

  for (let i = 1; i < planeLogs.length; i++) {
    const prev = planeLogs[i - 1];
    const curr = planeLogs[i];

    const prevTime = isTurbine ? (prev.ftt ?? 0) : (prev.tach ?? 0);
    const currTime = isTurbine ? (curr.ftt ?? 0) : (curr.tach ?? 0);
    const hoursFlown = currTime - prevTime;

    if (hoursFlown <= 0) continue; // Skip bad data

    const timestamp = new Date(curr.created_at).getTime();
    const prevTimestamp = new Date(prev.created_at).getTime();
    const daysSincePrev = Math.max(1, (timestamp - prevTimestamp) / MS_PER_DAY);
    const daysAgo = Math.max(0, (now - timestamp) / MS_PER_DAY);

    events.push({
      hoursFlown,
      timestamp,
      daysAgo,
      dailyRate: hoursFlown / daysSincePrev,
      daysSincePrev,
    });
  }

  return events;
}

// ---------------------------------------------------------------
// BURN RATE: Active-days weighted average
// ---------------------------------------------------------------

/**
 * Computes the exponentially-weighted burn rate using active-day weighting.
 *
 * Instead of dividing total hours by total calendar days (which dilutes the
 * rate during idle periods), we compute two separate metrics:
 *
 * 1. activeRate: How fast the plane burns hours when it IS flying
 *    (weighted average of hoursFlown / daysSincePrev, but only counting
 *    the active periods — gaps > 14 days are capped so they don't dilute)
 *
 * 2. activityRatio: What fraction of the time the plane is in active use
 *    (measured over the most recent 90 days)
 *
 * calendarBurnRate = activeRate * activityRatio
 *
 * This means: a plane that flies 4 hrs/day when active but only flies
 * 50% of the time gets a calendar rate of 2 hrs/day — which is what
 * the mechanic actually cares about for scheduling.
 */
function computeBurnRate(events: FlightEvent[]): {
  calendarRate: number;
  activeRate: number;
  activityRatio: number;
} {
  if (events.length === 0) {
    return { calendarRate: 0, activeRate: 0, activityRatio: 0 };
  }

  // --- Active rate (exponentially weighted) ---
  let weightedHours = 0;
  let weightedActiveDays = 0;

  for (const evt of events) {
    const weight = Math.pow(2, -evt.daysAgo / BURN_RATE_HALF_LIFE);
    weightedHours += evt.hoursFlown * weight;
    // Cap the gap at 14 days — longer gaps represent idle periods, not slow flying
    const activeDays = Math.min(evt.daysSincePrev, 14);
    weightedActiveDays += activeDays * weight;
  }

  const activeRate = weightedActiveDays > 0 ? weightedHours / weightedActiveDays : 0;

  // --- Activity ratio (last 90 days) ---
  const now = Date.now();
  const ninetyDaysAgo = now - (90 * MS_PER_DAY);
  const recentEvents = events.filter(e => e.timestamp >= ninetyDaysAgo);

  let activityRatio = 0;
  if (recentEvents.length > 0) {
    // Count days that had flight activity within the 90-day window
    const activeDaySet = new Set<number>();
    for (const evt of recentEvents) {
      // Mark each day in the flight's active period
      const flightEndDay = Math.floor((now - evt.timestamp) / MS_PER_DAY);
      const flightStartDay = Math.min(flightEndDay + Math.ceil(evt.daysSincePrev), 90);
      for (let d = flightEndDay; d < flightStartDay && d < 90; d++) {
        activeDaySet.add(d);
      }
    }
    activityRatio = activeDaySet.size / 90;
  }

  const calendarRate = activeRate * activityRatio;

  return { calendarRate, activeRate, activityRatio };
}

// ---------------------------------------------------------------
// VARIANCE: 7-day rolling window stability
// ---------------------------------------------------------------

/**
 * Measures variance using 7-day rolling windows of total hours accumulated.
 *
 * Instead of comparing individual flights (which penalizes mixed short/long
 * flights), we bucket all flights into weekly windows and measure how
 * consistent the WEEKLY totals are. This captures the operational rhythm
 * that a mechanic cares about.
 *
 * Returns the coefficient of variation (CV) of weekly hours.
 * CV of 0 = identical weeks. CV > 1 = wildly inconsistent weeks.
 */
function computeWeeklyCV(events: FlightEvent[]): number {
  if (events.length < 3) return 1.0; // Not enough data

  // Bucket flights into 7-day windows going back MAX_LOOKBACK_DAYS
  const numWindows = Math.floor(MAX_LOOKBACK_DAYS / VARIANCE_WINDOW_DAYS);
  const weeklyHours: number[] = new Array(numWindows).fill(0);
  const now = Date.now();

  for (const evt of events) {
    const windowIndex = Math.floor(evt.daysAgo / VARIANCE_WINDOW_DAYS);
    if (windowIndex >= 0 && windowIndex < numWindows) {
      weeklyHours[windowIndex] += evt.hoursFlown;
    }
  }

  // Only consider windows that are within the data range
  // (don't penalize for windows before the first flight)
  const oldestEvent = events[0]; // events are derived from logs sorted ascending
  const oldestDaysAgo = oldestEvent ? oldestEvent.daysAgo : 0;
  const firstRelevantWindow = Math.floor(oldestDaysAgo / VARIANCE_WINDOW_DAYS);
  const relevantWeeks = weeklyHours.slice(0, firstRelevantWindow + 1);

  if (relevantWeeks.length < 3) return 1.0;

  const mean = relevantWeeks.reduce((s, h) => s + h, 0) / relevantWeeks.length;
  if (mean === 0) return 1.0; // No hours at all

  const variance = relevantWeeks.reduce((s, h) => s + Math.pow(h - mean, 2), 0) / relevantWeeks.length;
  const stddev = Math.sqrt(variance);

  return Math.min(stddev / mean, 2.0); // Cap at 2.0 to avoid extreme outliers
}

// ---------------------------------------------------------------
// CONFIDENCE: Four-factor score with recency decay
// ---------------------------------------------------------------

/**
 * Computes 0-100 confidence based on four factors:
 *
 * 1. History depth (0-20 pts): How far back data goes (max at 180 days)
 * 2. Data density (0-20 pts): Flight count vs expected (4/month)
 * 3. Consistency (0-30 pts): Weekly CV stability
 * 4. Recency (0-30 pts): How recently the plane has flown
 *
 * Recency is weighted heavily because a plane that hasn't flown in 60 days
 * gives us essentially no predictive power regardless of historical quality.
 * A mechanic should not trust a projection if the plane has been sitting.
 */
function computeConfidence(
  planeLogs: MinimalFlightLog[],
  events: FlightEvent[],
  weeklyCV: number
): number {
  if (planeLogs.length === 0) return 0;

  const now = Date.now();

  // 1. History depth: 0-20 pts
  const oldestLog = planeLogs[0];
  const daysSpan = Math.max(1, (now - new Date(oldestLog.created_at).getTime()) / MS_PER_DAY);
  const depthScore = Math.min(20, (daysSpan / MAX_LOOKBACK_DAYS) * 20);

  // 2. Data density: 0-20 pts (target: 4 flights per month)
  const targetLogs = (daysSpan / 30) * 4;
  const densityScore = targetLogs > 0
    ? Math.min(20, (planeLogs.length / targetLogs) * 20)
    : 0;

  // 3. Consistency: 0-30 pts (inversely proportional to weekly CV)
  // CV of 0 = 30 pts, CV of 0.5 = 15 pts, CV of 1.0+ = 0 pts
  const consistencyScore = events.length >= 3
    ? Math.max(0, Math.min(30, 30 * (1 - weeklyCV)))
    : 0;

  // 4. Recency: 0-30 pts — decays aggressively when the plane stops flying
  const newestLog = planeLogs[planeLogs.length - 1];
  const daysSinceLastFlight = (now - new Date(newestLog.created_at).getTime()) / MS_PER_DAY;

  let recencyScore = 30;
  if (daysSinceLastFlight > RECENCY_GRACE_PERIOD) {
    const decayRange = RECENCY_KILL_DAYS - RECENCY_GRACE_PERIOD;
    const decayProgress = Math.min(1, (daysSinceLastFlight - RECENCY_GRACE_PERIOD) / decayRange);
    recencyScore = Math.round(30 * (1 - decayProgress));
  }

  return Math.round(depthScore + densityScore + consistencyScore + recencyScore);
}

// ---------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------

export function computeMetrics(
  plane: any,
  planeLogs: MinimalFlightLog[]
): {
  burnRate: number;
  confidenceScore: number;
  burnRateCV: number;
  burnRateLow: number;
  burnRateHigh: number;
} {
  if (planeLogs.length < 2) {
    const fallback = computeFallbackBurnRate(plane, planeLogs);
    return {
      burnRate: fallback,
      confidenceScore: planeLogs.length === 0 ? 0 : 10,
      burnRateCV: 1.0,
      burnRateLow: 0,
      burnRateHigh: fallback * 2,
    };
  }

  const isTurbine = plane.engine_type === 'Turbine';
  const events = extractFlightEvents(planeLogs, isTurbine);

  if (events.length === 0) {
    return { burnRate: 0, confidenceScore: 0, burnRateCV: 1.0, burnRateLow: 0, burnRateHigh: 0 };
  }

  const { calendarRate } = computeBurnRate(events);
  const weeklyCV = computeWeeklyCV(events);
  const confidenceScore = computeConfidence(planeLogs, events, weeklyCV);

  // Projection range: spread proportional to weekly variance
  // Low CV (consistent) = tight range. High CV (erratic) = wide range.
  const spreadFactor = Math.min(weeklyCV, 1.5);
  const burnRateLow = Math.max(0, calendarRate * (1 - spreadFactor * 0.5));
  const burnRateHigh = calendarRate * (1 + spreadFactor * 0.5);

  return {
    burnRate: calendarRate,
    confidenceScore,
    burnRateCV: weeklyCV,
    burnRateLow,
    burnRateHigh,
  };
}

function computeFallbackBurnRate(plane: any, planeLogs: MinimalFlightLog[]): number {
  if (planeLogs.length === 0) return 0;
  const isTurbine = plane.engine_type === 'Turbine';
  const currentTime = plane.total_engine_time || 0;
  const log = planeLogs[0];
  const logTime = isTurbine ? (log.ftt ?? 0) : (log.tach ?? 0);
  const daysElapsed = Math.max(1, (Date.now() - new Date(log.created_at).getTime()) / MS_PER_DAY);
  return currentTime > logTime ? (currentTime - logTime) / daysElapsed : 0;
}

export function enrichAircraftWithMetrics(
  planes: any[],
  allLogs: MinimalFlightLog[]
): AircraftWithMetrics[] {
  return planes.map(plane => {
    const planeLogs = allLogs.filter(l => l.aircraft_id === plane.id);
    const metrics = computeMetrics(plane, planeLogs);
    return {
      ...plane,
      burnRate: metrics.burnRate,
      confidenceScore: metrics.confidenceScore,
      burnRateCV: metrics.burnRateCV,
      burnRateLow: metrics.burnRateLow,
      burnRateHigh: metrics.burnRateHigh,
    };
  });
}

// ---------------------------------------------------------------
// MAINTENANCE PROCESSING
// ---------------------------------------------------------------

export function processMxItem(
  item: any,
  currentEngineTime: number,
  burnRate: number,
  burnRateLow?: number,
  burnRateHigh?: number
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

      if (!isExpired) {
        if (burnRateLow && burnRateHigh && burnRateHigh > 0 && burnRateLow !== burnRateHigh) {
          const daysHigh = Math.ceil(remaining / burnRateLow);   // Slow burn = more days
          const daysLow = Math.ceil(remaining / burnRateHigh);   // Fast burn = fewer days
          if (daysLow !== daysHigh && daysHigh - daysLow > 2) {
            dueText += ` (~${daysLow}-${daysHigh} days)`;
          } else {
            dueText += ` (~${Math.ceil(projectedDays)} days)`;
          }
        } else {
          dueText += ` (~${Math.ceil(projectedDays)} days)`;
        }
      }
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

export function isMxExpired(item: any, currentEngineTime: number): boolean {
  if (!item.is_required) return false;
  if (item.tracking_type === 'time') return (item.due_time ?? 0) <= currentEngineTime;
  if (item.tracking_type === 'date') {
    return new Date((item.due_date ?? '') + 'T00:00:00') < new Date(new Date().setHours(0, 0, 0, 0));
  }
  return false;
}

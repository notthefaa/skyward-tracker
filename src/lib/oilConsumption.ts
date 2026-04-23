// =============================================================
// OIL CONSUMPTION — shared thresholds + status helper
// =============================================================
// Single source of truth for the "hours since last oil addition"
// consumption indicator used by the Ops Checks dial, OilTab chart,
// and Howard's proactive warning logic. Keeping this in one file
// keeps the dial, the tool response, and Howard's context bullet
// from drifting apart.

export const OIL_RED_THRESHOLD_HRS = 5;
export const OIL_ORANGE_THRESHOLD_HRS = 10;

export const OIL_COLORS = {
  red: '#CE3732',
  orange: '#F08B46',
  green: '#56B94A',
  gray: '#9CA3AF',
} as const;

export type OilConsumptionLevel = 'red' | 'orange' | 'green' | 'gray';

export interface OilConsumptionStatus {
  level: OilConsumptionLevel;
  color: string;
  /** Null when no oil-addition events are on file yet. */
  hours_since_last_add: number | null;
  /** Short, UI-caption-ready. Null when level is green/gray (no warning to show). */
  ui_warning: string | null;
  /** Conversational sentence Howard can surface verbatim or paraphrase. */
  howard_message: string;
}

export function getOilConsumptionStatus(hoursSinceLastAdd: number | null): OilConsumptionStatus {
  if (hoursSinceLastAdd === null || !Number.isFinite(hoursSinceLastAdd)) {
    return {
      level: 'gray',
      color: OIL_COLORS.gray,
      hours_since_last_add: null,
      ui_warning: null,
      howard_message: "No oil additions logged yet — consumption rate can't be determined.",
    };
  }

  const hrs = Math.max(0, hoursSinceLastAdd);

  if (hrs < OIL_RED_THRESHOLD_HRS) {
    return {
      level: 'red',
      color: OIL_COLORS.red,
      hours_since_last_add: hrs,
      ui_warning: 'Check Oil Consumption',
      howard_message: `The engine seems to be using a lot of oil — only ${hrs.toFixed(1)} hrs since the last top-off. Worth checking for leaks or having a shop look her over.`,
    };
  }

  if (hrs < OIL_ORANGE_THRESHOLD_HRS) {
    return {
      level: 'orange',
      color: OIL_COLORS.orange,
      hours_since_last_add: hrs,
      ui_warning: 'Slightly Higher Consumption',
      howard_message: `Oil consumption is running a touch high — ${hrs.toFixed(1)} hrs since the last add. Make sure to watch your oil consumption.`,
    };
  }

  return {
    level: 'green',
    color: OIL_COLORS.green,
    hours_since_last_add: hrs,
    ui_warning: null,
    howard_message: `Oil consumption looks normal — ${hrs.toFixed(1)} hrs since the last add.`,
  };
}

/** Compute hours-since-last-add given the most recent oil-addition
 * log row (or null) and the aircraft's current engine hours. Pure
 * helper so both the API route and tool handler share the same math. */
export function hoursSinceLastOilAdd(
  lastAddEngineHours: number | null | undefined,
  currentEngineHours: number | null | undefined,
): number | null {
  if (lastAddEngineHours == null || !Number.isFinite(lastAddEngineHours)) return null;
  if (currentEngineHours == null || !Number.isFinite(currentEngineHours)) return null;
  return Math.max(0, currentEngineHours - lastAddEngineHours);
}

// =============================================================
// OIL CONSUMPTION — shared thresholds + status helper
// =============================================================
// Single source of truth for the "hours since last oil addition"
// consumption indicator used by the Ops Checks dial, OilTab chart,
// and Howard's proactive warning logic. Keeping this in one file
// keeps the dial, the tool response, and Howard's context bullet
// from drifting apart.
//
// Thresholds split by engine type because turbines normally burn
// a fraction of what pistons do. A piston Lycoming/Continental at
// 30 hrs/qt is golden; a PT6A at 30 hrs/qt is healthy too — but a
// PT6A at 8 hrs/qt is a seal/scavenge investigation. One global
// threshold table can't speak to both engines without crying wolf
// on turbines or sleeping through piston issues.

export type EngineType = 'Piston' | 'Turbine';

export interface OilThresholds {
  redHrs: number;
  orangeHrs: number;
  /** Visual cap for the radial dial — past this, the arc is fully
   * filled. Set above the green threshold so the user has visual
   * headroom to "see" their normal range. */
  visualCapHrs: number;
}

export const OIL_THRESHOLDS: Record<EngineType, OilThresholds> = {
  Piston: {
    redHrs: 5,
    orangeHrs: 10,
    visualCapHrs: 20,
  },
  Turbine: {
    // Turbines (PT6A, FJ33, JT15D-class) typically run 30–60 hrs/qt
    // in cruise. A turbine using a quart every <15 hrs warrants a
    // shop look — likely seal, scavenge pump, or scupper issue.
    redHrs: 15,
    orangeHrs: 30,
    visualCapHrs: 60,
  },
};

// Back-compat exports — older code that didn't differentiate engine
// type implicitly meant the piston bands. Keep these pointing at
// piston so external consumers (and the existing test suite) stay
// stable.
export const OIL_RED_THRESHOLD_HRS = OIL_THRESHOLDS.Piston.redHrs;
export const OIL_ORANGE_THRESHOLD_HRS = OIL_THRESHOLDS.Piston.orangeHrs;

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
  /** Engine type the verdict was computed against — useful for Howard
   * context and dial visual scaling. */
  engine_type: EngineType;
}

/**
 * Resolve a consumption status given hours since the last oil add and
 * the engine type. Engine-type defaults to Piston so legacy callers
 * (and historical aircraft rows where engine_type may be null) stay
 * on the safer-but-louder piston bands rather than silently passing
 * a turbine-flagged value as green.
 */
export function getOilConsumptionStatus(
  hoursSinceLastAdd: number | null,
  engineType: EngineType = 'Piston',
): OilConsumptionStatus {
  const thresholds = OIL_THRESHOLDS[engineType];
  const isTurb = engineType === 'Turbine';

  if (hoursSinceLastAdd === null || !Number.isFinite(hoursSinceLastAdd)) {
    return {
      level: 'gray',
      color: OIL_COLORS.gray,
      hours_since_last_add: null,
      ui_warning: null,
      howard_message: "No oil additions logged yet — consumption rate can't be determined.",
      engine_type: engineType,
    };
  }

  const hrs = Math.max(0, hoursSinceLastAdd);

  if (hrs < thresholds.redHrs) {
    return {
      level: 'red',
      color: OIL_COLORS.red,
      hours_since_last_add: hrs,
      ui_warning: 'Check Oil Consumption',
      howard_message: isTurb
        ? `Burning oil faster than a turbine should — only ${hrs.toFixed(1)} hrs since the last add. That's seal-or-scavenge territory; worth a shop look before the next leg.`
        : `The engine seems to be using a lot of oil — only ${hrs.toFixed(1)} hrs since the last top-off. Worth checking for leaks or having a shop look her over.`,
      engine_type: engineType,
    };
  }

  if (hrs < thresholds.orangeHrs) {
    return {
      level: 'orange',
      color: OIL_COLORS.orange,
      hours_since_last_add: hrs,
      ui_warning: 'Slightly Higher Consumption',
      howard_message: isTurb
        ? `Oil use is on the high side for a turbine — ${hrs.toFixed(1)} hrs since the last add. Worth watching the trend on the next few legs.`
        : `Oil consumption is running a touch high — ${hrs.toFixed(1)} hrs since the last add. Make sure to watch your oil consumption.`,
      engine_type: engineType,
    };
  }

  return {
    level: 'green',
    color: OIL_COLORS.green,
    hours_since_last_add: hrs,
    ui_warning: null,
    howard_message: isTurb
      ? `Oil consumption is in the normal turbine range — ${hrs.toFixed(1)} hrs since the last add.`
      : `Oil consumption looks normal — ${hrs.toFixed(1)} hrs since the last add.`,
    engine_type: engineType,
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

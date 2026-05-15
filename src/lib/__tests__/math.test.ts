import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeMetrics,
  enrichAircraftWithMetrics,
  processMxItem,
  getMxTextColor,
  isMxExpired,
  computeMxDueState,
} from '../math';

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Generate N flight logs spread over `totalDays` days with a consistent
 * tach increment per log (simulating a piston plane).
 *
 * The first log starts at `startTach` and each subsequent log adds
 * `hoursPerFlight` to tach. Logs are evenly spaced going backwards
 * from `daysAgoStart` (default 0 = today).
 */
function generateLogs(
  count: number,
  {
    aircraftId = 'plane-1',
    startTach = 1000,
    hoursPerFlight = 2,
    totalDays = 90,
    daysAgoStart = 0,
    useFtt = false,
    /** Simulate the companion-app offline-queue case: `created_at`
     * reflects the flush time (default 0 days ago), separate from
     * `occurred_at` (the real flight time). Passing `createdAtOverride`
     * pins every log's created_at to that many days ago — the engine
     * should still honor occurred_at and not be fooled by the fresh
     * write timestamp. */
    createdAtOverride,
  }: {
    aircraftId?: string;
    startTach?: number;
    hoursPerFlight?: number;
    totalDays?: number;
    daysAgoStart?: number;
    useFtt?: boolean;
    createdAtOverride?: number;
  } = {}
) {
  const now = Date.now();
  const logs = [];
  const interval = count > 1 ? totalDays / (count - 1) : 0;

  for (let i = 0; i < count; i++) {
    const daysAgo = daysAgoStart + totalDays - i * interval;
    const tachValue = startTach + i * hoursPerFlight;
    const occurredAt = new Date(now - daysAgo * MS_PER_DAY).toISOString();
    const createdAt = createdAtOverride !== undefined
      ? new Date(now - createdAtOverride * MS_PER_DAY).toISOString()
      : occurredAt;
    logs.push({
      aircraft_id: aircraftId,
      tach: useFtt ? null : tachValue,
      ftt: useFtt ? tachValue : null,
      created_at: createdAt,
      occurred_at: occurredAt,
    });
  }

  return logs;
}

function makePlane(overrides: Record<string, any> = {}) {
  return {
    id: 'plane-1',
    engine_type: 'Piston',
    total_engine_time: 1100,
    ...overrides,
  };
}

// ---------------------------------------------------------------
// computeMetrics
// ---------------------------------------------------------------

describe('computeMetrics', () => {
  it('returns zeros with empty logs', () => {
    const result = computeMetrics(makePlane(), []);
    expect(result.burnRate).toBe(0);
    expect(result.confidenceScore).toBe(0);
    expect(result.burnRateCV).toBe(1.0);
    expect(result.burnRateLow).toBe(0);
    expect(result.burnRateHigh).toBe(0);
  });

  it('returns fallback with a single log', () => {
    const plane = makePlane({ total_engine_time: 1050 });
    const logs = generateLogs(1, { startTach: 1000, totalDays: 0, daysAgoStart: 50 });
    const result = computeMetrics(plane, logs);

    // Fallback: (1050 - 1000) / ~50 days = ~1 hr/day
    expect(result.burnRate).toBeGreaterThan(0);
    expect(result.confidenceScore).toBe(10); // single log fallback confidence
    expect(result.burnRateCV).toBe(1.0);
    expect(result.burnRateHigh).toBeGreaterThan(0);
  });

  it('computes positive burn rate with multiple consistent logs (piston)', () => {
    // 20 logs over 60 days, 2 hrs per flight, starting 0 days ago
    const logs = generateLogs(20, {
      startTach: 1000,
      hoursPerFlight: 2,
      totalDays: 60,
      daysAgoStart: 0,
    });
    const plane = makePlane();
    const result = computeMetrics(plane, logs);

    expect(result.burnRate).toBeGreaterThan(0);
    expect(result.confidenceScore).toBeGreaterThan(0);
    expect(result.burnRateLow).toBeGreaterThanOrEqual(0);
    expect(result.burnRateHigh).toBeGreaterThan(result.burnRateLow);
  });

  it('has higher confidence with more consistent recent data', () => {
    // Dense recent data: 30 logs over 60 days ending today
    const denseLogs = generateLogs(30, {
      startTach: 1000,
      hoursPerFlight: 2,
      totalDays: 60,
      daysAgoStart: 0,
    });
    // Sparse data: 5 logs over 60 days ending today
    const sparseLogs = generateLogs(5, {
      startTach: 1000,
      hoursPerFlight: 2,
      totalDays: 60,
      daysAgoStart: 0,
    });
    const plane = makePlane();

    const denseResult = computeMetrics(plane, denseLogs);
    const sparseResult = computeMetrics(plane, sparseLogs);

    expect(denseResult.confidenceScore).toBeGreaterThan(sparseResult.confidenceScore);
  });

  it('has lower confidence when data is old (no recent flights)', () => {
    // All flights happened 100-160 days ago, nothing recent
    const oldLogs = generateLogs(20, {
      startTach: 1000,
      hoursPerFlight: 2,
      totalDays: 60,
      daysAgoStart: 100,
    });
    // Same frequency but ending today
    const recentLogs = generateLogs(20, {
      startTach: 1000,
      hoursPerFlight: 2,
      totalDays: 60,
      daysAgoStart: 0,
    });
    const plane = makePlane();

    const oldResult = computeMetrics(plane, oldLogs);
    const recentResult = computeMetrics(plane, recentLogs);

    expect(recentResult.confidenceScore).toBeGreaterThan(oldResult.confidenceScore);
  });

  it('turbine mode uses ftt instead of tach', () => {
    const plane = makePlane({ engine_type: 'Turbine' });
    const logs = generateLogs(15, {
      startTach: 500,
      hoursPerFlight: 3,
      totalDays: 45,
      daysAgoStart: 0,
      useFtt: true,
    });
    const result = computeMetrics(plane, logs);

    expect(result.burnRate).toBeGreaterThan(0);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------
// enrichAircraftWithMetrics
// ---------------------------------------------------------------

describe('enrichAircraftWithMetrics', () => {
  it('enriches multiple planes with their respective metrics', () => {
    const planes = [
      makePlane({ id: 'p1' }),
      makePlane({ id: 'p2' }),
    ];
    const logs = [
      ...generateLogs(10, { aircraftId: 'p1', totalDays: 30, daysAgoStart: 0 }),
      ...generateLogs(5, { aircraftId: 'p2', totalDays: 30, daysAgoStart: 0 }),
    ];
    const result = enrichAircraftWithMetrics(planes, logs);

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty('burnRate');
    expect(result[0]).toHaveProperty('confidenceScore');
    expect(result[1]).toHaveProperty('burnRate');
  });
});

// ---------------------------------------------------------------
// processMxItem
// ---------------------------------------------------------------

describe('processMxItem', () => {
  it('time-based item: correct remaining hours and projected days', () => {
    const item = {
      id: 'mx-1',
      aircraft_id: 'plane-1',
      item_name: 'Oil Change',
      tracking_type: 'time' as const,
      is_required: true,
      due_time: 1200,
    };
    // currentEngineTime=1100, so remaining=100 hrs. burnRate=2 hrs/day => ~50 days
    const result = processMxItem(item, 1100, 2);

    expect(result.remaining).toBe(100);
    expect(result.isExpired).toBe(false);
    expect(result.projectedDays).toBe(50);
    expect(result.dueText).toContain('100.0');
    expect(result.dueText).toContain('50 days');
  });

  it('time-based expired item: isExpired = true, negative remaining', () => {
    const item = {
      id: 'mx-2',
      aircraft_id: 'plane-1',
      item_name: 'Overhaul',
      tracking_type: 'time' as const,
      is_required: true,
      due_time: 1000,
    };
    const result = processMxItem(item, 1050, 2);

    expect(result.remaining).toBe(-50);
    expect(result.isExpired).toBe(true);
    expect(result.dueText).toContain('Expired by 50.0 hrs');
  });

  it('date-based item: correct remaining days', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 45);
    const dueDateStr = futureDate.toISOString().split('T')[0];

    const item = {
      id: 'mx-3',
      aircraft_id: 'plane-1',
      item_name: 'Annual Inspection',
      tracking_type: 'date' as const,
      is_required: true,
      due_date: dueDateStr,
    };
    const result = processMxItem(item, 0, 0);

    expect(result.remaining).toBe(45);
    expect(result.isExpired).toBe(false);
    expect(result.dueText).toContain('45 days');
  });

  it('date-based expired item', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);
    const dueDateStr = pastDate.toISOString().split('T')[0];

    const item = {
      id: 'mx-4',
      aircraft_id: 'plane-1',
      item_name: 'ELT Battery',
      tracking_type: 'date' as const,
      is_required: true,
      due_date: dueDateStr,
    };
    const result = processMxItem(item, 0, 0);

    expect(result.remaining).toBeLessThan(0);
    expect(result.isExpired).toBe(true);
    expect(result.dueText).toContain('Expired');
  });

  it('projection range generates day range in dueText when spread is significant', () => {
    const item = {
      id: 'mx-5',
      aircraft_id: 'plane-1',
      item_name: 'Prop Overhaul',
      tracking_type: 'time' as const,
      is_required: true,
      due_time: 1500,
    };
    // remaining=500 hrs, burnRate=2, burnRateLow=1, burnRateHigh=4
    // daysHigh = 500/1 = 500, daysLow = 500/4 = 125
    const result = processMxItem(item, 1000, 2, 1, 4);

    expect(result.isExpired).toBe(false);
    expect(result.dueText).toMatch(/~125-500 days/);
  });

  it('projection range falls back to single estimate when spread is small', () => {
    const item = {
      id: 'mx-6',
      aircraft_id: 'plane-1',
      item_name: 'Magneto Check',
      tracking_type: 'time' as const,
      is_required: true,
      due_time: 1200,
    };
    // remaining=100 hrs, burnRate=2, burnRateLow=1.9, burnRateHigh=2.1
    // daysHigh = ceil(100/1.9) = 53, daysLow = ceil(100/2.1) = 48 => diff = 5 > 2 actually
    // Let's make them nearly identical: low=1.99, high=2.01
    // daysHigh = ceil(100/1.99) = 51, daysLow = ceil(100/2.01) = 50 => diff=1, <=2
    const result = processMxItem(item, 1100, 2, 1.99, 2.01);

    expect(result.isExpired).toBe(false);
    expect(result.dueText).toContain('~50 days');
    expect(result.dueText).not.toMatch(/\d+-\d+ days/);
  });

  // ─── 'both' tracking-type driver selection ───
  // Regression: stationary aircraft (burnRate = 0) makes
  // `timeResult.projectedDays` Infinity. Pre-fix the min-projectedDays
  // rule then picked the date side as driver even when the time side
  // was already expired — burying a real grounding under a calendar
  // countdown.
  describe('processMxItem — both-tracking driver selection', () => {
    const both = (overrides: Partial<any>) => ({
      id: 'mx-1', aircraft_id: 'ac-1', item_name: 'Annual', is_required: true,
      tracking_type: 'both' as const,
      ...overrides,
    });

    const futureDate = (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })();
    const pastDate = (() => { const d = new Date(); d.setDate(d.getDate() - 5); return d.toISOString().slice(0, 10); })();

    it('expired time side drives when date side is not expired (zero burnRate)', () => {
      const item = both({ due_time: 1900, due_date: futureDate });
      // currentEngineTime past due_time → time side expired
      const result = processMxItem(item, 2000, 0);
      expect(result.isExpired).toBe(true);
      expect(result.dueText.startsWith('Expired by')).toBe(true);
    });

    it('expired date side drives when time side is not expired', () => {
      const item = both({ due_time: 5000, due_date: pastDate });
      const result = processMxItem(item, 1000, 2);
      expect(result.isExpired).toBe(true);
      expect(result.dueText.startsWith('Expired')).toBe(true);
      expect(result.dueText.toLowerCase()).toContain('days ago');
    });

    it('both expired: more-overdue side drives', () => {
      const item = both({ due_time: 1900, due_date: pastDate });
      const result = processMxItem(item, 2000, 2);
      expect(result.isExpired).toBe(true);
    });

    it('neither expired: sooner-due side drives', () => {
      // Date 30 days out, hours = 100 hrs at 5/day = 20 days → time wins
      const item = both({ due_time: 1100, due_date: futureDate });
      const result = processMxItem(item, 1000, 5);
      expect(result.isExpired).toBe(false);
      expect(result.dueText.startsWith('Due in')).toBe(true);
      expect(result.dueText).toContain('hrs');
    });
  });
});

// ---------------------------------------------------------------
// getMxTextColor
// ---------------------------------------------------------------

describe('getMxTextColor', () => {
  const defaultSettings = {
    reminder_1: 30,
    reminder_3: 5,
    reminder_hours_1: 30,
    reminder_hours_3: 5,
  };

  it('returns red when expired', () => {
    const item = {
      id: 'mx-1', aircraft_id: 'p', item_name: 'X', tracking_type: 'time' as const,
      is_required: true, remaining: -10, projectedDays: -5, isExpired: true, dueText: '',
    };
    expect(getMxTextColor(item, defaultSettings)).toBe('text-[#CE3732]');
  });

  it('returns red when within reminder_3 threshold (remaining hours)', () => {
    const item = {
      id: 'mx-2', aircraft_id: 'p', item_name: 'X', tracking_type: 'time' as const,
      is_required: true, remaining: 3, projectedDays: 60, isExpired: false, dueText: '',
    };
    // remaining=3 <= reminder_hours_3=5 => red
    expect(getMxTextColor(item, defaultSettings)).toBe('text-[#CE3732]');
  });

  it('returns red when projected days within reminder_3 threshold', () => {
    const item = {
      id: 'mx-3', aircraft_id: 'p', item_name: 'X', tracking_type: 'time' as const,
      is_required: true, remaining: 100, projectedDays: 4, isExpired: false, dueText: '',
    };
    // projectedDays=4 <= reminder_3=5 => red
    expect(getMxTextColor(item, defaultSettings)).toBe('text-[#CE3732]');
  });

  it('returns orange when within reminder_1 threshold', () => {
    const item = {
      id: 'mx-4', aircraft_id: 'p', item_name: 'X', tracking_type: 'time' as const,
      is_required: true, remaining: 20, projectedDays: 25, isExpired: false, dueText: '',
    };
    // remaining=20 <= reminder_hours_1=30 => orange
    expect(getMxTextColor(item, defaultSettings)).toBe('text-[#F08B46]');
  });

  it('returns green when plenty of time remaining', () => {
    const item = {
      id: 'mx-5', aircraft_id: 'p', item_name: 'X', tracking_type: 'time' as const,
      is_required: true, remaining: 100, projectedDays: 200, isExpired: false, dueText: '',
    };
    expect(getMxTextColor(item, defaultSettings)).toBe('text-success');
  });
});

// ---------------------------------------------------------------
// isMxExpired
// ---------------------------------------------------------------

describe('isMxExpired', () => {
  it('returns false for non-required items', () => {
    const item = {
      id: 'mx-1', aircraft_id: 'p', item_name: 'Optional',
      tracking_type: 'time', is_required: false, due_time: 500,
    };
    expect(isMxExpired(item, 1000)).toBe(false);
  });

  it('returns true when time-based item is past due', () => {
    const item = {
      id: 'mx-2', aircraft_id: 'p', item_name: 'Overhaul',
      tracking_type: 'time', is_required: true, due_time: 900,
    };
    expect(isMxExpired(item, 1000)).toBe(true);
  });

  it('returns true when time-based item is exactly at due_time', () => {
    const item = {
      id: 'mx-3', aircraft_id: 'p', item_name: 'Check',
      tracking_type: 'time', is_required: true, due_time: 1000,
    };
    expect(isMxExpired(item, 1000)).toBe(true);
  });

  it('returns true when date-based item is past due', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5);
    const item = {
      id: 'mx-4', aircraft_id: 'p', item_name: 'Annual',
      tracking_type: 'date', is_required: true,
      due_date: pastDate.toISOString().split('T')[0],
    };
    expect(isMxExpired(item, 0)).toBe(true);
  });

  it('returns false when time-based item still has time', () => {
    const item = {
      id: 'mx-5', aircraft_id: 'p', item_name: 'Next Check',
      tracking_type: 'time', is_required: true, due_time: 2000,
    };
    expect(isMxExpired(item, 1000)).toBe(false);
  });

  it('returns false when date-based item is in the future', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    const item = {
      id: 'mx-6', aircraft_id: 'p', item_name: 'Future Check',
      tracking_type: 'date', is_required: true,
      due_date: futureDate.toISOString().split('T')[0],
    };
    expect(isMxExpired(item, 0)).toBe(false);
  });

  it('honors the timezone argument when comparing due_date against "today"', () => {
    // Server-side grounding check (Howard's check_airworthiness tool)
    // runs on Vercel UTC. Without passing the aircraft's zone, an item
    // due-tomorrow-in-Pacific-time can appear expired in the
    // UTC-evening window (UTC day has rolled over, Pacific hasn't).
    // Pass in a future date in the aircraft's zone and confirm it
    // resolves to "not expired" regardless of UTC wall-clock.
    const tomorrowUtc = new Date();
    tomorrowUtc.setUTCDate(tomorrowUtc.getUTCDate() + 1);
    const dueDate = tomorrowUtc.toISOString().split('T')[0];
    const item = {
      id: 'mx-tz', aircraft_id: 'p', item_name: 'Annual',
      tracking_type: 'date', is_required: true,
      due_date: dueDate,
    };
    // Pacific zone: tomorrow-in-UTC is at earliest "today" in Pacific,
    // never expired.
    expect(isMxExpired(item, 0, 'America/Los_Angeles')).toBe(false);
    // No-zone fallback behaves like UTC — same answer for a
    // tomorrow-in-UTC date.
    expect(isMxExpired(item, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------
// occurred_at drift — regression guard
// ---------------------------------------------------------------

describe('occurred_at drives predictive math, not created_at', () => {
  it('recency factor keys off occurred_at, not the flush time', () => {
    // Scenario: a fleet of old flights. Every log has occurred_at
    // 60-90 days ago (inactive plane) but created_at = today (the
    // companion app just flushed an offline queue). The engine must
    // NOT treat this as a fresh-flying aircraft — recency score should
    // reflect the real flight time, keeping confidence low.
    const oldLogs = generateLogs(20, {
      startTach: 1000,
      hoursPerFlight: 2,
      totalDays: 30,
      daysAgoStart: 60,         // flights 60-90 days ago (occurred_at)
      createdAtOverride: 0,     // but written to the DB today
    });
    const plane = makePlane();
    const result = computeMetrics(plane, oldLogs);

    // Without the fix, recency would be at its max (30 pts, since
    // newest created_at is today) and confidence would sit ~90. With
    // occurred_at respected, the newest actual flight is 60 days ago,
    // past the 14-day grace, well into decay — recency ≈ 0.
    expect(result.confidenceScore).toBeLessThan(60);
  });

  it('burn rate does not spike when offline-queued flights land with fresh created_at', () => {
    // Same offline-flush scenario, but the operative check is that
    // the exponentially-weighted burn rate doesn't pin all 20 flights
    // at daysAgo=0 (weight=1 each). If the engine mistakenly uses
    // created_at, every flight gets the maximum weight and the burn
    // rate collapses to `hoursPerFlight / 1-day-gap` = 2 h/day. With
    // occurred_at honored, each flight sits at its real age and the
    // result is smaller because of the 14-day gap cap + 90-day
    // activity window.
    const logs = generateLogs(20, {
      startTach: 1000,
      hoursPerFlight: 2,
      totalDays: 30,
      daysAgoStart: 60,         // real flights 60-90 days ago
      createdAtOverride: 0,     // all flushed today
    });
    const plane = makePlane();
    const result = computeMetrics(plane, logs);

    // If created_at were driving: 20 flights today → recency-weighted
    // rate of ~2 h/day. Real math: flights 60-90 days ago, activity
    // ratio is 0 (nothing in last 90 days is contradicted by the
    // filter — let's just assert the rate didn't spike to the 2 h/day
    // ceiling).
    expect(result.burnRate).toBeLessThan(1.5);
  });

  it('falls back to created_at when occurred_at is missing (legacy rows)', () => {
    // Any log row somehow without occurred_at should still compute.
    // Not exhaustive, just a smoke test that the fallback path works.
    const now = Date.now();
    const legacyLogs = [
      {
        aircraft_id: 'plane-1',
        tach: 1000,
        ftt: null,
        created_at: new Date(now - 60 * MS_PER_DAY).toISOString(),
        occurred_at: null, // pre-backfill row
      },
      {
        aircraft_id: 'plane-1',
        tach: 1040,
        ftt: null,
        created_at: new Date(now - 30 * MS_PER_DAY).toISOString(),
        occurred_at: null,
      },
    ];
    const plane = makePlane();
    const result = computeMetrics(plane, legacyLogs);
    expect(result.burnRate).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.confidenceScore)).toBe(true);
  });
});

// ---------------------------------------------------------------
// computeMxDueState — shared primitive for cron + UI
// ---------------------------------------------------------------

describe('computeMxDueState', () => {
  it('computes hoursLeft and daysFromHours for a time-based item', () => {
    const item = {
      id: 'mx', aircraft_id: 'p', item_name: 'Oil',
      tracking_type: 'time', due_time: 1200,
    };
    const s = computeMxDueState(item, 1100, 2);
    expect(s.hasTimeData).toBe(true);
    expect(s.hasDateData).toBe(false);
    expect(s.hoursLeft).toBe(100);
    expect(s.daysFromHours).toBe(50);
    expect(s.daysLeft).toBe(Infinity);
    expect(s.isTimeExpired).toBe(false);
  });

  it('returns Infinity on the unused dimension', () => {
    const item = {
      id: 'mx', aircraft_id: 'p', item_name: 'Date-only',
      tracking_type: 'date', due_date: '2099-01-01',
    };
    const s = computeMxDueState(item, 0, 0);
    expect(s.hasTimeData).toBe(false);
    expect(s.hasDateData).toBe(true);
    expect(s.hoursLeft).toBe(Infinity);
    expect(s.daysFromHours).toBe(Infinity);
    expect(s.daysLeft).toBeGreaterThan(0);
  });

  it('marks time side expired when current engine time >= due_time', () => {
    const item = {
      id: 'mx', aircraft_id: 'p', item_name: 'Overhaul',
      tracking_type: 'time', due_time: 1000,
    };
    const s = computeMxDueState(item, 1050, 2);
    expect(s.hoursLeft).toBe(-50);
    expect(s.isTimeExpired).toBe(true);
  });

  it('returns infinity daysFromHours when burn rate is 0', () => {
    const item = {
      id: 'mx', aircraft_id: 'p', item_name: 'Oil',
      tracking_type: 'time', due_time: 1200,
    };
    const s = computeMxDueState(item, 1100, 0);
    expect(s.hoursLeft).toBe(100);
    expect(s.daysFromHours).toBe(Infinity);
  });

  it('populates both sides for tracking_type="both" items', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 45);
    const item = {
      id: 'mx', aircraft_id: 'p', item_name: 'Annual',
      tracking_type: 'both', due_time: 2000,
      due_date: futureDate.toISOString().split('T')[0],
    };
    const s = computeMxDueState(item, 1950, 2);
    expect(s.hasTimeData).toBe(true);
    expect(s.hasDateData).toBe(true);
    expect(s.hoursLeft).toBe(50);
    expect(s.daysLeft).toBe(45);
  });
});

// ---------------------------------------------------------------
// Burn-rate cadence invariance (v4 regression guard)
// ---------------------------------------------------------------
// v3 multiplied activeRate by activityRatio = distinct-flight-days /
// 90, which under-predicted batch loggers by 3-14× — a real safety
// bug because MX "Due in N days" stayed green well past real deadlines.
// v4's burn rate is EWMA-weighted hours / EWMA-weighted calendar days
// in the observed-history window, so logging cadence doesn't move the
// answer.

describe('burn-rate cadence invariance (v4)', () => {
  // Same aircraft, same 5 hrs/week of real usage over a 90-day span,
  // expressed two ways: 3 short flights/week vs. one batched entry/week.
  // The predicted burn rate must come out within ~10% of each other.
  it('diligent vs weekly-batched logging yields the same burn rate', () => {
    const startTach = 1000;
    const now = Date.now();

    // Generate the per-flight schedule first, then sort oldest→newest,
    // then accumulate tach in that order so it stays monotonic.
    type Leg = { daysAgo: number; hours: number };
    const diligentLegs: Leg[] = [];
    for (let week = 0; week < 13; week++) {
      for (let f = 0; f < 3; f++) {
        diligentLegs.push({ daysAgo: week * 7 + f * 2, hours: 5 / 3 });
      }
    }
    const weeklyLegs: Leg[] = [];
    for (let week = 0; week < 13; week++) {
      weeklyLegs.push({ daysAgo: week * 7, hours: 5 });
    }

    const toLogs = (legs: Leg[]) => {
      // Sort oldest first (largest daysAgo first).
      const sorted = [...legs].sort((a, b) => b.daysAgo - a.daysAgo);
      let tach = startTach;
      return sorted.map(leg => {
        tach += leg.hours;
        const ts = new Date(now - leg.daysAgo * MS_PER_DAY).toISOString();
        return {
          aircraft_id: 'p', tach: Number(tach.toFixed(2)), ftt: null,
          occurred_at: ts, created_at: ts,
        };
      });
    };

    const diligentLogs = toLogs(diligentLegs);
    const weeklyLogs = toLogs(weeklyLegs);

    // Sanity: both series cover ~the same total hours.
    const dTotal = diligentLogs[diligentLogs.length - 1].tach! - startTach;
    const wTotal = weeklyLogs[weeklyLogs.length - 1].tach! - startTach;
    expect(Math.abs(dTotal - wTotal)).toBeLessThan(0.5);

    const plane = makePlane({ total_engine_time: diligentLogs[diligentLogs.length - 1].tach });
    const diligent = computeMetrics(plane, diligentLogs);
    const weekly = computeMetrics(plane, weeklyLogs);

    // Within 15% of each other. v3 had ~3× gap here.
    const delta = Math.abs(diligent.burnRate - weekly.burnRate);
    const avg = (diligent.burnRate + weekly.burnRate) / 2;
    expect(delta / avg).toBeLessThan(0.15);

    // And both reflect the real ~0.7 hrs/day usage, not the v3
    // under-estimate (~0.1-0.3 hrs/day).
    expect(diligent.burnRate).toBeGreaterThan(0.4);
    expect(weekly.burnRate).toBeGreaterThan(0.4);
  });

  it('parked aircraft outside the lookback window reads as zero burn rate', () => {
    // Old flights 200-250 days ago, nothing recent. v4's lookback caps
    // at MAX_LOOKBACK_DAYS=180 so these events drop out entirely.
    const now = Date.now();
    const logs = [
      {
        aircraft_id: 'p', tach: 1000, ftt: null,
        occurred_at: new Date(now - 250 * MS_PER_DAY).toISOString(),
        created_at: new Date(now - 250 * MS_PER_DAY).toISOString(),
      },
      {
        aircraft_id: 'p', tach: 1005, ftt: null,
        occurred_at: new Date(now - 200 * MS_PER_DAY).toISOString(),
        created_at: new Date(now - 200 * MS_PER_DAY).toISOString(),
      },
    ];
    const plane = makePlane({ total_engine_time: 1005 });
    const result = computeMetrics(plane, logs);
    expect(result.burnRate).toBe(0);
  });
});

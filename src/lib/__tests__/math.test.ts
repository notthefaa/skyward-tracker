import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeMetrics,
  enrichAircraftWithMetrics,
  processMxItem,
  getMxTextColor,
  isMxExpired,
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
  }: {
    aircraftId?: string;
    startTach?: number;
    hoursPerFlight?: number;
    totalDays?: number;
    daysAgoStart?: number;
    useFtt?: boolean;
  } = {}
) {
  const now = Date.now();
  const logs = [];
  const interval = count > 1 ? totalDays / (count - 1) : 0;

  for (let i = 0; i < count; i++) {
    const daysAgo = daysAgoStart + totalDays - i * interval;
    const tachValue = startTach + i * hoursPerFlight;
    logs.push({
      aircraft_id: aircraftId,
      tach: useFtt ? null : tachValue,
      ftt: useFtt ? tachValue : null,
      created_at: new Date(now - daysAgo * MS_PER_DAY).toISOString(),
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
});

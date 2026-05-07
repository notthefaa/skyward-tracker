import { describe, it, expect } from 'vitest';
import {
  getOilConsumptionStatus,
  hoursSinceLastOilAdd,
  OIL_RED_THRESHOLD_HRS,
  OIL_ORANGE_THRESHOLD_HRS,
  OIL_THRESHOLDS,
} from '@/lib/oilConsumption';

describe('hoursSinceLastOilAdd', () => {
  it('returns null when last-add hours are missing', () => {
    expect(hoursSinceLastOilAdd(null, 100)).toBeNull();
    expect(hoursSinceLastOilAdd(undefined, 100)).toBeNull();
  });

  it('returns null when current engine hours are missing', () => {
    expect(hoursSinceLastOilAdd(90, null)).toBeNull();
    expect(hoursSinceLastOilAdd(90, undefined)).toBeNull();
  });

  it('returns null for non-finite inputs (NaN, Infinity)', () => {
    expect(hoursSinceLastOilAdd(NaN, 100)).toBeNull();
    expect(hoursSinceLastOilAdd(90, Infinity)).toBeNull();
  });

  it('floors at 0 when the last-add timestamp is somehow after current', () => {
    // Guards against clock skew / backfilled data where lastAdd > current.
    expect(hoursSinceLastOilAdd(110, 100)).toBe(0);
  });

  it('computes the positive delta for normal inputs', () => {
    expect(hoursSinceLastOilAdd(90, 100)).toBe(10);
    expect(hoursSinceLastOilAdd(100.5, 103.2)).toBeCloseTo(2.7, 5);
  });
});

describe('getOilConsumptionStatus — Piston (default)', () => {
  it('returns gray for null hours (no additions logged)', () => {
    const s = getOilConsumptionStatus(null, 'Piston', 0);
    expect(s.level).toBe('gray');
    expect(s.hours_since_last_add).toBeNull();
    expect(s.add_event_count).toBe(0);
    expect(s.ui_warning).toBeNull();
    expect(s.howard_message).toMatch(/no oil additions/i);
    expect(s.engine_type).toBe('Piston');
  });

  it('returns red when hours < 5 (with 2+ add events)', () => {
    const s = getOilConsumptionStatus(3, 'Piston', 2);
    expect(s.level).toBe('red');
    expect(s.hours_since_last_add).toBe(3);
    expect(s.add_event_count).toBe(2);
    expect(s.ui_warning).toBe('Check Oil Consumption');
    expect(s.howard_message).toMatch(/using a lot of oil/i);
  });

  it('returns orange at the 5–10 band (with 2+ add events)', () => {
    const s = getOilConsumptionStatus(7, 'Piston', 2);
    expect(s.level).toBe('orange');
    expect(s.ui_warning).toBe('Slightly Higher Consumption');
    expect(s.howard_message).toMatch(/watch your oil consumption/i);
  });

  it('returns green at 10+ hours (with 2+ add events)', () => {
    const s = getOilConsumptionStatus(15, 'Piston', 2);
    expect(s.level).toBe('green');
    expect(s.ui_warning).toBeNull();
    expect(s.howard_message).toMatch(/normal/i);
  });

  it('treats the red/orange boundary as orange (exclusive on the red side)', () => {
    expect(getOilConsumptionStatus(OIL_RED_THRESHOLD_HRS, 'Piston', 2).level).toBe('orange');
    expect(getOilConsumptionStatus(OIL_RED_THRESHOLD_HRS - 0.01, 'Piston', 2).level).toBe('red');
  });

  it('treats the orange/green boundary as green (exclusive on the orange side)', () => {
    expect(getOilConsumptionStatus(OIL_ORANGE_THRESHOLD_HRS, 'Piston', 2).level).toBe('green');
    expect(getOilConsumptionStatus(OIL_ORANGE_THRESHOLD_HRS - 0.01, 'Piston', 2).level).toBe('orange');
  });

  it('floors negative inputs at 0 rather than rejecting them', () => {
    // Not a realistic input, but we don't want a negative leak bug to
    // silently turn into gray — clamp to 0 and show red.
    const s = getOilConsumptionStatus(-2, 'Piston', 2);
    expect(s.level).toBe('red');
    expect(s.hours_since_last_add).toBe(0);
  });
});

describe('getOilConsumptionStatus — 2-event floor', () => {
  // With 0 or 1 add events on file, hours-since-last-add isn't a real
  // consumption rate. The helper holds back red/orange and returns gray
  // with a message that distinguishes "haven't logged anything" from
  // "logged one, need another."

  it('returns gray with the no-data message when count is 0', () => {
    const s = getOilConsumptionStatus(null, 'Piston', 0);
    expect(s.level).toBe('gray');
    expect(s.hours_since_last_add).toBeNull();
    expect(s.howard_message).toMatch(/no oil additions/i);
  });

  it('returns gray with the "only one add" message when count is 1', () => {
    // Hours value would normally trip red (< 5 for piston) — but we
    // don't have a baseline yet, so we hold back the warning.
    const s = getOilConsumptionStatus(3, 'Piston', 1);
    expect(s.level).toBe('gray');
    expect(s.hours_since_last_add).toBe(3);
    expect(s.add_event_count).toBe(1);
    expect(s.ui_warning).toBeNull();
    expect(s.howard_message).toMatch(/only one oil add/i);
    expect(s.howard_message).toMatch(/3\.0 hrs/);
  });

  it('returns gray for count=1 even when hours would be green', () => {
    // We're not just suppressing red/orange — we're saying "no verdict
    // either way" until there are 2 events. A single add at 50 hrs ago
    // doesn't prove healthy consumption either.
    const s = getOilConsumptionStatus(50, 'Piston', 1);
    expect(s.level).toBe('gray');
    expect(s.add_event_count).toBe(1);
  });

  it('crosses into the threshold logic at exactly count=2', () => {
    expect(getOilConsumptionStatus(3, 'Piston', 2).level).toBe('red');
    expect(getOilConsumptionStatus(3, 'Piston', 1).level).toBe('gray');
  });

  it('defaults addEventCount to 0 when omitted (gray)', () => {
    // Belt-and-suspenders: a caller that forgets to pass the count
    // shouldn't accidentally trip red/orange. Default is fail-quiet.
    const s = getOilConsumptionStatus(3, 'Piston');
    expect(s.level).toBe('gray');
  });

  it('floors negative or fractional counts at 0', () => {
    expect(getOilConsumptionStatus(3, 'Piston', -1).level).toBe('gray');
    expect(getOilConsumptionStatus(3, 'Piston', 1.7).level).toBe('gray');
    expect(getOilConsumptionStatus(3, 'Piston', 1.7).add_event_count).toBe(1);
  });
});

describe('getOilConsumptionStatus — Turbine', () => {
  const turb = OIL_THRESHOLDS.Turbine;

  it('returns gray for null hours regardless of engine type', () => {
    const s = getOilConsumptionStatus(null, 'Turbine', 0);
    expect(s.level).toBe('gray');
    expect(s.engine_type).toBe('Turbine');
  });

  it('uses the turbine red band — flags red below 15 hrs (where piston would be green)', () => {
    const s = getOilConsumptionStatus(12, 'Turbine', 2);
    expect(s.level).toBe('red');
    expect(s.howard_message).toMatch(/turbine/i);
    expect(s.howard_message).toMatch(/seal-or-scavenge/i);

    // Same hour count under piston band would be green — sanity-check
    // that the engine-type split is actually doing work.
    expect(getOilConsumptionStatus(12, 'Piston', 2).level).toBe('green');
  });

  it('uses the turbine orange band — flags 15–30 hrs as elevated', () => {
    const s = getOilConsumptionStatus(20, 'Turbine', 2);
    expect(s.level).toBe('orange');
    expect(s.howard_message).toMatch(/turbine/i);
    expect(s.howard_message).toMatch(/high side/i);
  });

  it('returns green at 30+ hrs for turbines', () => {
    const s = getOilConsumptionStatus(45, 'Turbine', 2);
    expect(s.level).toBe('green');
    expect(s.howard_message).toMatch(/normal turbine range/i);
  });

  it('treats the red/orange boundary as orange (turbine: 15)', () => {
    expect(getOilConsumptionStatus(turb.redHrs, 'Turbine', 2).level).toBe('orange');
    expect(getOilConsumptionStatus(turb.redHrs - 0.01, 'Turbine', 2).level).toBe('red');
  });

  it('treats the orange/green boundary as green (turbine: 30)', () => {
    expect(getOilConsumptionStatus(turb.orangeHrs, 'Turbine', 2).level).toBe('green');
    expect(getOilConsumptionStatus(turb.orangeHrs - 0.01, 'Turbine', 2).level).toBe('orange');
  });

  it('keeps turbine threshold floors strictly higher than piston', () => {
    expect(turb.redHrs).toBeGreaterThan(OIL_THRESHOLDS.Piston.redHrs);
    expect(turb.orangeHrs).toBeGreaterThan(OIL_THRESHOLDS.Piston.orangeHrs);
    expect(turb.visualCapHrs).toBeGreaterThan(OIL_THRESHOLDS.Piston.visualCapHrs);
  });

  it('also holds back turbine warnings until count >= 2', () => {
    const s = getOilConsumptionStatus(12, 'Turbine', 1);
    expect(s.level).toBe('gray');
    expect(s.howard_message).toMatch(/only one oil add/i);
  });
});

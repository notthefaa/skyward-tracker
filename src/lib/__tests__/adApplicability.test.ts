import { describe, it, expect } from 'vitest';
import { computeVerdict, serialNumericCore, rangeIncludes, type ParsedApplicability } from '../adApplicability';

const empty: ParsedApplicability = {
  serial_ranges: [],
  specific_serials: [],
  engine_references: [],
  prop_references: [],
  notes: '',
};

describe('serialNumericCore', () => {
  it('extracts digits from a letter-prefixed serial', () => {
    expect(serialNumericCore('BB-1234')).toBe(1234);
    expect(serialNumericCore('17280123')).toBe(17280123);
  });
  it('returns null for non-numeric serials', () => {
    expect(serialNumericCore('AB')).toBe(null);
    expect(serialNumericCore('')).toBe(null);
  });
});

describe('rangeIncludes', () => {
  it('handles closed ranges', () => {
    expect(rangeIncludes({ start: 100, end: 200 }, 150)).toBe(true);
    expect(rangeIncludes({ start: 100, end: 200 }, 100)).toBe(true);
    expect(rangeIncludes({ start: 100, end: 200 }, 200)).toBe(true);
    expect(rangeIncludes({ start: 100, end: 200 }, 99)).toBe(false);
  });
  it('handles open-end "X and subsequent" ranges', () => {
    expect(rangeIncludes({ openEnd: true, start: 100 }, 9999)).toBe(true);
    expect(rangeIncludes({ openEnd: true, start: 100 }, 50)).toBe(false);
  });
  it('handles open-start "prior to X" ranges', () => {
    expect(rangeIncludes({ openStart: true, end: 100 }, 50)).toBe(true);
    expect(rangeIncludes({ openStart: true, end: 100 }, 200)).toBe(false);
  });
});

describe('computeVerdict — engine/prop matching (regression for the operator-precedence + empty-make traps)', () => {
  it('matches an engine when the AD reference is a substring of make+model', () => {
    const v = computeVerdict(
      { ...empty, engine_references: ['lycoming io-390'] },
      { serial_number: '17280123' },
      [{ category: 'engine', make: 'Lycoming', model: 'IO-390' }],
    );
    expect(v.status).toBe('applies');
  });

  it('does NOT cross-match: an engine_reference must hit an engine row, not a propeller', () => {
    // Pre-fix the engine arm parsed as `(A && B) || C`, so any
    // equipment row whose make appeared in the AD's engine_references
    // matched even when the row's category wasn't 'engine'. A prop
    // labeled "Lycoming" would have falsely satisfied an engine AD.
    const v = computeVerdict(
      { ...empty, engine_references: ['lycoming io-390'] },
      { serial_number: '17280123' },
      [{ category: 'propeller', make: 'Lycoming', model: 'unrelated' }],
    );
    expect(v.status).not.toBe('applies');
  });

  it('does NOT match every engine reference when an equipment row has a blank make (empty-string-includes trap)', () => {
    // `''.includes(anything)` and `anything.includes('')` are both
    // true — pre-fix, an equipment row with no make would falsely
    // satisfy every engine_reference in every AD.
    const v = computeVerdict(
      { ...empty, engine_references: ['continental io-550'] },
      { serial_number: '17280123' },
      [{ category: 'engine', make: '', model: '' }],
    );
    expect(v.status).not.toBe('applies');
  });

  it('matches a propeller when the AD reference hits the prop row', () => {
    const v = computeVerdict(
      { ...empty, prop_references: ['hartzell hc-c2yk'] },
      { serial_number: '17280123' },
      [{ category: 'propeller', make: 'Hartzell', model: 'HC-C2YK-1BF' }],
    );
    expect(v.status).toBe('applies');
  });

  it('reverse-match: AD reference that includes the equipment make also applies', () => {
    // Some ADs say "Continental" with no further model qualification
    // — the original logic intentionally allows that to match a
    // Continental-make engine row regardless of model.
    const v = computeVerdict(
      { ...empty, engine_references: ['continental motors'] },
      { serial_number: '17280123' },
      [{ category: 'engine', make: 'Continental', model: 'O-470' }],
    );
    expect(v.status).toBe('applies');
  });
});

describe('computeVerdict — serial path', () => {
  it('flags review_required when no serial is on file', () => {
    const v = computeVerdict(
      { ...empty, serial_ranges: [{ start: 1, end: 100 }] },
      { serial_number: null },
      [],
    );
    expect(v.status).toBe('review_required');
  });

  it('flags applies when serial is in a cited range', () => {
    const v = computeVerdict(
      { ...empty, serial_ranges: [{ start: 17280000, end: 17290000 }] },
      { serial_number: '17280123' },
      [],
    );
    expect(v.status).toBe('applies');
  });

  it('flags does_not_apply when serial falls outside every cited range', () => {
    const v = computeVerdict(
      { ...empty, serial_ranges: [{ start: 1, end: 100 }, { start: 200, end: 300 }] },
      { serial_number: '17280123' },
      [],
    );
    expect(v.status).toBe('does_not_apply');
  });

  it('flags applies when serial is in specific_serials list', () => {
    const v = computeVerdict(
      { ...empty, specific_serials: [17280123] },
      { serial_number: '17280123' },
      [],
    );
    expect(v.status).toBe('applies');
  });
});

describe('computeVerdict — fallthrough', () => {
  it('falls back to review_required with the parsed notes', () => {
    const v = computeVerdict(
      { ...empty, notes: 'Applies only to aircraft with autopilot X.' },
      { serial_number: '17280123' },
      [],
    );
    expect(v.status).toBe('review_required');
    expect(v.reason).toContain('autopilot');
  });
});

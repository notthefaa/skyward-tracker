import { describe, it, expect } from 'vitest';
import {
  validateFlightLogInput,
  validateVorCheckInput,
  validateOilLogInput,
  validateTireCheckInput,
  validateSquawkInput,
} from '../submissions';
import { CodedError } from '../apiResponse';

// =============================================================
// These cover the companion-app queue contract: any payload the
// offline queue can reasonably emit must be accepted or rejected
// with a stable code. The big thing we're guarding is that
// `occurred_at` is validated at the boundary — a malformed ISO
// string from an old phone must not sail into a timestamptz
// column and skew compliance math.
// =============================================================

describe('validateFlightLogInput', () => {
  it('accepts a valid payload without occurred_at', () => {
    const input = validateFlightLogInput({
      pod: 'KSQL', poa: 'KPAO',
      initials: 'AG',
      aftt: 1234.5, ftt: 1200.2, hobbs: 1234.5, tach: 900.0,
      landings: 3, engine_cycles: 1,
      fuel_gallons: 40,
    });
    expect(input.pod).toBe('KSQL');
    expect(input.occurred_at).toBeUndefined();
  });

  it('accepts a valid ISO datetime with Z', () => {
    const input = validateFlightLogInput({
      initials: 'AG', aftt: 1234.5, occurred_at: '2026-04-24T14:30:00Z',
    });
    expect(input.occurred_at).toBe('2026-04-24T14:30:00Z');
  });

  it('rejects occurred_at without a timezone suffix', () => {
    expect(() => validateFlightLogInput({
      initials: 'AG', occurred_at: '2026-04-24T14:30:00',
    })).toThrow(CodedError);
  });

  it('rejects occurred_at that is not a string', () => {
    expect(() => validateFlightLogInput({
      initials: 'AG', occurred_at: 1714000000,
    })).toThrow(CodedError);
  });

  it('rejects occurred_at in the future (beyond clock-skew buffer)', () => {
    const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    expect(() => validateFlightLogInput({
      initials: 'AG', occurred_at: farFuture,
    })).toThrow(/future/);
  });

  it('allows occurred_at within the 5-minute clock-skew buffer', () => {
    const nearFuture = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const input = validateFlightLogInput({
      initials: 'AG', aftt: 1234.5, occurred_at: nearFuture,
    });
    expect(input.occurred_at).toBe(nearFuture);
  });

  it('rejects Infinity in aftt (defense against malformed queue payloads)', () => {
    expect(() => validateFlightLogInput({
      initials: 'AG', aftt: 'Infinity',
    })).toThrow(/finite/);
  });

  it('rejects negative numeric fields', () => {
    expect(() => validateFlightLogInput({
      initials: 'AG', aftt: -5,
    })).toThrow(/non-negative/);
  });
});

describe('validateVorCheckInput', () => {
  it('uppercases initials and echoes occurred_at', () => {
    const input = validateVorCheckInput({
      check_type: 'VOT',
      station: 'KSQL',
      bearing_error: 2,
      initials: 'ag',
      occurred_at: '2026-04-24T14:30:00Z',
    });
    expect(input.initials).toBe('AG');
    expect(input.occurred_at).toBe('2026-04-24T14:30:00Z');
  });

  it('rejects an unknown check_type', () => {
    expect(() => validateVorCheckInput({
      check_type: 'BOGUS', station: 'KSQL', bearing_error: 2, initials: 'AG',
    })).toThrow(/Invalid check type/);
  });

  it('rejects a non-finite bearing_error', () => {
    expect(() => validateVorCheckInput({
      check_type: 'VOT', station: 'KSQL', bearing_error: 'Infinity', initials: 'AG',
    })).toThrow(/finite/);
  });
});

describe('validateOilLogInput', () => {
  it('accepts oil_added as null (level check)', () => {
    const input = validateOilLogInput({
      oil_qty: 5.5, oil_added: null, engine_hours: 1234.5, initials: 'AG', notes: null,
    });
    expect(input.oil_added).toBeNull();
  });

  it('rejects oil_qty < 0', () => {
    expect(() => validateOilLogInput({
      oil_qty: -1, engine_hours: 0, initials: 'AG',
    })).toThrow(CodedError);
  });

  it('normalizes empty notes to null', () => {
    const input = validateOilLogInput({
      oil_qty: 5, engine_hours: 10, initials: 'AG', notes: '   ',
    });
    expect(input.notes).toBeNull();
  });
});

describe('validateTireCheckInput', () => {
  it('accepts all-null "all tires OK" entry', () => {
    const input = validateTireCheckInput({
      nose_psi: null, left_main_psi: null, right_main_psi: null, initials: 'AG',
    });
    expect(input.nose_psi).toBeNull();
    expect(input.left_main_psi).toBeNull();
    expect(input.right_main_psi).toBeNull();
  });

  it('rejects a negative PSI', () => {
    expect(() => validateTireCheckInput({
      nose_psi: -1, left_main_psi: null, right_main_psi: null, initials: 'AG',
    })).toThrow(CodedError);
  });

  it('rejects NaN / Infinity on any slot', () => {
    expect(() => validateTireCheckInput({
      nose_psi: 'Infinity', initials: 'AG',
    })).toThrow(/finite/);
  });
});

describe('validateSquawkInput', () => {
  it('passes through arbitrary squawk fields (stripProtectedFields runs later)', () => {
    const input = validateSquawkInput({
      description: 'Left tire low',
      affects_airworthiness: false,
      location: 'KSQL',
      reporter_initials: 'AG',
    });
    expect(input.description).toBe('Left tire low');
    expect(input.reporter_initials).toBe('AG');
  });

  it('validates occurred_at when supplied', () => {
    expect(() => validateSquawkInput({
      description: 'x', occurred_at: 'not-a-date',
    })).toThrow(CodedError);
  });
});

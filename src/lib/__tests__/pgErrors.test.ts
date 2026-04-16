import { describe, it, expect } from 'vitest';
import { friendlyPgError } from '../pgErrors';

describe('friendlyPgError', () => {
  it('unpacks the column name from a unique-violation details field', () => {
    expect(friendlyPgError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "aft_aircraft_tail_number_key"',
      details: 'Key (tail_number)=(N205WH) already exists.',
    })).toBe('Already in use: tail number. Pick a different value.');
  });

  it('returns a generic unique-violation message when details are absent', () => {
    expect(friendlyPgError({ code: '23505', message: 'dup' })).toMatch(/already in use/i);
  });

  it('maps foreign-key violation to a refresh suggestion', () => {
    expect(friendlyPgError({ code: '23503' })).toMatch(/doesn't exist or was removed/i);
  });

  it('maps not-null with column to a missing-field message', () => {
    expect(friendlyPgError({
      code: '23502',
      message: 'null value in column "tail_number" violates not-null constraint',
    })).toBe('Missing required field: tail number.');
  });

  it('maps check-violation to an allowed-range message', () => {
    expect(friendlyPgError({ code: '23514' })).toMatch(/out of the allowed range/i);
  });

  it('maps string-too-long to a length message', () => {
    expect(friendlyPgError({ code: '22001' })).toMatch(/too long/i);
  });

  it('surfaces a RAISE EXCEPTION message unchanged (P0001)', () => {
    expect(friendlyPgError({ code: 'P0001', message: 'Flight log out of order: tach cannot decrease.' }))
      .toBe('Flight log out of order: tach cannot decrease.');
  });

  it('falls back to the raw message for unknown codes', () => {
    expect(friendlyPgError({ code: 'XX999', message: 'some weird error' })).toBe('some weird error');
  });

  it('uses the supplied fallback when there is no message at all', () => {
    expect(friendlyPgError(null, 'Network error')).toBe('Network error');
  });
});

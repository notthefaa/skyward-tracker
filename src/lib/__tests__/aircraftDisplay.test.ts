import { describe, it, expect } from 'vitest';
import { formatAircraftType } from '../aircraftDisplay';

describe('formatAircraftType', () => {
  it('combines make and aircraft_type for the modern shape', () => {
    expect(formatAircraftType({ make: 'Cessna', aircraft_type: '172N' })).toBe('Cessna 172N');
  });

  it('prefers model when present over aircraft_type', () => {
    // Edge case: row was migrated and both columns are set. Model is
    // the source of truth post-aircraft_type=model alignment.
    expect(formatAircraftType({ make: 'Cirrus', model: 'SR22', aircraft_type: 'SR22 G6' }))
      .toBe('Cirrus SR22');
  });

  it('falls back to aircraft_type when model column is null', () => {
    // Form-onboarded rows write only aircraft_type, leaving model null.
    expect(formatAircraftType({ make: 'Piper', aircraft_type: 'PA-28-181' }))
      .toBe('Piper PA-28-181');
  });

  it('does not double-prefix when aircraft_type already contains the make', () => {
    // Legacy rows from before the make column split stored
    // aircraft_type = "Cessna 172N". Don't render "Cessna Cessna 172N".
    expect(formatAircraftType({ make: 'Cessna', aircraft_type: 'Cessna 172N' }))
      .toBe('Cessna 172N');
  });

  it('handles make-only rows (no model on file)', () => {
    expect(formatAircraftType({ make: 'Cessna' })).toBe('Cessna');
  });

  it('handles model-only rows (no make on file)', () => {
    expect(formatAircraftType({ aircraft_type: '172N' })).toBe('172N');
  });

  it('handles legacy aircraft_type without make column', () => {
    expect(formatAircraftType({ aircraft_type: 'Cessna 172N' })).toBe('Cessna 172N');
  });

  it('trims whitespace around inputs', () => {
    expect(formatAircraftType({ make: ' Cessna ', aircraft_type: ' 172N ' }))
      .toBe('Cessna 172N');
  });

  it('returns empty string for null / undefined input', () => {
    expect(formatAircraftType(null)).toBe('');
    expect(formatAircraftType(undefined)).toBe('');
    expect(formatAircraftType({})).toBe('');
  });

  it('case-insensitive prefix detection', () => {
    // "CESSNA" make + "cessna 172N" aircraft_type should still skip
    // double-prefix (different casing but same identifier).
    expect(formatAircraftType({ make: 'CESSNA', aircraft_type: 'cessna 172N' }))
      .toBe('cessna 172N');
  });
});

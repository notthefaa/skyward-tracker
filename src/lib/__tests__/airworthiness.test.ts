import { describe, it, expect } from 'vitest';
import { computeAirworthinessStatus } from '../airworthiness';
import type { AircraftEquipment } from '../types';

// Minimal aircraft record matching the Pick<> shape the function needs.
const aircraft = (overrides: Partial<any> = {}) => ({
  id: 'ac-1',
  tail_number: 'N123AB',
  total_engine_time: 1000,
  is_ifr_equipped: false,
  is_for_hire: false,
  ...overrides,
});

// Today-relative yyyy-mm-dd helpers. Using ISO slicing keeps the tests
// timezone-agnostic — the function itself parses against local midnight.
const daysFromNow = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const baseEquipment: Partial<AircraftEquipment> = {
  id: '',
  aircraft_id: 'ac-1',
  name: '',
  ifr_capable: false,
  adsb_out: false,
  adsb_in: false,
  is_elt: false,
};

describe('computeAirworthinessStatus', () => {
  it('returns airworthy when equipment is not tracked and nothing else is wrong', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft(),
      equipment: [],
      mxItems: [],
      squawks: [],
    });
    expect(v.status).toBe('airworthy');
    expect(v.findings).toHaveLength(0);
  });

  it('warns on missing ELT when equipment is otherwise tracked', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft(),
      equipment: [{ ...baseEquipment, id: 'eq-1', category: 'transponder', name: 'XPDR' } as AircraftEquipment],
      mxItems: [],
      squawks: [],
    });
    expect(v.status).toBe('issues');
    expect(v.citation).toBe('91.207');
  });

  it('grounds on expired ELT battery (91.207(d))', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft(),
      equipment: [{
        ...baseEquipment,
        id: 'eq-elt', category: 'elt', name: 'ELT', is_elt: true,
        elt_battery_expires: daysFromNow(-5),
      } as AircraftEquipment],
      mxItems: [],
      squawks: [],
    });
    expect(v.status).toBe('grounded');
    expect(v.citation).toBe('91.207(d)');
  });

  it('grounds on ELT cumulative emergency-use ≥1hr (91.207(a)(1))', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft(),
      equipment: [{
        ...baseEquipment,
        id: 'eq-elt', category: 'elt', name: 'ELT', is_elt: true,
        elt_battery_cumulative_hours: 1.2,
      } as AircraftEquipment],
      mxItems: [],
      squawks: [],
    });
    expect(v.status).toBe('grounded');
    expect(v.citation).toBe('91.207(a)(1)');
  });

  it('grounds on expired transponder 24-month check (91.413)', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft(),
      equipment: [
        { ...baseEquipment, id: 'eq-elt', category: 'elt', name: 'ELT', is_elt: true } as AircraftEquipment,
        { ...baseEquipment, id: 'eq-xp', category: 'transponder', name: 'XPDR', transponder_due_date: daysFromNow(-1) } as AircraftEquipment,
      ],
      mxItems: [],
      squawks: [],
    });
    expect(v.status).toBe('grounded');
    expect(v.citation).toBe('91.413');
  });

  it('does not apply 91.411 to VFR-only aircraft even with expired altimeter', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft({ is_ifr_equipped: false }),
      equipment: [
        { ...baseEquipment, id: 'eq-elt', category: 'elt', name: 'ELT', is_elt: true } as AircraftEquipment,
        { ...baseEquipment, id: 'eq-alt', category: 'altimeter', name: 'Altimeter', altimeter_due_date: daysFromNow(-30) } as AircraftEquipment,
      ],
      mxItems: [],
      squawks: [],
    });
    expect(v.status).toBe('airworthy');
  });

  it('grounds on expired altimeter for IFR-equipped aircraft (91.411)', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft({ is_ifr_equipped: true }),
      equipment: [
        { ...baseEquipment, id: 'eq-elt', category: 'elt', name: 'ELT', is_elt: true } as AircraftEquipment,
        { ...baseEquipment, id: 'eq-alt', category: 'altimeter', name: 'Altimeter', altimeter_due_date: daysFromNow(-30) } as AircraftEquipment,
      ],
      mxItems: [],
      squawks: [],
    });
    expect(v.status).toBe('grounded');
    expect(v.citation).toBe('91.411');
  });

  it('issues a warning on expired VOR for IFR aircraft (91.171)', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft({ is_ifr_equipped: true }),
      equipment: [
        { ...baseEquipment, id: 'eq-elt', category: 'elt', name: 'ELT', is_elt: true } as AircraftEquipment,
        { ...baseEquipment, id: 'eq-nav', category: 'instrument', name: 'NAV', vor_due_date: daysFromNow(-2) } as AircraftEquipment,
      ],
      mxItems: [],
      squawks: [],
    });
    expect(v.status).toBe('issues');
    expect(v.citation).toBe('91.171');
  });

  it('grounds on an open AOG squawk', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft(),
      equipment: [],
      mxItems: [],
      squawks: [{ affects_airworthiness: true, location: 'left tire', status: 'open' }],
    });
    expect(v.status).toBe('grounded');
    expect(v.reason).toContain('left tire');
  });

  it('ignores a resolved AOG squawk', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft(),
      equipment: [],
      mxItems: [],
      squawks: [{ affects_airworthiness: true, location: 'left tire', status: 'resolved' }],
    });
    expect(v.status).toBe('airworthy');
  });

  it('grounds on an expired required MX item (91.417)', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft({ total_engine_time: 2500 }),
      equipment: [],
      mxItems: [{
        item_name: 'Annual Inspection',
        is_required: true,
        tracking_type: 'date',
        due_date: daysFromNow(-10),
      }],
      squawks: [],
    });
    expect(v.status).toBe('grounded');
    expect(v.citation).toBe('91.417');
  });

  it('ignores an expired non-required MX item', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft(),
      equipment: [],
      mxItems: [{
        item_name: 'Oil change reminder',
        is_required: false,
        tracking_type: 'date',
        due_date: daysFromNow(-10),
      }],
      squawks: [],
    });
    expect(v.status).toBe('airworthy');
  });

  it('grounds on an out-of-compliance AD', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft({ total_engine_time: 3000 }),
      equipment: [],
      mxItems: [],
      squawks: [],
      ads: [{
        id: 'ad-1',
        aircraft_id: 'ac-1',
        ad_number: '2023-12-05',
        affects_airworthiness: true,
        is_superseded: false,
        deleted_at: null,
        next_due_time: 2500,
        next_due_date: null,
      } as any],
    });
    expect(v.status).toBe('grounded');
    expect(v.citation).toBe('91.417(b)');
  });

  it('ignores a superseded AD', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft({ total_engine_time: 3000 }),
      equipment: [],
      mxItems: [],
      squawks: [],
      ads: [{
        id: 'ad-1',
        aircraft_id: 'ac-1',
        ad_number: '2018-09-02',
        affects_airworthiness: true,
        is_superseded: true,
        deleted_at: null,
        next_due_time: 2500,
      } as any],
    });
    expect(v.status).toBe('airworthy');
  });

  it('ignores an AD that does not affect airworthiness', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft({ total_engine_time: 3000 }),
      equipment: [],
      mxItems: [],
      squawks: [],
      ads: [{
        id: 'ad-1',
        aircraft_id: 'ac-1',
        ad_number: 'non-safety',
        affects_airworthiness: false,
        is_superseded: false,
        deleted_at: null,
        next_due_time: 2500,
      } as any],
    });
    expect(v.status).toBe('airworthy');
  });

  it('picks the grounded finding even when warnings are also present', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft({ is_ifr_equipped: true }),
      equipment: [
        { ...baseEquipment, id: 'eq-elt', category: 'elt', name: 'ELT', is_elt: true, elt_battery_expires: daysFromNow(-1) } as AircraftEquipment,
        { ...baseEquipment, id: 'eq-vor', category: 'instrument', name: 'NAV', vor_due_date: daysFromNow(-1) } as AircraftEquipment,
      ],
      mxItems: [],
      squawks: [],
    });
    expect(v.status).toBe('grounded');
    expect(v.findings.some(f => f.severity === 'grounded')).toBe(true);
    expect(v.findings.some(f => f.severity === 'warning')).toBe(true);
  });

  it('excludes removed equipment from checks', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft(),
      equipment: [{
        ...baseEquipment,
        id: 'eq-elt', category: 'elt', name: 'ELT', is_elt: true,
        elt_battery_expires: daysFromNow(-100),
        removed_at: daysFromNow(-1),
      } as AircraftEquipment],
      mxItems: [],
      squawks: [],
    });
    // The only ELT is removed, so active equipment is empty → treated
    // as "tracking not set up" → airworthy, not grounded.
    expect(v.status).toBe('airworthy');
  });
});

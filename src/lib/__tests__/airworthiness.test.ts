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
        // Include a transponder so the missing-transponder warning
        // doesn't fire and bump status to 'issues' for unrelated
        // reasons. We're testing 91.411 gating on `is_ifr_equipped`.
        { ...baseEquipment, id: 'eq-elt', category: 'elt', name: 'ELT', is_elt: true } as AircraftEquipment,
        { ...baseEquipment, id: 'eq-xp', category: 'transponder', name: 'XPDR' } as AircraftEquipment,
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
        { ...baseEquipment, id: 'eq-xp', category: 'transponder', name: 'XPDR' } as AircraftEquipment,
        { ...baseEquipment, id: 'eq-alt', category: 'altimeter', name: 'Altimeter', altimeter_due_date: daysFromNow(-30) } as AircraftEquipment,
        { ...baseEquipment, id: 'eq-pitot', category: 'pitot_static', name: 'Pitot' } as AircraftEquipment,
      ],
      mxItems: [],
      squawks: [],
    });
    expect(v.status).toBe('grounded');
    expect(v.citation).toBe('91.411');
  });

  // Pre-fix the airworthiness gate quietly passed a tracked aircraft
  // that was missing a transponder row entirely — but 91.215 requires
  // a transponder for most controlled-airspace ops. Now warn (not
  // ground — we can't know exemptions from app state alone).
  it('warns when equipment is tracked but no transponder is logged (91.215)', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft({ is_ifr_equipped: false }),
      equipment: [
        { ...baseEquipment, id: 'eq-elt', category: 'elt', name: 'ELT', is_elt: true } as AircraftEquipment,
      ],
      mxItems: [],
      squawks: [],
    });
    expect(v.status).toBe('issues');
    expect(v.findings.some(f => f.citation === '91.215' && f.severity === 'warning')).toBe(true);
  });

  it('warns when IFR-equipped but altimeter or pitot-static is missing (91.411)', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft({ is_ifr_equipped: true }),
      equipment: [
        { ...baseEquipment, id: 'eq-elt', category: 'elt', name: 'ELT', is_elt: true } as AircraftEquipment,
        { ...baseEquipment, id: 'eq-xp', category: 'transponder', name: 'XPDR' } as AircraftEquipment,
        // Altimeter + pitot intentionally omitted.
      ],
      mxItems: [],
      squawks: [],
    });
    expect(v.status).toBe('issues');
    const altWarn = v.findings.find(f => f.citation === '91.411' && f.message.toLowerCase().includes('altimeter'));
    const pitotWarn = v.findings.find(f => f.citation === '91.411' && f.message.toLowerCase().includes('pitot'));
    expect(altWarn).toBeTruthy();
    expect(pitotWarn).toBeTruthy();
  });

  it('does NOT warn for missing categories when equipment list is entirely empty', () => {
    // An operator with no tracked equipment shouldn't get a flood of
    // warnings — they probably manage compliance outside the app, and
    // the targeted gap warnings only make sense when we have evidence
    // the operator IS tracking but missed something.
    const v = computeAirworthinessStatus({
      aircraft: aircraft({ is_ifr_equipped: true }),
      equipment: [],
      mxItems: [],
      squawks: [],
    });
    expect(v.status).toBe('airworthy');
    expect(v.findings.length).toBe(0);
  });

  it('issues a warning on expired VOR for IFR aircraft (91.171)', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft({ is_ifr_equipped: true }),
      equipment: [
        { ...baseEquipment, id: 'eq-elt', category: 'elt', name: 'ELT', is_elt: true } as AircraftEquipment,
        { ...baseEquipment, id: 'eq-xp', category: 'transponder', name: 'XPDR' } as AircraftEquipment,
        { ...baseEquipment, id: 'eq-alt', category: 'altimeter', name: 'Altimeter' } as AircraftEquipment,
        { ...baseEquipment, id: 'eq-pitot', category: 'pitot_static', name: 'Pitot' } as AircraftEquipment,
        { ...baseEquipment, id: 'eq-nav', category: 'instrument', name: 'NAV', vor_due_date: daysFromNow(-2) } as AircraftEquipment,
      ],
      mxItems: [],
      squawks: [],
    });
    expect(v.status).toBe('issues');
    // The VOR warning must be among findings; status verdict picks
    // the *first* warning's citation, which can be any of the
    // simultaneous IFR warnings — assert the substantive finding
    // rather than the surface citation field.
    expect(v.findings.some(f => f.citation === '91.171')).toBe(true);
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
    // 91.403(a) is the operator-responsibility prohibition; 91.417 is
    // the recordkeeping rule, which was the previous (incorrect)
    // citation.
    expect(v.citation).toBe('91.403');
  });

  it('skips an AD flagged does_not_apply', () => {
    const v = computeAirworthinessStatus({
      aircraft: aircraft({ total_engine_time: 3000 }),
      equipment: [],
      mxItems: [],
      squawks: [],
      ads: [{
        id: 'ad-doesnt',
        aircraft_id: 'ac-1',
        ad_number: '2024-99-01',
        affects_airworthiness: true,
        is_superseded: false,
        deleted_at: null,
        // Past-due numbers that *would* ground if applicability were ignored.
        next_due_time: 100,
        next_due_date: '2020-01-01',
        applicability_status: 'does_not_apply',
      } as any],
    });
    expect(v.status).toBe('airworthy');
  });

  it('grounds on an applicable AD with no compliance logged', () => {
    // applicability_status='applies' but neither next_due_date nor
    // next_due_time set means the operator has never logged compliance
    // — that's a 91.403 violation as soon as the AD is matched, not a
    // warning. The previous code passed this case as airworthy because
    // both date and time predicates returned false.
    const v = computeAirworthinessStatus({
      aircraft: aircraft({ total_engine_time: 3000 }),
      equipment: [],
      mxItems: [],
      squawks: [],
      ads: [{
        id: 'ad-no-compl',
        aircraft_id: 'ac-1',
        ad_number: '2025-04-12',
        affects_airworthiness: true,
        is_superseded: false,
        deleted_at: null,
        next_due_time: null,
        next_due_date: null,
        applicability_status: 'applies',
      } as any],
    });
    expect(v.status).toBe('grounded');
    expect(v.findings.some(f => f.message.includes('no compliance logged'))).toBe(true);
  });

  it('legacy AD with no applicability_status keeps the date/time-only behavior', () => {
    // Pre-applicability rows (applicability_status === null) should
    // not be downgraded by the new compliance-logged check.
    const v = computeAirworthinessStatus({
      aircraft: aircraft({ total_engine_time: 3000 }),
      equipment: [],
      mxItems: [],
      squawks: [],
      ads: [{
        id: 'ad-legacy',
        aircraft_id: 'ac-1',
        ad_number: '2010-01-01',
        affects_airworthiness: true,
        is_superseded: false,
        deleted_at: null,
        next_due_time: null,
        next_due_date: null,
        applicability_status: null,
      } as any],
    });
    expect(v.status).toBe('airworthy');
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

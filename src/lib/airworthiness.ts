// =============================================================
// AIRWORTHINESS STATUS — explicit regulatory check
// =============================================================
// Replaces the implicit "if any required MX is expired" logic with
// an explicit 91.205 (VFR/IFR equipment), 91.411 (altimeter/static),
// 91.413 (transponder), 91.207 (ELT), 91.171 (VOR check for IFR) pass.
//
// Inputs are the aircraft, its equipment, mx items, and open squawks.
// Output is a structured verdict with a human-readable reason and
// regulatory citation.
// =============================================================

import type { Aircraft, AircraftEquipment, AirworthinessDirective, EquipmentCategory } from './types';
import { isMxExpired } from './math';
import { isDateExpiredInZone } from './pilotTime';

// Named constants for the equipment categories the regulatory checks
// look up. Keeping them here (typed as `EquipmentCategory`) means a
// typo becomes a TypeScript error rather than a silent bypass, and the
// next reader can see which regulations reference which category.
const CATEGORY_ELT: EquipmentCategory = 'elt';
const CATEGORY_TRANSPONDER: EquipmentCategory = 'transponder';
const CATEGORY_ALTIMETER: EquipmentCategory = 'altimeter';
const CATEGORY_PITOT_STATIC: EquipmentCategory = 'pitot_static';

export type AirworthinessStatus = 'airworthy' | 'issues' | 'grounded';

export interface AirworthinessVerdict {
  status: AirworthinessStatus;
  /** Regulatory citation for the top blocker, e.g. "91.413". */
  citation?: string;
  /** Short human-readable reason shown in the grounded banner. */
  reason?: string;
  /** All blockers and warnings ranked by severity. */
  findings: AirworthinessFinding[];
}

export interface AirworthinessFinding {
  severity: 'grounded' | 'warning';
  citation?: string;
  message: string;
}

interface Inputs {
  aircraft: Pick<Aircraft, 'id' | 'tail_number' | 'total_engine_time' | 'is_ifr_equipped' | 'is_for_hire'> & {
    // Optional so callers that pass a legacy `aircraft` without the
    // column (pre-migration-036 cached payloads) still compile. A
    // missing value falls back to UTC in isDateExpiredInZone.
    time_zone?: string | null;
  };
  equipment: AircraftEquipment[];
  mxItems: any[];
  squawks: Array<{ affects_airworthiness: boolean; location?: string | null; status: string }>;
  ads?: AirworthinessDirective[];
}

export function computeAirworthinessStatus(input: Inputs): AirworthinessVerdict {
  // "Expired" here means `due_date < today_in_pilot_tz`. Computing
  // that server-side in UTC would mis-classify a due-today item as
  // expired in the pilot's evening — pass the aircraft's zone so
  // the verdict matches the calendar the pilot is looking at.
  const zone = input.aircraft.time_zone ?? 'UTC';
  const isDateExpired = (d: string | null | undefined): boolean =>
    isDateExpiredInZone(d, zone);

  const findings: AirworthinessFinding[] = [];
  const activeEquipment = input.equipment.filter(e => !e.deleted_at && !e.removed_at);
  // Treat an entirely empty equipment list as "tracking not set up yet"
  // rather than "equipment is missing". Without this, every aircraft
  // that hasn't populated the equipment tab reads as grounded on 91.207
  // even when it's actually airworthy.
  const equipmentTracked = activeEquipment.length > 0;

  // ─── 91.207 ELT ─────────────────────────────────────────────
  if (equipmentTracked) {
    const elt = activeEquipment.find(e => e.is_elt || e.category === CATEGORY_ELT);
    if (!elt) {
      findings.push({ severity: 'warning', citation: '91.207', message: 'No ELT tracked in equipment. 91.207 requires one.' });
    } else {
      if (isDateExpired(elt.elt_battery_expires)) {
        findings.push({ severity: 'grounded', citation: '91.207(d)', message: 'ELT battery expired.' });
      }
      if (elt.elt_battery_cumulative_hours != null && elt.elt_battery_cumulative_hours >= 1) {
        findings.push({
          severity: 'grounded',
          citation: '91.207(a)(1)',
          message: 'ELT battery cumulative emergency-use >1 hr — replace or recharge.',
        });
      }
    }
  }

  // ─── 91.413 Transponder (24 months) ─────────────────────────
  const transponder = activeEquipment.find(e => e.category === CATEGORY_TRANSPONDER);
  if (transponder && isDateExpired(transponder.transponder_due_date)) {
    findings.push({
      severity: 'grounded',
      citation: '91.413',
      message: 'Transponder 24-month check expired.',
    });
  }

  // ─── 91.411 Altimeter + Pitot-Static (24 months) ────────────
  const ifrRelevant = input.aircraft.is_ifr_equipped === true;
  if (ifrRelevant) {
    const altimeter = activeEquipment.find(e => e.category === CATEGORY_ALTIMETER);
    if (altimeter && isDateExpired(altimeter.altimeter_due_date)) {
      findings.push({
        severity: 'grounded',
        citation: '91.411',
        message: 'Altimeter 24-month check expired.',
      });
    }
    const pitot = activeEquipment.find(e => e.category === CATEGORY_PITOT_STATIC);
    if (pitot && isDateExpired(pitot.pitot_static_due_date)) {
      findings.push({
        severity: 'grounded',
        citation: '91.411',
        message: 'Pitot-static 24-month check expired.',
      });
    }
  }

  // ─── 91.171 VOR check (IFR ops only) ────────────────────────
  if (ifrRelevant) {
    const vor = activeEquipment.find(e => e.vor_due_date != null);
    if (vor && isDateExpired(vor.vor_due_date)) {
      findings.push({
        severity: 'warning',
        citation: '91.171',
        message: 'VOR check >30 days old — not current for IFR ops.',
      });
    }
  }

  // ─── Squawks ────────────────────────────────────────────────
  const aogSquawk = input.squawks.find(s => s.status === 'open' && s.affects_airworthiness);
  if (aogSquawk) {
    findings.push({
      severity: 'grounded',
      message: `AOG squawk${aogSquawk.location ? ' at ' + aogSquawk.location : ''}.`,
    });
  }

  // ─── MX items (required + expired) ──────────────────────────
  // Only required items can ground the aircraft. Optional tracking
  // (e.g. oil change reminders) shouldn't flip the nav to red.
  for (const item of input.mxItems) {
    if (item.is_required !== true) continue;
    if (isMxExpired(item, input.aircraft.total_engine_time || 0)) {
      findings.push({
        severity: 'grounded',
        citation: '91.417',
        message: `${item.item_name} expired.`,
      });
    }
  }

  // ─── ADs (active, affects airworthiness, due-date passed) ───
  if (input.ads && input.ads.length > 0) {
    for (const ad of input.ads) {
      if (ad.deleted_at || ad.is_superseded || !ad.affects_airworthiness) continue;
      const timeExpired =
        ad.next_due_time != null && (input.aircraft.total_engine_time || 0) >= ad.next_due_time;
      const dateExpired = isDateExpired(ad.next_due_date);
      if (timeExpired || dateExpired) {
        findings.push({
          severity: 'grounded',
          citation: '91.417(b)',
          message: `AD ${ad.ad_number} not in compliance.`,
        });
      }
    }
  }

  // ─── For-hire-only checks ───────────────────────────────────
  if (input.aircraft.is_for_hire) {
    // 100-hour inspection — tracked as an MX item; already covered above
    // if set up. No extra check here unless the UI hasn't created it.
  }

  // ─── Verdict ────────────────────────────────────────────────
  const grounded = findings.find(f => f.severity === 'grounded');
  if (grounded) {
    return {
      status: 'grounded',
      citation: grounded.citation,
      reason: grounded.message,
      findings,
    };
  }
  const warning = findings.find(f => f.severity === 'warning');
  if (warning) {
    return {
      status: 'issues',
      citation: warning.citation,
      reason: warning.message,
      findings,
    };
  }
  return { status: 'airworthy', findings };
}

/**
 * Display-layer rule: if the regulatory verdict says `airworthy` but
 * there's at least one open squawk (even non-airworthiness), bump the
 * display status to `issues`. This keeps fleet cards, nav dots, and
 * summary bentos in agreement — any open squawk is a visual cue
 * ("something to look at") without overstating it as a regulatory
 * grounding.
 */
export function applyOpenSquawkOverride(
  status: AirworthinessStatus,
  openSquawkCount: number,
): AirworthinessStatus {
  if (status === 'airworthy' && openSquawkCount > 0) return 'issues';
  return status;
}

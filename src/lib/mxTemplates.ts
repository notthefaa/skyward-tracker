// =============================================================
// MAINTENANCE TEMPLATE LIBRARY
//
// Static templates for common aircraft types. Each template
// contains a list of manufacturer-required and recommended
// maintenance items with default tracking types and intervals.
//
// Items are inserted with null due values — the user must
// configure last-completed data from their logbook before
// the item becomes active and starts counting down.
//
// NOTE: These are general recommendations based on published
// manufacturer maintenance manuals and FAA requirements.
// Owners should always verify against their specific aircraft's
// maintenance manual, type certificate data sheet, and
// applicable ADs. Intervals may vary by serial number,
// engine model, and installed equipment.
//
// SOURCES:
// - FAR 91.207 (ELT), 91.409 (Annual/100hr), 91.411 (Pitot-Static/Altimeter), 91.413 (Transponder)
// - Lycoming SI 1009BE (Engine TBO)
// - Continental SIL98-9E (Engine TBO)
// - Hartzell HC-SL-61-61Y (Propeller Overhaul)
// - Cirrus SR20/SR22/SR22T AMM Section 5-10 (Time Limits)
// - Cirrus SF50 AMM (Airworthiness Limitations)
// - Garmin G5 Part 23 AML STC Maintenance Manual (190-01112-11)
// - Garmin GI 275 Part 23 AML STC Maintenance Manual (190-02246-11)
// - Garmin G1000 System Maintenance Manual (190-00907-00)
// - Williams International FJ33-5A Operator Manual
// - P&WC PT6A Maintenance Manual
// =============================================================

export interface MxTemplateItem {
  item_name: string;
  tracking_type: 'time' | 'date';
  /** For time-based: hours between service. For date-based: days between service. */
  interval: number;
  is_required: boolean;
  /** Category for grouping in the UI */
  category: 'inspection' | 'engine' | 'propeller' | 'airframe' | 'avionics' | 'safety' | 'fluid';
}

export interface MxTemplate {
  id: string;
  name: string;
  description: string;
  engine_type: 'Piston' | 'Turbine';
  /** Applicable aircraft models (for display) */
  models: string[];
  items: MxTemplateItem[];
}

// ─── HELPERS ───
const DAYS_1_YEAR = 365;
const DAYS_2_YEARS = 730;
const DAYS_5_YEARS = 1825;
const DAYS_6_YEARS = 2190;
const DAYS_6_MONTHS = 180;
const DAYS_10_YEARS = 3650;
const DAYS_3_MONTHS = 90;

// =============================================================
// PISTON SINGLE — Cessna 172, 182, Piper PA-28, Cirrus SR22, etc.
// =============================================================
const PISTON_SINGLE: MxTemplate = {
  id: 'piston-single',
  name: 'Piston Single Engine',
  description: 'Standard maintenance items for single-engine piston aircraft. Covers Cessna 172/182, Piper PA-28/PA-32, Cirrus SR20/SR22, Beech Bonanza, Mooney, and similar.',
  engine_type: 'Piston',
  models: ['Cessna 172', 'Cessna 182', 'Cessna 206', 'Piper PA-28', 'Piper PA-32', 'Cirrus SR20', 'Cirrus SR22/SR22T', 'Beech Bonanza', 'Mooney M20'],
  items: [
    // ── Inspections ──
    { item_name: 'Annual Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'inspection' },
    { item_name: '100 Hour Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'inspection' },

    // ── Engine ──
    { item_name: 'Engine Oil & Filter Change', tracking_type: 'time', interval: 50, is_required: false, category: 'engine' },
    { item_name: 'Engine TBO (Overhaul)', tracking_type: 'time', interval: 2000, is_required: true, category: 'engine' },
    { item_name: 'Engine Calendar TBO', tracking_type: 'date', interval: DAYS_1_YEAR * 12, is_required: false, category: 'engine' },
    { item_name: 'Spark Plug Inspection & Rotation', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Magneto Inspection (500 Hr)', tracking_type: 'time', interval: 500, is_required: false, category: 'engine' },
    { item_name: 'Engine Fuel & Air Filter Replacement', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Exhaust System Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Engine Hose Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: false, category: 'engine' },
    { item_name: 'Vacuum Pump Replacement (If Equipped)', tracking_type: 'time', interval: 500, is_required: false, category: 'engine' },

    // ── Propeller ──
    { item_name: 'Propeller Overhaul / Life Limit', tracking_type: 'time', interval: 2000, is_required: true, category: 'propeller' },
    { item_name: 'Propeller Calendar Overhaul', tracking_type: 'date', interval: DAYS_6_YEARS, is_required: false, category: 'propeller' },
    { item_name: 'Prop Governor Overhaul', tracking_type: 'time', interval: 2000, is_required: false, category: 'propeller' },

    // ── Airframe ──
    { item_name: 'Landing Gear Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Brake Pad / Lining Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Wheel Bearing Repack', tracking_type: 'time', interval: 500, is_required: false, category: 'airframe' },
    { item_name: 'Tire Condition Check', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Control Cable Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Seat Rail / Track AD Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },

    // ── Avionics ──
    { item_name: 'Transponder / ADS-B Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Pitot-Static System Check', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Altimeter Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Compass Swing / Calibration', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: false, category: 'avionics' },
    { item_name: 'Nav Database Update', tracking_type: 'date', interval: 28, is_required: false, category: 'avionics' },
    { item_name: 'Standby EFIS Battery Test (G5/GI 275)', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'avionics' },
    { item_name: 'G1000 Standby Battery Check (If Equipped)', tracking_type: 'date', interval: DAYS_6_MONTHS, is_required: false, category: 'avionics' },
    { item_name: 'Avionics Cooling Fan Operational Check', tracking_type: 'time', interval: 500, is_required: false, category: 'avionics' },

    // ── Safety Equipment ──
    { item_name: 'ELT Battery Replacement', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'ELT Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'Fire Extinguisher Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'safety' },
    { item_name: 'Seat Belt & Harness Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },

    // ── Fluids ──
    { item_name: 'Hydraulic Fluid Service', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'fluid' },
    { item_name: 'Battery Electrolyte / Condition Check', tracking_type: 'date', interval: DAYS_3_MONTHS, is_required: false, category: 'fluid' },
  ]
};

// =============================================================
// CIRRUS SR20 — Continental IO-360-ES (200 HP) / Lycoming IO-390 (215 HP, G6+)
// AMM Section 5-10 Time Limits
// =============================================================
const CIRRUS_SR20: MxTemplate = {
  id: 'cirrus-sr20',
  name: 'Cirrus SR20',
  description: 'Cirrus SR20 per AMM Section 5-10. Continental IO-360-ES (200 HP, TBO 2,000 hrs). G6+ models: Lycoming IO-390-C3B6 (215 HP, TBO 2,000 hrs / 2,400 if >40 hrs/month).',
  engine_type: 'Piston',
  models: ['Cirrus SR20'],
  items: [
    // ── Inspections ──
    { item_name: 'Annual Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'inspection' },
    { item_name: '100 Hour Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'inspection' },

    // ── Engine (Continental IO-360-ES / Lycoming IO-390) ──
    { item_name: 'Engine Oil & Filter Change', tracking_type: 'time', interval: 50, is_required: false, category: 'engine' },
    { item_name: 'Engine TBO (Overhaul) — 2,000 Hr', tracking_type: 'time', interval: 2000, is_required: true, category: 'engine' },
    { item_name: 'Spark Plug Inspection & Rotation', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Induction Air Filter Replacement', tracking_type: 'time', interval: 200, is_required: false, category: 'engine' },
    { item_name: 'Muffler & Heat Exchanger Replacement', tracking_type: 'time', interval: 1000, is_required: true, category: 'engine' },
    { item_name: 'Alternator 1 Overhaul', tracking_type: 'time', interval: 2000, is_required: false, category: 'engine' },
    { item_name: 'Alternator 2 Overhaul (B&C)', tracking_type: 'time', interval: 1700, is_required: false, category: 'engine' },
    { item_name: 'Exhaust System Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },

    // ── Propeller (Hartzell 2- or 3-blade) ──
    { item_name: 'Propeller Overhaul (2,400 Hr)', tracking_type: 'time', interval: 2400, is_required: true, category: 'propeller' },
    { item_name: 'Propeller Calendar Overhaul (6 Yr)', tracking_type: 'date', interval: DAYS_6_YEARS, is_required: false, category: 'propeller' },

    // ── Fluid Lines & Seals (Section 5-10) ──
    { item_name: 'Flexible Fuel Lines Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: true, category: 'fluid' },
    { item_name: 'Flexible Oil System Lines Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: true, category: 'fluid' },
    { item_name: 'Flexible Brake System Lines Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: true, category: 'fluid' },
    { item_name: 'Gascolator Seals Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: false, category: 'fluid' },
    { item_name: 'Fuel Drain Valve Seals Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: false, category: 'fluid' },
    { item_name: 'Fuel System Boost Pump Replacement', tracking_type: 'date', interval: DAYS_10_YEARS, is_required: false, category: 'fluid' },

    // ── Airframe ──
    { item_name: 'Landing Gear Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Brake Pad / Lining Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Tire Condition Check', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Cabin Air Control Assembly Inspection', tracking_type: 'time', interval: 500, is_required: false, category: 'airframe' },

    // ── Avionics (FAR 91.411 / 91.413 + Garmin Perspective) ──
    { item_name: 'Transponder / ADS-B Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Pitot-Static System Check', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Altimeter Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Standby EFIS Battery Test (G5/GI 275)', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'avionics' },

    // ── CAPS (Airworthiness Limitations) ──
    { item_name: 'CAPS Rocket Motor Replacement', tracking_type: 'date', interval: DAYS_10_YEARS, is_required: true, category: 'safety' },
    { item_name: 'CAPS Parachute Repack', tracking_type: 'date', interval: DAYS_10_YEARS, is_required: true, category: 'safety' },
    { item_name: 'CAPS Line Cutter Replacement', tracking_type: 'date', interval: DAYS_6_YEARS, is_required: true, category: 'safety' },

    // ── Safety Equipment ──
    { item_name: 'ELT Battery Replacement', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'ELT Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'Fire Extinguisher Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'safety' },

    // ── Fluids & Consumables ──
    { item_name: 'Battery Electrolyte / Condition Check', tracking_type: 'date', interval: DAYS_3_MONTHS, is_required: false, category: 'fluid' },
  ]
};

// =============================================================
// CIRRUS SR22 — Continental IO-550-N (310 HP), NA
// AMM Section 5-10 Time Limits
// =============================================================
const CIRRUS_SR22: MxTemplate = {
  id: 'cirrus-sr22',
  name: 'Cirrus SR22',
  description: 'Cirrus SR22 (naturally aspirated) per AMM Section 5-10. Continental IO-550-N, 310 HP, TBO 2,000 hrs. Hartzell 3-blade composite prop.',
  engine_type: 'Piston',
  models: ['Cirrus SR22'],
  items: [
    // ── Inspections ──
    { item_name: 'Annual Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'inspection' },
    { item_name: '100 Hour Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'inspection' },

    // ── Engine (Continental IO-550-N, 310 HP) ──
    { item_name: 'Engine Oil & Filter Change', tracking_type: 'time', interval: 50, is_required: false, category: 'engine' },
    { item_name: 'Engine TBO (Overhaul) — IO-550-N, 2,000 Hr', tracking_type: 'time', interval: 2000, is_required: true, category: 'engine' },
    { item_name: 'Spark Plug Inspection & Rotation', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Induction Air Filter Replacement', tracking_type: 'time', interval: 200, is_required: false, category: 'engine' },
    { item_name: 'Muffler & Heat Exchanger Replacement', tracking_type: 'time', interval: 1000, is_required: true, category: 'engine' },
    { item_name: 'Alternator 1 Overhaul', tracking_type: 'time', interval: 2000, is_required: false, category: 'engine' },
    { item_name: 'Alternator 2 Overhaul (B&C)', tracking_type: 'time', interval: 1700, is_required: false, category: 'engine' },
    { item_name: 'Exhaust System Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },

    // ── Propeller (Hartzell 3-blade composite) ──
    { item_name: 'Propeller Overhaul (2,400 Hr)', tracking_type: 'time', interval: 2400, is_required: true, category: 'propeller' },
    { item_name: 'Propeller Calendar Overhaul (6 Yr)', tracking_type: 'date', interval: DAYS_6_YEARS, is_required: false, category: 'propeller' },

    // ── Fluid Lines & Seals (Section 5-10) ──
    { item_name: 'Flexible Fuel Lines Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: true, category: 'fluid' },
    { item_name: 'Flexible Oil System Lines Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: true, category: 'fluid' },
    { item_name: 'Flexible Brake System Lines Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: true, category: 'fluid' },
    { item_name: 'Gascolator Seals Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: false, category: 'fluid' },
    { item_name: 'Fuel Drain Valve Seals Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: false, category: 'fluid' },
    { item_name: 'Fuel System Boost Pump Replacement', tracking_type: 'date', interval: DAYS_10_YEARS, is_required: false, category: 'fluid' },

    // ── Airframe ──
    { item_name: 'Landing Gear Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Brake Pad / Lining Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Tire Condition Check', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Cabin Air Control Assembly Inspection', tracking_type: 'time', interval: 500, is_required: false, category: 'airframe' },

    // ── Avionics ──
    { item_name: 'Transponder / ADS-B Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Pitot-Static System Check', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Altimeter Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Standby EFIS Battery Test (G5/GI 275)', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'avionics' },

    // ── CAPS ──
    { item_name: 'CAPS Rocket Motor Replacement', tracking_type: 'date', interval: DAYS_10_YEARS, is_required: true, category: 'safety' },
    { item_name: 'CAPS Parachute Repack', tracking_type: 'date', interval: DAYS_10_YEARS, is_required: true, category: 'safety' },
    { item_name: 'CAPS Line Cutter Replacement', tracking_type: 'date', interval: DAYS_6_YEARS, is_required: true, category: 'safety' },

    // ── Safety ──
    { item_name: 'ELT Battery Replacement', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'ELT Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'Fire Extinguisher Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'safety' },

    // ── Fluids ──
    { item_name: 'Battery Electrolyte / Condition Check', tracking_type: 'date', interval: DAYS_3_MONTHS, is_required: false, category: 'fluid' },
  ]
};

// =============================================================
// CIRRUS SR22T — Continental TSIO-550-K (315 HP), Turbocharged
// AMM Section 5-10 Time Limits + turbo-specific items
// =============================================================
const CIRRUS_SR22T: MxTemplate = {
  id: 'cirrus-sr22t',
  name: 'Cirrus SR22T',
  description: 'Cirrus SR22T (turbocharged) per AMM Section 5-10. Continental TSIO-550-K, 315 HP, TBO 2,000 hrs. Single wastegate turbo system. Fixed 2,500 RPM prop governor.',
  engine_type: 'Piston',
  models: ['Cirrus SR22T'],
  items: [
    // ── Inspections ──
    { item_name: 'Annual Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'inspection' },
    { item_name: '100 Hour Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'inspection' },

    // ── Engine (Continental TSIO-550-K, 315 HP, Turbocharged) ──
    { item_name: 'Engine Oil & Filter Change', tracking_type: 'time', interval: 50, is_required: false, category: 'engine' },
    { item_name: 'Engine TBO (Overhaul) — TSIO-550-K, 2,000 Hr', tracking_type: 'time', interval: 2000, is_required: true, category: 'engine' },
    { item_name: 'Spark Plug Inspection & Rotation', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Induction Air Filter Replacement', tracking_type: 'time', interval: 200, is_required: false, category: 'engine' },
    { item_name: 'Muffler & Heat Exchanger Replacement', tracking_type: 'time', interval: 1000, is_required: true, category: 'engine' },
    { item_name: 'Alternator 1 Overhaul', tracking_type: 'time', interval: 2000, is_required: false, category: 'engine' },
    { item_name: 'Alternator 2 Overhaul (B&C)', tracking_type: 'time', interval: 1700, is_required: false, category: 'engine' },
    { item_name: 'Exhaust System Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },

    // ── Turbocharger System (SR22T-specific) ──
    { item_name: 'Turbocharger Wastegate Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Intercooler Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Turbo Induction System Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Turbocharger Overhaul (at Engine TBO)', tracking_type: 'time', interval: 2000, is_required: true, category: 'engine' },

    // ── Propeller (Hartzell 3-blade composite, fixed 2500 RPM governor) ──
    { item_name: 'Propeller Overhaul (2,400 Hr)', tracking_type: 'time', interval: 2400, is_required: true, category: 'propeller' },
    { item_name: 'Propeller Calendar Overhaul (6 Yr)', tracking_type: 'date', interval: DAYS_6_YEARS, is_required: false, category: 'propeller' },

    // ── Fluid Lines & Seals (Section 5-10) ──
    { item_name: 'Flexible Fuel Lines Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: true, category: 'fluid' },
    { item_name: 'Flexible Oil System Lines Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: true, category: 'fluid' },
    { item_name: 'Flexible Brake System Lines Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: true, category: 'fluid' },
    { item_name: 'Gascolator Seals Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: false, category: 'fluid' },
    { item_name: 'Fuel Drain Valve Seals Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: false, category: 'fluid' },
    { item_name: 'Fuel System Boost Pump Replacement', tracking_type: 'date', interval: DAYS_10_YEARS, is_required: false, category: 'fluid' },

    // ── Airframe ──
    { item_name: 'Landing Gear Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Brake Pad / Lining Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Tire Condition Check', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Cabin Air Control Assembly Inspection', tracking_type: 'time', interval: 500, is_required: false, category: 'airframe' },
    { item_name: 'Built-in Oxygen System Service', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },

    // ── Avionics ──
    { item_name: 'Transponder / ADS-B Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Pitot-Static System Check', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Altimeter Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Standby EFIS Battery Test (G5/GI 275)', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'avionics' },

    // ── CAPS ──
    { item_name: 'CAPS Rocket Motor Replacement', tracking_type: 'date', interval: DAYS_10_YEARS, is_required: true, category: 'safety' },
    { item_name: 'CAPS Parachute Repack', tracking_type: 'date', interval: DAYS_10_YEARS, is_required: true, category: 'safety' },
    { item_name: 'CAPS Line Cutter Replacement', tracking_type: 'date', interval: DAYS_6_YEARS, is_required: true, category: 'safety' },

    // ── Safety ──
    { item_name: 'ELT Battery Replacement', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'ELT Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'Fire Extinguisher Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'safety' },

    // ── Fluids ──
    { item_name: 'Battery Electrolyte / Condition Check', tracking_type: 'date', interval: DAYS_3_MONTHS, is_required: false, category: 'fluid' },
  ]
};

// =============================================================
// PISTON TWIN — PA-34 Seneca, BE76 Duchess, C310, etc.
// =============================================================
const PISTON_TWIN: MxTemplate = {
  id: 'piston-twin',
  name: 'Piston Twin Engine',
  description: 'Standard maintenance for twin-engine piston aircraft. Covers Piper Seneca, Beech Baron/Duchess, Cessna 310/340, and similar. Includes dual engine tracking.',
  engine_type: 'Piston',
  models: ['Piper PA-34 Seneca', 'Beech BE76 Duchess', 'Beech Baron', 'Cessna 310', 'Cessna 340', 'Piper PA-44 Seminole'],
  items: [
    // ── Inspections ──
    { item_name: 'Annual Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'inspection' },
    { item_name: '100 Hour Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'inspection' },

    // ── Engines (track by airframe time — individual engine tracking done via notes) ──
    { item_name: 'Left Engine Oil & Filter Change', tracking_type: 'time', interval: 50, is_required: false, category: 'engine' },
    { item_name: 'Right Engine Oil & Filter Change', tracking_type: 'time', interval: 50, is_required: false, category: 'engine' },
    { item_name: 'Left Engine TBO (Overhaul)', tracking_type: 'time', interval: 2000, is_required: true, category: 'engine' },
    { item_name: 'Right Engine TBO (Overhaul)', tracking_type: 'time', interval: 2000, is_required: true, category: 'engine' },
    { item_name: 'Left Engine Calendar TBO', tracking_type: 'date', interval: DAYS_1_YEAR * 12, is_required: false, category: 'engine' },
    { item_name: 'Right Engine Calendar TBO', tracking_type: 'date', interval: DAYS_1_YEAR * 12, is_required: false, category: 'engine' },
    { item_name: 'Spark Plug Inspection & Rotation (Both)', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Magneto Inspection (Both Engines)', tracking_type: 'time', interval: 500, is_required: false, category: 'engine' },
    { item_name: 'Engine Fuel & Air Filter Replacement', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Exhaust System Inspection (Both)', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Engine Hose Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: false, category: 'engine' },
    { item_name: 'Vacuum Pump Replacement (If Equipped)', tracking_type: 'time', interval: 500, is_required: false, category: 'engine' },

    // ── Propellers ──
    { item_name: 'Left Propeller Overhaul', tracking_type: 'time', interval: 2000, is_required: true, category: 'propeller' },
    { item_name: 'Right Propeller Overhaul', tracking_type: 'time', interval: 2000, is_required: true, category: 'propeller' },
    { item_name: 'Left Propeller Calendar Overhaul', tracking_type: 'date', interval: DAYS_6_YEARS, is_required: false, category: 'propeller' },
    { item_name: 'Right Propeller Calendar Overhaul', tracking_type: 'date', interval: DAYS_6_YEARS, is_required: false, category: 'propeller' },

    // ── Airframe ──
    { item_name: 'Landing Gear Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Landing Gear Retract System Service', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Brake Pad / Lining Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Wheel Bearing Repack', tracking_type: 'time', interval: 500, is_required: false, category: 'airframe' },
    { item_name: 'Tire Condition Check', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Control Cable Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'De-Ice / Anti-Ice System Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },

    // ── Avionics ──
    { item_name: 'Transponder / ADS-B Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Pitot-Static System Check', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Altimeter Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Compass Swing / Calibration', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: false, category: 'avionics' },

    // ── Safety ──
    { item_name: 'ELT Battery Replacement', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'ELT Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'Fire Extinguisher Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'safety' },

    // ── Fluids ──
    { item_name: 'Hydraulic Fluid Service', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'fluid' },
    { item_name: 'Battery Electrolyte / Condition Check', tracking_type: 'date', interval: DAYS_3_MONTHS, is_required: false, category: 'fluid' },
  ]
};

// =============================================================
// TURBOPROP SINGLE — TBM 700/850/900/960, Pilatus PC-12, etc.
// =============================================================
const TURBOPROP_SINGLE: MxTemplate = {
  id: 'turboprop-single',
  name: 'Turboprop Single Engine',
  description: 'Maintenance items for single-engine turboprops. Covers TBM 700/850/900/960, Pilatus PC-12, Epic E1000, and similar PT6A-powered aircraft.',
  engine_type: 'Turbine',
  models: ['Daher TBM 700', 'Daher TBM 850', 'Daher TBM 900', 'Daher TBM 960', 'Pilatus PC-12', 'Epic E1000'],
  items: [
    // ── Inspections ──
    { item_name: 'Annual / Phase A Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'inspection' },
    { item_name: 'Phase B Inspection (200 Hr)', tracking_type: 'time', interval: 200, is_required: false, category: 'inspection' },
    { item_name: 'Phase C Inspection (600 Hr)', tracking_type: 'time', interval: 600, is_required: false, category: 'inspection' },
    { item_name: '100 Hour Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'inspection' },

    // ── Engine (PT6A) ──
    { item_name: 'Engine Oil & Filter Change', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Engine Hot Section Inspection (HSI)', tracking_type: 'time', interval: 1800, is_required: true, category: 'engine' },
    { item_name: 'Engine TBO (Overhaul)', tracking_type: 'time', interval: 3600, is_required: true, category: 'engine' },
    { item_name: 'Engine Trend Monitoring Review', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Fuel Nozzle Inspection', tracking_type: 'time', interval: 600, is_required: false, category: 'engine' },
    { item_name: 'Igniter Plug Inspection', tracking_type: 'time', interval: 300, is_required: false, category: 'engine' },
    { item_name: 'Compressor Wash', tracking_type: 'time', interval: 200, is_required: false, category: 'engine' },
    { item_name: 'Engine Hose Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: false, category: 'engine' },

    // ── Propeller ──
    { item_name: 'Propeller Overhaul', tracking_type: 'time', interval: 4000, is_required: true, category: 'propeller' },
    { item_name: 'Propeller Calendar Overhaul', tracking_type: 'date', interval: DAYS_6_YEARS, is_required: false, category: 'propeller' },
    { item_name: 'Prop De-Ice Brush Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'propeller' },

    // ── Airframe ──
    { item_name: 'Landing Gear Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Landing Gear Actuator Service', tracking_type: 'time', interval: 1000, is_required: false, category: 'airframe' },
    { item_name: 'Brake Assembly Inspection', tracking_type: 'time', interval: 200, is_required: false, category: 'airframe' },
    { item_name: 'Wheel Bearing Inspection', tracking_type: 'time', interval: 500, is_required: false, category: 'airframe' },
    { item_name: 'Tire Condition Check', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Pressurization System Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Pressurization Hose Replacement', tracking_type: 'date', interval: DAYS_1_YEAR * 14, is_required: false, category: 'airframe' },
    { item_name: 'Control Cable Tension Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'De-Ice / Anti-Ice System Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Oxygen System Service', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },

    // ── Avionics ──
    { item_name: 'Transponder / ADS-B Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Pitot-Static / RVSM Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Altimeter Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Autopilot Servo Clutch Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'avionics' },

    // ── Safety ──
    { item_name: 'ELT Battery Replacement', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'ELT Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'Fire Extinguisher Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'Emergency Locator Weight Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'safety' },

    // ── Fluids ──
    { item_name: 'Hydraulic Fluid Service', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'fluid' },
    { item_name: 'Battery Condition Check', tracking_type: 'date', interval: DAYS_3_MONTHS, is_required: false, category: 'fluid' },
  ]
};

// =============================================================
// LIGHT JET — CJ series, Phenom, Citation M2, etc.
// =============================================================
const LIGHT_JET: MxTemplate = {
  id: 'light-jet',
  name: 'Light Jet',
  description: 'Maintenance items for light jets. Covers Cessna CJ series, Embraer Phenom 100/300, Citation M2/CJ3+/CJ4, HondaJet, and similar.',
  engine_type: 'Turbine',
  models: ['Cessna Citation CJ2+', 'Cessna Citation CJ3+', 'Cessna Citation CJ4', 'Cessna Citation M2', 'Embraer Phenom 100', 'Embraer Phenom 300', 'HondaJet'],
  items: [
    // ── Inspections ──
    { item_name: 'Phase 1 Inspection (200 Hr)', tracking_type: 'time', interval: 200, is_required: true, category: 'inspection' },
    { item_name: 'Phase 2 Inspection (400 Hr)', tracking_type: 'time', interval: 400, is_required: true, category: 'inspection' },
    { item_name: 'Phase 3 Inspection (800 Hr)', tracking_type: 'time', interval: 800, is_required: true, category: 'inspection' },
    { item_name: 'Phase 4 Inspection (1600 Hr)', tracking_type: 'time', interval: 1600, is_required: true, category: 'inspection' },
    { item_name: 'Annual / 12 Month Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'inspection' },
    { item_name: '24 Month Inspection', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: false, category: 'inspection' },

    // ── Engines (dual) ──
    { item_name: 'Left Engine Oil & Filter Change', tracking_type: 'time', interval: 150, is_required: false, category: 'engine' },
    { item_name: 'Right Engine Oil & Filter Change', tracking_type: 'time', interval: 150, is_required: false, category: 'engine' },
    { item_name: 'Left Engine Hot Section Inspection', tracking_type: 'time', interval: 3000, is_required: true, category: 'engine' },
    { item_name: 'Right Engine Hot Section Inspection', tracking_type: 'time', interval: 3000, is_required: true, category: 'engine' },
    { item_name: 'Left Engine TBO (Overhaul)', tracking_type: 'time', interval: 5000, is_required: true, category: 'engine' },
    { item_name: 'Right Engine TBO (Overhaul)', tracking_type: 'time', interval: 5000, is_required: true, category: 'engine' },
    { item_name: 'Engine Trend Monitoring Review', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Igniter Plug Replacement', tracking_type: 'time', interval: 400, is_required: false, category: 'engine' },
    { item_name: 'Engine Hose Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: false, category: 'engine' },

    // ── Airframe ──
    { item_name: 'Landing Gear Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Landing Gear Overhaul', tracking_type: 'time', interval: 5000, is_required: false, category: 'airframe' },
    { item_name: 'Brake Assembly Inspection', tracking_type: 'time', interval: 200, is_required: false, category: 'airframe' },
    { item_name: 'Wheel Bearing Inspection', tracking_type: 'time', interval: 500, is_required: false, category: 'airframe' },
    { item_name: 'Tire Condition Check', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Pressurization System Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Flight Control System Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'De-Ice / Anti-Ice System Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Oxygen System Service', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Emergency Exit Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },

    // ── Avionics ──
    { item_name: 'Transponder / ADS-B Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Pitot-Static / RVSM Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Altimeter Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Autopilot System Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'avionics' },
    { item_name: 'TCAS / TAWS System Check', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: false, category: 'avionics' },
    { item_name: 'CVR / FDR Check (If Equipped)', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'avionics' },

    // ── Safety ──
    { item_name: 'ELT Battery Replacement', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'ELT Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'Fire Extinguisher Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'Emergency Lighting Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'safety' },

    // ── Fluids ──
    { item_name: 'Hydraulic Fluid Service', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'fluid' },
    { item_name: 'Battery Condition Check', tracking_type: 'date', interval: DAYS_3_MONTHS, is_required: false, category: 'fluid' },
  ]
};

// =============================================================
// VISION JET — Cirrus SF50 (adds CAPS + Williams FJ33 specifics)
// =============================================================
const VISION_JET: MxTemplate = {
  id: 'vision-jet',
  name: 'Cirrus Vision Jet SF50',
  description: 'Cirrus SF50 Vision Jet. Williams FJ33-5A turbofan (1,846 lbs thrust, TBO 4,000 hrs, HSI 2,000 hrs). CAPS equipped. Airframe life limit 12,000 hrs. Garmin Perspective Touch+.',
  engine_type: 'Turbine',
  models: ['Cirrus SF50 Vision Jet', 'Cirrus SF50 G2', 'Cirrus SF50 G2+', 'Cirrus SF50 G3'],
  items: [
    // ── Inspections ──
    { item_name: 'Annual Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'inspection' },
    { item_name: '100 Hour Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'inspection' },

    // ── Engine (Williams FJ33-5A Turbofan, FADEC-controlled) ──
    { item_name: 'Engine Oil Change', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Engine Oil Filter Change', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Engine Hot Section Inspection (HSI) — 2,000 Hr', tracking_type: 'time', interval: 2000, is_required: true, category: 'engine' },
    { item_name: 'Engine TBO (Overhaul) — FJ33-5A, 4,000 Hr', tracking_type: 'time', interval: 4000, is_required: true, category: 'engine' },
    { item_name: 'Engine Trend Monitoring Review', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },
    { item_name: 'Engine Borescope Inspection', tracking_type: 'time', interval: 200, is_required: false, category: 'engine' },
    { item_name: 'Fuel Nozzle Inspection', tracking_type: 'time', interval: 600, is_required: false, category: 'engine' },
    { item_name: 'Igniter Plug Replacement', tracking_type: 'time', interval: 400, is_required: false, category: 'engine' },
    { item_name: 'FADEC System Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'engine' },
    { item_name: 'Engine Inlet / FOD Screen Inspection', tracking_type: 'time', interval: 100, is_required: false, category: 'engine' },

    // ── Airframe (Composite Carbon Fiber) ──
    { item_name: 'Airframe Life Limit (12,000 Hr)', tracking_type: 'time', interval: 12000, is_required: true, category: 'airframe' },
    { item_name: 'Landing Gear Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Landing Gear Trailing Link Inspection', tracking_type: 'time', interval: 500, is_required: false, category: 'airframe' },
    { item_name: 'Nose Gear Steering System Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Brake Assembly Inspection', tracking_type: 'time', interval: 200, is_required: false, category: 'airframe' },
    { item_name: 'Wheel Bearing Inspection', tracking_type: 'time', interval: 500, is_required: false, category: 'airframe' },
    { item_name: 'Tire Condition Check', tracking_type: 'time', interval: 100, is_required: false, category: 'airframe' },
    { item_name: 'Pressurization System Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'airframe' },
    { item_name: 'Cabin Pressure Controller Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Environmental Control System Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Air Conditioning System Service', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Flight Control System Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'V-Tail / Ruddervator Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Composite Airframe UV / Damage Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'De-Ice / Ice Protection System Check (TKS)', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Windshield TKS De-Ice Fluid Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },

    // ── Oxygen System ──
    { item_name: 'Pilot Quick-Don Oxygen Mask Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Passenger Auto-Deploy Oxygen Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'airframe' },
    { item_name: 'Oxygen System Bottle Hydrostatic Test', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: false, category: 'airframe' },

    // ── Fluid Lines & Seals ──
    { item_name: 'Flexible Fuel Lines Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: true, category: 'fluid' },
    { item_name: 'Engine Hose Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: false, category: 'fluid' },
    { item_name: 'Flexible Brake Lines Replacement', tracking_type: 'date', interval: DAYS_5_YEARS, is_required: false, category: 'fluid' },
    { item_name: 'Hydraulic Fluid Service', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'fluid' },

    // ── Avionics (Garmin Perspective Touch+) ──
    { item_name: 'Transponder / ADS-B Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Pitot-Static System Check', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Altimeter Certification', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: true, category: 'avionics' },
    { item_name: 'Autopilot / Autothrottle System Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'avionics' },
    { item_name: 'Weather Radar System Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'avionics' },
    { item_name: 'TAWS / Terrain Awareness Check', tracking_type: 'date', interval: DAYS_2_YEARS, is_required: false, category: 'avionics' },
    { item_name: 'Stick Shaker / Pusher System Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'avionics' },
    { item_name: 'SafeReturn System Check (If Equipped)', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'avionics' },
    { item_name: 'Emergency Descent Mode Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'avionics' },

    // ── CAPS (Cirrus Airframe Parachute System) ──
    { item_name: 'CAPS Rocket Motor Replacement', tracking_type: 'date', interval: DAYS_10_YEARS, is_required: true, category: 'safety' },
    { item_name: 'CAPS Parachute Repack', tracking_type: 'date', interval: DAYS_10_YEARS, is_required: true, category: 'safety' },
    { item_name: 'CAPS Line Cutter Replacement', tracking_type: 'date', interval: DAYS_6_YEARS, is_required: true, category: 'safety' },
    { item_name: 'CAPS Annual Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },

    // ── Safety Equipment ──
    { item_name: 'ELT Battery Replacement', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'ELT Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'Fire Extinguisher Inspection', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: true, category: 'safety' },
    { item_name: 'Emergency Lighting Check', tracking_type: 'date', interval: DAYS_1_YEAR, is_required: false, category: 'safety' },

    // ── Batteries & Consumables ──
    { item_name: 'Main Battery Condition Check', tracking_type: 'date', interval: DAYS_3_MONTHS, is_required: false, category: 'fluid' },
    { item_name: 'Standby Battery Check', tracking_type: 'date', interval: DAYS_3_MONTHS, is_required: false, category: 'fluid' },
  ]
};


// =============================================================
// EXPORT ALL TEMPLATES
// =============================================================
export const MX_TEMPLATES: MxTemplate[] = [
  PISTON_SINGLE,
  CIRRUS_SR20,
  CIRRUS_SR22,
  CIRRUS_SR22T,
  PISTON_TWIN,
  TURBOPROP_SINGLE,
  LIGHT_JET,
  VISION_JET,
];

/** Category display labels and sort order */
export const CATEGORY_META: Record<string, { label: string; order: number }> = {
  inspection: { label: 'Inspections', order: 1 },
  engine: { label: 'Engine', order: 2 },
  propeller: { label: 'Propeller', order: 3 },
  airframe: { label: 'Airframe', order: 4 },
  avionics: { label: 'Avionics & Instruments', order: 5 },
  safety: { label: 'Safety Equipment', order: 6 },
  fluid: { label: 'Fluids & Consumables', order: 7 },
};

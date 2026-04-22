import type { EquipmentCategory } from './types';

/** Seed catalog of popular GA equipment.
 *
 * The form matches by exact (case-insensitive) model string to auto-fill
 * make, category, and capability flags. When multiple manufacturers use
 * the same model number we disambiguate with the make field. Unknown
 * equipment still saves fine — capability flags just stay false. */
export type EquipmentCatalogEntry = {
  make: string;
  model: string;
  category: EquipmentCategory;
  ifr_capable?: boolean;
  adsb_out?: boolean;
  adsb_in?: boolean;
  transponder_class?: string;
};

export const EQUIPMENT_CATALOG: ReadonlyArray<EquipmentCatalogEntry> = [
  // Transponders — most carry 1090ES ADS-B Out; some require external GPS source
  { make: 'Garmin', model: 'GTX 327', category: 'transponder' },
  { make: 'Garmin', model: 'GTX 328', category: 'transponder' },
  { make: 'Garmin', model: 'GTX 330', category: 'transponder' },
  { make: 'Garmin', model: 'GTX 330ES', category: 'transponder', adsb_out: true, transponder_class: 'Class 1 Mode S/ES' },
  { make: 'Garmin', model: 'GTX 335', category: 'transponder', adsb_out: true, transponder_class: 'Class 1 Mode S/ES' },
  { make: 'Garmin', model: 'GTX 335R', category: 'transponder', adsb_out: true, transponder_class: 'Class 1 Mode S/ES' },
  { make: 'Garmin', model: 'GTX 345', category: 'transponder', adsb_out: true, adsb_in: true, transponder_class: 'Class 1 Mode S/ES' },
  { make: 'Garmin', model: 'GTX 345R', category: 'transponder', adsb_out: true, adsb_in: true, transponder_class: 'Class 1 Mode S/ES' },
  { make: 'Garmin', model: 'GTX 45R', category: 'transponder', adsb_out: true, adsb_in: true, transponder_class: 'Class 1 Mode S/ES' },
  { make: 'Bendix/King', model: 'KT 70', category: 'transponder' },
  { make: 'Bendix/King', model: 'KT 74', category: 'transponder', adsb_out: true, transponder_class: 'Mode S/ES' },
  { make: 'Bendix/King', model: 'KT 76A', category: 'transponder' },
  { make: 'Bendix/King', model: 'KT 76C', category: 'transponder' },
  { make: 'Avidyne', model: 'AXP340', category: 'transponder', adsb_out: true, transponder_class: 'Mode S/ES' },
  { make: 'L3Harris', model: 'Lynx NGT-9000', category: 'transponder', adsb_out: true, adsb_in: true, transponder_class: 'Class 1 Mode S/ES' },
  { make: 'Stratus by Appareo', model: 'ESG', category: 'transponder', adsb_out: true, transponder_class: 'Mode S/ES' },
  { make: 'Stratus by Appareo', model: 'ESGi', category: 'transponder', adsb_out: true, transponder_class: 'Mode S/ES' },
  { make: 'Trig', model: 'TT21', category: 'transponder', adsb_out: true },
  { make: 'Trig', model: 'TT22', category: 'transponder', adsb_out: true },
  { make: 'Trig', model: 'TT31', category: 'transponder', adsb_out: true },

  // Dedicated ADS-B Out / beacons
  { make: 'uAvionix', model: 'tailBeacon', category: 'adsb', adsb_out: true },
  { make: 'uAvionix', model: 'tailBeaconX', category: 'adsb', adsb_out: true, transponder_class: 'Mode S/ES' },
  { make: 'uAvionix', model: 'skyBeacon', category: 'adsb', adsb_out: true },
  { make: 'FreeFlight', model: '1201', category: 'adsb', adsb_out: true },
  { make: 'FreeFlight', model: '1203', category: 'adsb', adsb_out: true },

  // GPS navigators (IFR-approved WAAS unless noted)
  { make: 'Garmin', model: 'GPS 175', category: 'gps', ifr_capable: true },
  { make: 'Garmin', model: 'GNC 355', category: 'gps', ifr_capable: true },
  { make: 'Garmin', model: 'GNX 375', category: 'gps', ifr_capable: true, adsb_out: true, adsb_in: true, transponder_class: 'Mode S/ES' },
  { make: 'Garmin', model: 'GTN 625', category: 'gps', ifr_capable: true },
  { make: 'Garmin', model: 'GTN 635', category: 'gps', ifr_capable: true },
  { make: 'Garmin', model: 'GTN 650', category: 'gps', ifr_capable: true },
  { make: 'Garmin', model: 'GTN 650Xi', category: 'gps', ifr_capable: true },
  { make: 'Garmin', model: 'GTN 725', category: 'gps', ifr_capable: true },
  { make: 'Garmin', model: 'GTN 750', category: 'gps', ifr_capable: true },
  { make: 'Garmin', model: 'GTN 750Xi', category: 'gps', ifr_capable: true },
  { make: 'Garmin', model: 'GNS 430', category: 'gps' },
  { make: 'Garmin', model: 'GNS 430W', category: 'gps', ifr_capable: true },
  { make: 'Garmin', model: 'GNS 530', category: 'gps' },
  { make: 'Garmin', model: 'GNS 530W', category: 'gps', ifr_capable: true },
  { make: 'Avidyne', model: 'IFD440', category: 'gps', ifr_capable: true },
  { make: 'Avidyne', model: 'IFD540', category: 'gps', ifr_capable: true },
  { make: 'Avidyne', model: 'IFD545', category: 'gps', ifr_capable: true },
  { make: 'Avidyne', model: 'IFD550', category: 'gps', ifr_capable: true },

  // PFD / MFD / EFIS
  { make: 'Garmin', model: 'G5', category: 'instrument', ifr_capable: true },
  { make: 'Garmin', model: 'GI 275', category: 'instrument', ifr_capable: true },
  { make: 'Garmin', model: 'G500 TXi', category: 'instrument', ifr_capable: true },
  { make: 'Garmin', model: 'G600 TXi', category: 'instrument', ifr_capable: true },
  { make: 'Garmin', model: 'G1000', category: 'instrument', ifr_capable: true },
  { make: 'Garmin', model: 'G1000 NXi', category: 'instrument', ifr_capable: true },
  { make: 'Garmin', model: 'G3X Touch', category: 'instrument', ifr_capable: true },
  { make: 'Avidyne', model: 'Entegra', category: 'instrument', ifr_capable: true },
  { make: 'Avidyne', model: 'Entegra Release 9', category: 'instrument', ifr_capable: true },
  { make: 'Aspen', model: 'E5', category: 'instrument', ifr_capable: true },
  { make: 'Aspen', model: 'Evolution 1000 Pro', category: 'instrument', ifr_capable: true },
  { make: 'Aspen', model: 'Evolution 2000', category: 'instrument', ifr_capable: true },
  { make: 'Dynon', model: 'SkyView HDX', category: 'instrument', ifr_capable: true },
  { make: 'Dynon', model: 'D10A', category: 'instrument' },

  // Autopilots
  { make: 'Garmin', model: 'GFC 500', category: 'autopilot' },
  { make: 'Garmin', model: 'GFC 600', category: 'autopilot' },
  { make: 'Garmin', model: 'GFC 700', category: 'autopilot' },
  { make: 'S-TEC', model: 'System 30', category: 'autopilot' },
  { make: 'S-TEC', model: 'System 50', category: 'autopilot' },
  { make: 'S-TEC', model: 'System 55', category: 'autopilot' },
  { make: 'S-TEC', model: 'System 55X', category: 'autopilot' },
  { make: 'S-TEC', model: '3100', category: 'autopilot' },
  { make: 'Bendix/King', model: 'KAP 140', category: 'autopilot' },
  { make: 'Bendix/King', model: 'KFC 150', category: 'autopilot' },
  { make: 'Bendix/King', model: 'KFC 200', category: 'autopilot' },
  { make: 'Bendix/King', model: 'KFC 225', category: 'autopilot' },
  { make: 'Bendix/King', model: 'KFC 275', category: 'autopilot' },
  { make: 'Bendix/King', model: 'KFC 325', category: 'autopilot' },
  { make: 'Century', model: 'Century I', category: 'autopilot' },
  { make: 'Century', model: 'Century II', category: 'autopilot' },
  { make: 'Century', model: 'Century III', category: 'autopilot' },
  { make: 'Century', model: 'Century 2000', category: 'autopilot' },
  { make: 'TruTrak', model: 'Vizion', category: 'autopilot' },

  // Audio panels / intercoms
  { make: 'Garmin', model: 'GMA 340', category: 'intercom' },
  { make: 'Garmin', model: 'GMA 345', category: 'intercom' },
  { make: 'Garmin', model: 'GMA 345c', category: 'intercom' },
  { make: 'Garmin', model: 'GMA 347', category: 'intercom' },
  { make: 'Garmin', model: 'GMA 350', category: 'intercom' },
  { make: 'Garmin', model: 'GMA 350c', category: 'intercom' },
  { make: 'PS Engineering', model: 'PMA 450', category: 'intercom' },
  { make: 'PS Engineering', model: 'PMA 450B', category: 'intercom' },
  { make: 'PS Engineering', model: 'PMA 8000', category: 'intercom' },
  { make: 'PS Engineering', model: 'PMA 8000BT', category: 'intercom' },
  { make: 'PS Engineering', model: 'PM 1200', category: 'intercom' },
  { make: 'PS Engineering', model: 'PM 3000', category: 'intercom' },
  { make: 'Bendix/King', model: 'KMA 24', category: 'intercom' },
  { make: 'Bendix/King', model: 'KMA 26', category: 'intercom' },
  { make: 'Bendix/King', model: 'KMA 28', category: 'intercom' },

  // Nav/Com radios
  { make: 'Garmin', model: 'GTR 200', category: 'radio' },
  { make: 'Garmin', model: 'GTR 200B', category: 'radio' },
  { make: 'Garmin', model: 'GTR 225', category: 'radio' },
  { make: 'Garmin', model: 'GNC 215', category: 'radio' },
  { make: 'Garmin', model: 'GNC 255', category: 'radio' },
  { make: 'Bendix/King', model: 'KY 97A', category: 'radio' },
  { make: 'Bendix/King', model: 'KY 196A', category: 'radio' },
  { make: 'Bendix/King', model: 'KX 155', category: 'radio' },
  { make: 'Bendix/King', model: 'KX 165', category: 'radio' },

  // ELTs
  { make: 'ACK', model: 'E-01', category: 'elt' },
  { make: 'ACK', model: 'E-04', category: 'elt' },
  { make: 'Artex', model: 'ELT 345', category: 'elt' },
  { make: 'Artex', model: 'ELT 1000', category: 'elt' },
  { make: 'Artex', model: 'ELT 4000', category: 'elt' },
  { make: 'Artex', model: 'ME406', category: 'elt' },
  { make: 'Kannad', model: '406 AF Compact', category: 'elt' },
  { make: 'AmeriKing', model: 'AK-451', category: 'elt' },
  { make: 'AmeriKing', model: 'AK-450', category: 'elt' },

  // Engines — Lycoming
  { make: 'Lycoming', model: 'O-235', category: 'engine' },
  { make: 'Lycoming', model: 'O-320', category: 'engine' },
  { make: 'Lycoming', model: 'O-360', category: 'engine' },
  { make: 'Lycoming', model: 'O-360-A1A', category: 'engine' },
  { make: 'Lycoming', model: 'O-360-A4M', category: 'engine' },
  { make: 'Lycoming', model: 'IO-360', category: 'engine' },
  { make: 'Lycoming', model: 'IO-360-A1B6', category: 'engine' },
  { make: 'Lycoming', model: 'IO-360-L2A', category: 'engine' },
  { make: 'Lycoming', model: 'O-540', category: 'engine' },
  { make: 'Lycoming', model: 'IO-540', category: 'engine' },
  { make: 'Lycoming', model: 'IO-540-AB1A5', category: 'engine' },
  { make: 'Lycoming', model: 'IO-580', category: 'engine' },
  { make: 'Lycoming', model: 'IO-720', category: 'engine' },
  { make: 'Lycoming', model: 'TIO-540', category: 'engine' },
  { make: 'Lycoming', model: 'TIO-540-AE2A', category: 'engine' },
  { make: 'Lycoming', model: 'TIO-540-J2BD', category: 'engine' },

  // Engines — Continental
  { make: 'Continental', model: 'O-200', category: 'engine' },
  { make: 'Continental', model: 'O-200-A', category: 'engine' },
  { make: 'Continental', model: 'O-200-D', category: 'engine' },
  { make: 'Continental', model: 'O-300', category: 'engine' },
  { make: 'Continental', model: 'O-470-R', category: 'engine' },
  { make: 'Continental', model: 'O-470-U', category: 'engine' },
  { make: 'Continental', model: 'IO-360', category: 'engine' },
  { make: 'Continental', model: 'IO-470', category: 'engine' },
  { make: 'Continental', model: 'IO-520', category: 'engine' },
  { make: 'Continental', model: 'IO-550', category: 'engine' },
  { make: 'Continental', model: 'IO-550-B', category: 'engine' },
  { make: 'Continental', model: 'IO-550-N', category: 'engine' },
  { make: 'Continental', model: 'TSIO-520', category: 'engine' },
  { make: 'Continental', model: 'TSIO-520-BE', category: 'engine' },
  { make: 'Continental', model: 'TSIO-550', category: 'engine' },
  { make: 'Continental', model: 'TSIO-550-K', category: 'engine' },

  // Engines — other
  { make: 'Rotax', model: '582', category: 'engine' },
  { make: 'Rotax', model: '912', category: 'engine' },
  { make: 'Rotax', model: '912UL', category: 'engine' },
  { make: 'Rotax', model: '912ULS', category: 'engine' },
  { make: 'Rotax', model: '912iS', category: 'engine' },
  { make: 'Rotax', model: '914', category: 'engine' },
  { make: 'Rotax', model: '915iS', category: 'engine' },
  { make: 'Rotax', model: '916iS', category: 'engine' },
  { make: 'Jabiru', model: '2200', category: 'engine' },
  { make: 'Jabiru', model: '3300', category: 'engine' },
  { make: 'UL Power', model: 'UL350', category: 'engine' },
  { make: 'UL Power', model: 'UL390', category: 'engine' },

  // Turbines — Pratt & Whitney Canada PT6A family (most common GA turboprops)
  { make: 'Pratt & Whitney Canada', model: 'PT6A-21', category: 'engine' },
  { make: 'Pratt & Whitney Canada', model: 'PT6A-27', category: 'engine' },
  { make: 'Pratt & Whitney Canada', model: 'PT6A-42', category: 'engine' },
  { make: 'Pratt & Whitney Canada', model: 'PT6A-60A', category: 'engine' },
  { make: 'Pratt & Whitney Canada', model: 'PT6A-67', category: 'engine' },
  { make: 'Pratt & Whitney Canada', model: 'PT6A-67A', category: 'engine' },
  { make: 'Pratt & Whitney Canada', model: 'PT6A-114', category: 'engine' },
  { make: 'Pratt & Whitney Canada', model: 'PT6A-114A', category: 'engine' },
  { make: 'Pratt & Whitney Canada', model: 'PT6A-140', category: 'engine' },

  // Turbofans — single-engine personal jets
  { make: 'Williams International', model: 'FJ33-5A', category: 'engine' },

  // Propellers — catalog seed; common prop models vary widely by installation
  { make: 'Hartzell', model: 'HC-C2YK-1BF', category: 'propeller' },
  { make: 'Hartzell', model: 'HC-C3YR-1RF', category: 'propeller' },
  { make: 'Hartzell', model: 'HC-E4A-3A', category: 'propeller' },
  { make: 'Hartzell', model: 'HC-F2YR-1F', category: 'propeller' },
  { make: 'Hartzell', model: 'PHC-J3YF-1RF', category: 'propeller' },
  { make: 'Hartzell', model: 'PHC-E3YF-4RF', category: 'propeller' },
  { make: 'Hartzell', model: 'BHC-J3YF-1RF', category: 'propeller' },
  { make: 'McCauley', model: '1A103', category: 'propeller' },
  { make: 'McCauley', model: '1A170', category: 'propeller' },
  { make: 'McCauley', model: '1A200', category: 'propeller' },
  { make: 'McCauley', model: 'B2D34C', category: 'propeller' },
  { make: 'McCauley', model: 'B3D36C', category: 'propeller' },
  { make: 'Sensenich', model: '72CK', category: 'propeller' },
  { make: 'Sensenich', model: '74DM', category: 'propeller' },
  { make: 'Sensenich', model: '76EM', category: 'propeller' },
  { make: 'Sensenich', model: '76EM8', category: 'propeller' },
  { make: 'MT-Propeller', model: 'MTV-9', category: 'propeller' },
  { make: 'MT-Propeller', model: 'MTV-12', category: 'propeller' },
  { make: 'MT-Propeller', model: 'MTV-21', category: 'propeller' },

  // Altitude encoders (feed transponder) — logged under 'altimeter' because
  // the encoder and altimeter are often one unit, and pilots look for these
  // when a 91.411/91.413 check is due.
  { make: 'ACK', model: 'A-30.5', category: 'altimeter' },
  { make: 'Sandia', model: 'SAE5-35', category: 'altimeter' },
  { make: 'Trans-Cal', model: 'SSD120-30N', category: 'altimeter' },
  { make: 'Trans-Cal', model: 'SSD120-35N', category: 'altimeter' },
  { make: 'Garmin', model: 'GAE 12', category: 'altimeter' },

  // Engine monitors / EIS — some are primary replacements (EDM-900/930,
  // MVP-50P), others secondary. Keep ifr_capable off by default — the flag
  // is for GPS/nav IFR-approval, not engine-monitor certification.
  { make: 'JPI', model: 'EDM-700', category: 'instrument' },
  { make: 'JPI', model: 'EDM-730', category: 'instrument' },
  { make: 'JPI', model: 'EDM-740', category: 'instrument' },
  { make: 'JPI', model: 'EDM-760', category: 'instrument' },
  { make: 'JPI', model: 'EDM-830', category: 'instrument' },
  { make: 'JPI', model: 'EDM-900', category: 'instrument' },
  { make: 'JPI', model: 'EDM-930', category: 'instrument' },
  { make: 'Electronics International', model: 'MVP-50P', category: 'instrument' },
  { make: 'Electronics International', model: 'CGR-30P', category: 'instrument' },
  { make: 'Electronics International', model: 'CGR-30C', category: 'instrument' },
  { make: 'Insight', model: 'G2', category: 'instrument' },
  { make: 'Insight', model: 'G3', category: 'instrument' },
  { make: 'Insight', model: 'G4', category: 'instrument' },

  // Fuel computers (separate from full engine monitors)
  { make: 'JPI', model: 'FS-450', category: 'instrument' },
  { make: 'JPI', model: 'FS-550', category: 'instrument' },
  { make: 'Electronics International', model: 'FP-5L', category: 'instrument' },
  { make: 'Shadin', model: 'Miniflo-L', category: 'instrument' },

  // Traffic systems (TAS/TCAS I)
  { make: 'Avidyne', model: 'TAS600', category: 'avionics' },
  { make: 'Avidyne', model: 'TAS605A', category: 'avionics' },
  { make: 'Avidyne', model: 'TAS615', category: 'avionics' },
  { make: 'L3Harris', model: 'Skywatch SKY497', category: 'avionics' },
  { make: 'L3Harris', model: 'Skywatch SKY899', category: 'avionics' },
  { make: 'Garmin', model: 'GTS 825', category: 'avionics' },
  { make: 'Garmin', model: 'GTS 855', category: 'avionics' },

  // Weather — Stormscope (lightning) + SiriusXM/FIS-B receivers
  { make: 'L3Harris', model: 'Stormscope WX-500', category: 'avionics' },
  { make: 'L3Harris', model: 'Stormscope WX-900', category: 'avionics' },
  { make: 'L3Harris', model: 'Stormscope WX-1000E', category: 'avionics' },
  { make: 'Garmin', model: 'GDL 39', category: 'avionics', adsb_in: true },
  { make: 'Garmin', model: 'GDL 52', category: 'avionics', adsb_in: true },
  { make: 'Garmin', model: 'GDL 69A', category: 'avionics' },
  { make: 'Garmin', model: 'GDL 88', category: 'avionics', adsb_out: true, adsb_in: true },

  // Lighting — LED replacements are what pilots actually log (the old
  // incandescents came with the airplane; the LEDs show up as a mod).
  { make: 'Whelen', model: 'Orion 500', category: 'lighting' },
  { make: 'Whelen', model: 'Orion 600', category: 'lighting' },
  { make: 'Whelen', model: 'Orion 650', category: 'lighting' },
  { make: 'Whelen', model: 'Parmetheus Plus', category: 'lighting' },
  { make: 'Whelen', model: '71420', category: 'lighting' },
  { make: 'AeroLEDs', model: 'SunSpot 36HX', category: 'lighting' },
  { make: 'AeroLEDs', model: 'SunSpot 46HX', category: 'lighting' },
  { make: 'AeroLEDs', model: 'Pulsar NSP', category: 'lighting' },
];

/** Distinct manufacturers across the catalog, alphabetized. Used for the
 * Make field datalist so pilots see consistent spelling of brands. */
export const EQUIPMENT_MAKES: string[] = Array.from(
  new Set(EQUIPMENT_CATALOG.map(e => e.make))
).sort((a, b) => a.localeCompare(b));

/** Case-insensitive lookup. If `make` is provided, it narrows when two
 * manufacturers share a model number (e.g. both Lycoming and Continental
 * make an IO-360). Returns undefined when nothing matches — callers
 * should treat that as "unknown equipment, leave capability flags alone." */
export function findCatalogEntry(
  model: string,
  make?: string,
): EquipmentCatalogEntry | undefined {
  const m = model.trim().toLowerCase();
  if (!m) return undefined;
  const mk = make?.trim().toLowerCase();
  const matches = EQUIPMENT_CATALOG.filter(e => e.model.toLowerCase() === m);
  if (matches.length === 0) return undefined;
  if (mk) {
    const narrowed = matches.find(e => e.make.toLowerCase() === mk);
    if (narrowed) return narrowed;
  }
  return matches[0];
}

/** Filter the catalog for populating the Model datalist. Narrows by
 * category when one is selected and by make when the pilot has typed
 * something that matches a known manufacturer. */
export function filterCatalog(
  category?: EquipmentCategory,
  make?: string,
): EquipmentCatalogEntry[] {
  const mk = make?.trim().toLowerCase();
  return EQUIPMENT_CATALOG.filter(e => {
    if (category && e.category !== category) return false;
    if (mk && e.make.toLowerCase() !== mk) return false;
    return true;
  });
}

/** Multi-term substring search across "make model" for the catalog
 * combobox. Splits the query on whitespace and requires every term to
 * appear somewhere in make+model — so "continental io" and "io conti"
 * both return Continental IO-* engines. Case-insensitive. */
export function searchCatalog(query: string, limit = 8): EquipmentCatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  const matches: EquipmentCatalogEntry[] = [];
  for (const e of EQUIPMENT_CATALOG) {
    const haystack = `${e.make} ${e.model}`.toLowerCase();
    if (terms.every(t => haystack.includes(t))) {
      matches.push(e);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

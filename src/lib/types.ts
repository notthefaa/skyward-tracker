// =============================================================
// SHARED TYPES — Single source of truth for all domain models
// =============================================================

export interface Aircraft {
  id: string;
  tail_number: string;
  serial_number?: string | null;
  aircraft_type: string;
  engine_type: 'Piston' | 'Turbine';
  total_airframe_time: number;
  total_engine_time: number;
  setup_aftt?: number;
  setup_ftt?: number;
  setup_hobbs?: number;
  setup_tach?: number;
  home_airport?: string | null;
  /** IANA timezone identifier (e.g. 'America/Los_Angeles'). Used by
   *  server-side date math so MX-reminder emails and airworthiness
   *  verdicts reflect the pilot's calendar day, not the UTC runtime. */
  time_zone?: string | null;
  main_contact?: string | null;
  main_contact_phone?: string | null;
  main_contact_email?: string | null;
  mx_contact?: string | null;
  mx_contact_phone?: string | null;
  mx_contact_email?: string | null;
  avatar_url?: string | null;
  current_fuel_gallons?: number;
  fuel_last_updated?: string | null;
  created_by?: string | null;
  make?: string | null;
  model?: string | null;
  year_mfg?: number | null;
  is_ifr_equipped?: boolean | null;
  is_for_hire?: boolean | null;
}

export type EquipmentCategory =
  | 'engine' | 'propeller' | 'avionics' | 'transponder' | 'altimeter'
  | 'pitot_static' | 'elt' | 'adsb' | 'autopilot' | 'gps' | 'radio'
  | 'intercom' | 'instrument' | 'landing_gear' | 'lighting'
  | 'accessory' | 'other';

export interface AircraftEquipment {
  id: string;
  aircraft_id: string;
  category: EquipmentCategory;
  name: string;
  make?: string | null;
  model?: string | null;
  serial?: string | null;
  part_number?: string | null;
  installed_at?: string | null;
  installed_by?: string | null;
  removed_at?: string | null;
  removed_reason?: string | null;
  ifr_capable: boolean;
  adsb_out: boolean;
  adsb_in: boolean;
  transponder_class?: string | null;
  is_elt: boolean;
  elt_battery_expires?: string | null;
  elt_battery_cumulative_hours?: number | null;
  pitot_static_due_date?: string | null;
  transponder_due_date?: string | null;
  altimeter_due_date?: string | null;
  vor_due_date?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface AirworthinessDirective {
  id: string;
  aircraft_id: string;
  ad_number: string;
  amendment?: string | null;
  subject: string;
  applicability?: string | null;
  source_url?: string | null;
  source: 'drs_sync' | 'manual' | 'user_added';
  effective_date?: string | null;
  is_superseded: boolean;
  superseded_by?: string | null;
  compliance_type: 'one_time' | 'recurring';
  initial_compliance_hours?: number | null;
  initial_compliance_date?: string | null;
  recurring_interval_hours?: number | null;
  recurring_interval_months?: number | null;
  last_complied_date?: string | null;
  last_complied_time?: number | null;
  last_complied_by?: string | null;
  next_due_date?: string | null;
  next_due_time?: number | null;
  compliance_method?: string | null;
  notes?: string | null;
  affects_airworthiness: boolean;
  synced_at?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface AircraftWithMetrics extends Aircraft {
  burnRate: number;
  confidenceScore: number;
  burnRateCV?: number;
  burnRateLow?: number;
  burnRateHigh?: number;
}

export interface FlightLog {
  id: string;
  aircraft_id: string;
  user_id?: string | null;
  pod?: string | null;
  poa?: string | null;
  aftt?: number | null;
  ftt?: number | null;
  hobbs?: number | null;
  tach?: number | null;
  engine_cycles?: number;
  landings?: number;
  initials?: string;
  pax_info?: string | null;
  trip_reason?: string | null;
  fuel_gallons?: number | null;
  created_at: string;
}

export interface MaintenanceItem {
  id: string;
  aircraft_id: string;
  item_name: string;
  tracking_type: 'time' | 'date' | 'both';
  is_required: boolean;
  last_completed_time?: number | null;
  time_interval?: number | null;
  due_time?: number | null;
  last_completed_date?: string | null;
  date_interval_days?: number | null;
  due_date?: string | null;
  automate_scheduling?: boolean;
  mx_schedule_sent?: boolean;
  primary_heads_up_sent?: boolean;
  reminder_5_sent?: boolean;
  reminder_15_sent?: boolean;
  reminder_30_sent?: boolean;
}

export interface ProcessedMxItem extends MaintenanceItem {
  remaining: number;
  projectedDays: number;
  isExpired: boolean;
  dueText: string;
}

export interface Squawk {
  id: string;
  aircraft_id: string;
  reported_by?: string | null;
  reporter_initials?: string | null;
  location: string;
  description: string;
  affects_airworthiness: boolean;
  status: 'open' | 'resolved';
  pictures?: string[];
  is_deferred?: boolean;
  mel_number?: string | null;
  cdl_number?: string | null;
  nef_number?: string | null;
  mdl_number?: string | null;
  mel_control_number?: string | null;
  deferral_category?: string | null;
  deferral_procedures_completed?: boolean;
  full_name?: string | null;
  certificate_number?: string | null;
  signature_data?: string | null;
  signature_date?: string | null;
  resolved_note?: string | null;
  edited_at?: string | null;
  edited_by_initials?: string | null;
  resolved_by_event_id?: string | null;
  created_at: string;
}

export interface Note {
  id: string;
  aircraft_id: string;
  author_id?: string | null;
  author_email?: string | null;
  author_initials?: string | null;
  content: string;
  pictures?: string[];
  edited_at?: string | null;
  created_at: string;
}

export interface UserRole {
  user_id: string;
  role: 'admin' | 'pilot';
  email?: string | null;
  initials?: string | null;
  faa_ratings?: string[] | null;
}

// Pilot FAA certificates and ratings the user can self-identify in their
// profile. Order here drives the order they render in SettingsModal.
// Howard consumes this via buildUserContext to tailor tone / jargon.
export const FAA_RATINGS = [
  { code: 'Student',      label: 'Student Pilot' },
  { code: 'Sport',        label: 'Sport Pilot' },
  { code: 'Recreational', label: 'Recreational Pilot' },
  { code: 'PPL',          label: 'Private Pilot (PPL)' },
  { code: 'IFR',          label: 'Instrument Rating (IFR)' },
  { code: 'ME',           label: 'Multi-Engine (ME)' },
  { code: 'CPL',          label: 'Commercial Pilot (CPL)' },
  { code: 'ATP',          label: 'Airline Transport Pilot (ATP)' },
  { code: 'CFI',          label: 'Flight Instructor (CFI)' },
  { code: 'CFII',         label: 'Instrument Instructor (CFII)' },
  { code: 'MEI',          label: 'Multi-Engine Instructor (MEI)' },
] as const;

export type FaaRatingCode = typeof FAA_RATINGS[number]['code'];

export interface Reservation {
  id: string;
  aircraft_id: string;
  user_id?: string | null;
  start_time: string;
  end_time: string;
  title?: string | null;
  route?: string | null;
  pilot_name?: string | null;
  pilot_initials?: string | null;
  status: 'confirmed' | 'cancelled';
  created_at: string;
  // IANA timezone the booker was in when the reservation was created/last edited.
  // Used to render times in the booker's zone for viewers in other zones.
  time_zone?: string | null;
}

export interface NotificationPreference {
  id: string;
  user_id: string;
  notification_type: NotificationType;
  enabled: boolean;
  created_at: string;
}

export type NotificationType = 
  | 'reservation_created'
  | 'reservation_cancelled'
  | 'squawk_reported'
  | 'mx_reminder'
  | 'service_update'
  | 'note_posted';

export const NOTIFICATION_TYPES: { 
  type: NotificationType; 
  label: string; 
  description: string;
  /** If true, only the primary contact for an aircraft receives this notification */
  primaryContactOnly?: boolean;
}[] = [
  // ─── Operational (all assigned pilots) ───
  { type: 'reservation_created', label: 'New Reservations', description: 'When someone books an aircraft you are assigned to.' },
  { type: 'reservation_cancelled', label: 'Cancelled Reservations', description: 'When a reservation is cancelled on your aircraft.' },
  { type: 'squawk_reported', label: 'New Squawks', description: 'When a squawk is reported on your aircraft.' },
  { type: 'note_posted', label: 'New Notes', description: 'When a pilot posts a note on your aircraft.' },
  // ─── Maintenance coordination (primary contact only) ───
  { type: 'mx_reminder', label: 'Maintenance Reminders', description: 'When maintenance items are approaching their due thresholds.', primaryContactOnly: true },
  { type: 'service_update', label: 'Service Updates', description: 'When a service event status changes or your mechanic sends an update.', primaryContactOnly: true },
];

export interface UserAircraftAccess {
  user_id: string;
  aircraft_id: string;
  aircraft_role: AircraftRole;
}

export interface SystemSettings {
  id?: number;
  reminder_1: number;
  reminder_2: number;
  reminder_3: number;
  reminder_hours_1?: number;
  reminder_hours_2?: number;
  reminder_hours_3?: number;
  sched_time: number;
  sched_days: number;
  predictive_sched_days?: number;
}

export type AppRole = 'admin' | 'pilot';
export type AircraftRole = 'admin' | 'pilot';
export type AircraftStatus = 'airworthy' | 'issues' | 'grounded';
export type AppTab = 'fleet' | 'summary' | 'times' | 'calendar' | 'mx' | 'notes' | 'howard' | 'howard-usage' | 'documents' | 'equipment' | 'ads';
export type MxSubTab = 'maintenance' | 'squawks' | 'service';
export type LogSubTab = 'flights' | 'checks';

export type VorCheckType = 'VOT' | 'Ground Checkpoint' | 'Airborne Checkpoint' | 'Dual VOR';

export interface VorCheck {
  id: string;
  aircraft_id: string;
  user_id?: string | null;
  check_type: VorCheckType;
  station: string;
  bearing_error: number;
  tolerance: number;
  passed: boolean;
  initials: string;
  created_at: string;
}

export interface TireCheck {
  id: string;
  aircraft_id: string;
  user_id?: string | null;
  nose_psi: number | null;
  left_main_psi: number | null;
  right_main_psi: number | null;
  initials: string;
  notes?: string | null;
  created_at: string;
}

export interface OilLog {
  id: string;
  aircraft_id: string;
  user_id?: string | null;
  oil_qty: number;
  oil_added?: number | null;
  engine_hours: number;
  initials: string;
  notes?: string | null;
  created_at: string;
}

export type DocType =
  | 'POH'
  | 'AFM'
  | 'Supplement'
  | 'MEL'
  | 'SOP'
  | 'Registration'
  | 'Airworthiness Certificate'
  | 'Weight and Balance'
  | 'Other';

export interface AircraftDocument {
  id: string;
  aircraft_id: string;
  user_id?: string | null;
  filename: string;
  file_url: string;
  doc_type: DocType;
  page_count?: number | null;
  status: 'processing' | 'ready' | 'error';
  created_at: string;
}

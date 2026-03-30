// =============================================================
// SHARED TYPES — Single source of truth for all domain models
//
// Every interface includes [key: string]: any to gracefully
// accept extra columns from Supabase without type errors.
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
  [key: string]: any;
}

/** Aircraft with computed burn rate and confidence score attached */
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
  [key: string]: any;
}

export interface MaintenanceItem {
  id: string;
  aircraft_id: string;
  item_name: string;
  tracking_type: 'time' | 'date';
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
  [key: string]: any;
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
  created_at: string;
  [key: string]: any;
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
  [key: string]: any;
}

export interface UserRole {
  user_id: string;
  role: 'admin' | 'pilot';
  email?: string | null;
  initials?: string | null;
  [key: string]: any;
}

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
  [key: string]: any;
}

export interface NotificationPreference {
  id: string;
  user_id: string;
  notification_type: NotificationType;
  enabled: boolean;
  created_at: string;
  [key: string]: any;
}

export type NotificationType = 
  | 'reservation_created'
  | 'reservation_cancelled'
  | 'squawk_reported'
  | 'mx_reminder'
  | 'service_update'
  | 'note_posted';

export const NOTIFICATION_TYPES: { type: NotificationType; label: string; description: string }[] = [
  { type: 'reservation_created', label: 'New Reservations', description: 'When someone books an aircraft you are assigned to.' },
  { type: 'reservation_cancelled', label: 'Cancelled Reservations', description: 'When a reservation is cancelled on your aircraft.' },
  { type: 'squawk_reported', label: 'New Squawks', description: 'When a squawk is reported on your aircraft.' },
  { type: 'mx_reminder', label: 'Maintenance Reminders', description: 'When maintenance items are approaching their due thresholds.' },
  { type: 'service_update', label: 'Service Updates', description: 'When a service event status changes or your mechanic sends an update.' },
  { type: 'note_posted', label: 'New Notes', description: 'When a pilot posts a note on your aircraft.' },
];

export interface UserAircraftAccess {
  user_id: string;
  aircraft_id: string;
  aircraft_role: AircraftRole;
  [key: string]: any;
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
  [key: string]: any;
}

export type AppRole = 'admin' | 'pilot';
export type AircraftRole = 'admin' | 'pilot';
export type AircraftStatus = 'airworthy' | 'issues' | 'grounded';
export type AppTab = 'fleet' | 'summary' | 'times' | 'calendar' | 'mx' | 'notes';
export type MxSubTab = 'maintenance' | 'squawks';

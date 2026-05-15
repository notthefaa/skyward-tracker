// =============================================================
// HOWARD PROPOSED ACTIONS — propose-confirm write model
// =============================================================
// Howard can't write directly. Every write action flows through:
//   1. Howard calls a propose_* tool → this module inserts a row in
//      aft_proposed_actions with status='pending', returns the id.
//   2. The UI renders a confirmation card in chat.
//   3. User taps Confirm → /api/howard/actions/[id] POST → executeAction()
//      runs the actual write using existing API logic.
//   4. User taps Cancel → /api/howard/actions/[id] DELETE → status='cancelled'.
//
// Role gating: each action type declares required_role ('access' or 'admin').
// ExecuteAction enforces this at confirmation time using requireAircraft* helpers.
// =============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  validateFlightLogInput,
  submitFlightLog,
  validateVorCheckInput,
  submitVorCheck,
  validateOilLogInput,
  submitOilLog,
  validateTireCheckInput,
  submitTireCheck,
  validateSquawkInput,
  submitSquawk,
} from '@/lib/submissions';
import { sendReservationCancelledEmail } from '@/lib/reservationCancel';

export type ActionType =
  | 'reservation'
  | 'mx_schedule'
  | 'squawk_resolve'
  | 'note'
  | 'equipment'
  | 'onboarding_setup'
  // Phase 1 Howard-as-action-taker additions:
  | 'flight_log'
  | 'mx_item'
  | 'squawk'
  | 'vor_check'
  | 'oil_log'
  | 'tire_check'
  // Phase 2 — admin / coordination actions:
  | 'reservation_cancel'
  | 'squawk_defer'
  | 'pilot_invite'
  | 'aircraft_update';

export type RequiredRole = 'access' | 'admin';

export interface ProposedAction {
  id: string;
  thread_id: string;
  message_id: string | null;
  user_id: string;
  /** Null only for onboarding_setup — no aircraft exists yet. */
  aircraft_id: string | null;
  action_type: ActionType;
  payload: any;
  summary: string;
  required_role: RequiredRole;
  status: 'pending' | 'confirmed' | 'cancelled' | 'executed' | 'failed';
  created_at: string;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  cancelled_at?: string | null;
  executed_at?: string | null;
  executed_record_id?: string | null;
  executed_record_table?: string | null;
  error_message?: string | null;
}

// Payload shapes — documented here so Howard's tool schemas and the
// execute handlers agree on the contract.

export interface ReservationPayload {
  start_time: string; // ISO
  end_time: string;   // ISO
  pilot_initials: string;
  pod?: string;
  poa?: string;
  notes?: string;
}

export interface MxSchedulePayload {
  proposed_date?: string; // ISO date
  mx_item_ids?: string[];
  squawk_ids?: string[];
  addon_services?: string[];
  notes?: string;
}

export interface SquawkResolvePayload {
  squawk_id: string;
  resolution_note: string;
}

export interface NotePayload {
  content: string;
}

export interface OnboardingSetupPayload {
  // Profile fields written to aft_user_roles
  profile: {
    full_name: string;
    initials: string;
    faa_ratings?: string[];
  };
  // Aircraft fields written to aft_aircraft. Tight minimum viable set —
  // photo, contacts, serial, equipment list, and documents are left
  // for the user to fill in later through AircraftModal / Equipment /
  // Documents tabs. Howard explicitly mentions this in his closer.
  aircraft: {
    tail_number: string;
    make?: string;
    model?: string;
    engine_type: 'Piston' | 'Turbine';
    is_ifr_equipped: boolean;
    home_airport?: string;
    /** IANA timezone forwarded from the pilot's browser via ToolContext.
     * Optional — falls back to the column default ('UTC') if absent. */
    time_zone?: string;
    // Setup-time meters — airframe + engine baselines at the moment of
    // onboarding. Distinct from the live `total_*_time` columns.
    setup_aftt?: number;
    setup_ftt?: number;
    setup_hobbs?: number;
    setup_tach?: number;
  };
}

export interface EquipmentPayload {
  name: string;
  category: string;
  make?: string;
  model?: string;
  serial?: string;
  installed_at?: string;
  installed_by?: string;
  ifr_capable?: boolean;
  adsb_out?: boolean;
  is_elt?: boolean;
  transponder_class?: string;
  transponder_due_date?: string;
  altimeter_due_date?: string;
  pitot_static_due_date?: string;
  elt_battery_expires?: string;
  notes?: string;
}

// Phase 1 — Howard-as-action-taker payloads. Each mirrors the
// corresponding `validate*Input` in `@/lib/submissions.ts` so the
// executor can pass the payload straight through the existing
// validator → atomic-submit pipeline.

export interface FlightLogPayload {
  pod?: string;
  poa?: string;
  initials: string;
  ftt?: number;
  tach?: number;
  aftt?: number;
  hobbs?: number;
  landings?: number;
  engine_cycles?: number;
  fuel_gallons?: number;
  trip_reason?: string;
  pax_info?: string;
  occurred_at?: string;
}

export interface MaintenanceItemPayload {
  item_name: string;
  tracking_type: 'time' | 'date' | 'both';
  // time-based fields
  last_completed_time?: number;
  time_interval?: number;
  // date-based fields
  last_completed_date?: string;
  date_interval_days?: number;
  // common
  is_required?: boolean;
  far_reference?: string;
  notes?: string;
}

export interface SquawkPayload {
  description: string;
  location?: string;
  affects_airworthiness?: boolean;
  initials: string;
  occurred_at?: string;
}

export interface VorCheckPayload {
  check_type: string;
  station: string;
  bearing_error: number;
  initials: string;
  occurred_at?: string;
}

export interface OilLogPayload {
  oil_qty: number;
  oil_added?: number;
  engine_hours: number;
  initials: string;
  notes?: string;
  occurred_at?: string;
}

export interface TireCheckPayload {
  nose_psi?: number;
  left_main_psi?: number;
  right_main_psi?: number;
  initials: string;
  notes?: string;
  occurred_at?: string;
}

// Phase 2 — admin / coordination payloads.

export interface ReservationCancelPayload {
  reservation_id: string;
  /** Optional reason — saved on the row + included in the cancellation
   * email fan-out so other pilots see why the slot opened up. */
  reason?: string;
}

export interface SquawkDeferPayload {
  squawk_id: string;
  /** One of: MEL, CDL, NEF, MDL. */
  deferral_category: string;
  /** Numbers identifying the deferral document section. Only the
   * category's matching field is meaningful — others stay empty. */
  mel_number?: string;
  cdl_number?: string;
  nef_number?: string;
  mdl_number?: string;
  mel_control_number?: string;
  /** Required by §91.213 — PIC asserts they completed the deferral
   * procedures (gate items, placards, etc.). */
  deferral_procedures_completed: boolean;
  /** Optional: PIC name + cert for the signoff record. Howard fills
   * from per-request context when available. */
  full_name?: string;
  certificate_number?: string;
}

export interface PilotInvitePayload {
  email: string;
  /** Per-aircraft role on the named aircraft. Note: existing
   * /api/pilot-invite accepts 'admin' | 'pilot'; we keep the same
   * surface so the executor can delegate behavior. */
  aircraft_role: 'admin' | 'pilot';
}

/**
 * Allowlist of aircraft profile fields Howard can update via chat.
 * Excludes anything that affects calculations (tail_number, engine_type,
 * setup/total times, avatar) — those have their own surfaces and
 * carry too much blast radius for a one-tap confirm.
 */
export interface AircraftUpdatePayload {
  home_airport?: string;
  time_zone?: string;
  is_ifr_equipped?: boolean;
  main_contact?: string;
  main_contact_phone?: string;
  main_contact_email?: string;
  mx_contact?: string;
  mx_contact_phone?: string;
  mx_contact_email?: string;
}

const ROLE_BY_TYPE: Record<ActionType, RequiredRole> = {
  reservation: 'access',
  mx_schedule: 'admin',
  squawk_resolve: 'access',
  note: 'access',
  equipment: 'admin',
  // Onboarding setup runs before the user has any aircraft access —
  // the executor hard-codes the caller as the new aircraft's admin.
  // `access` here means "don't try to resolve per-aircraft role."
  onboarding_setup: 'access',
  // Phase 1 additions. Logging (flight, ops checks, squawks) is open
  // to any pilot with aircraft access — same as the corresponding tab
  // routes. Adding a tracked MX item is an owner concern (it shapes
  // the airworthiness calculus + auto-scheduling), so admin-only.
  flight_log: 'access',
  mx_item: 'admin',
  squawk: 'access',
  vor_check: 'access',
  oil_log: 'access',
  tire_check: 'access',
  // Phase 2. reservation_cancel uses 'access' because the executor
  // handles the own-vs-admin gate itself (same as the route): a pilot
  // can always cancel their own slot; admins can cancel anyone's.
  // squawk_defer / pilot_invite / aircraft_update are admin-gated.
  reservation_cancel: 'access',
  squawk_defer: 'admin',
  pilot_invite: 'admin',
  aircraft_update: 'admin',
};

export function requiredRoleFor(type: ActionType): RequiredRole {
  return ROLE_BY_TYPE[type];
}

/**
 * Build a short human-readable summary for the confirmation card.
 * Keep it terse — the card shows the payload fields explicitly.
 */
export function summarize(type: ActionType, payload: any, aircraftTail: string): string {
  switch (type) {
    case 'reservation': {
      const p = payload as ReservationPayload;
      const from = new Date(p.start_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
      const to = new Date(p.end_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
      return `Reserve ${aircraftTail} ${from} → ${to} for ${p.pilot_initials}${p.pod || p.poa ? ` (${p.pod || '?'}→${p.poa || '?'})` : ''}`;
    }
    case 'mx_schedule': {
      const p = payload as MxSchedulePayload;
      const count = (p.mx_item_ids?.length || 0) + (p.squawk_ids?.length || 0);
      return `Schedule maintenance on ${aircraftTail}${p.proposed_date ? ` for ${p.proposed_date}` : ''} — ${count} item${count === 1 ? '' : 's'}`;
    }
    case 'squawk_resolve':
      return `Resolve squawk on ${aircraftTail}${(payload as SquawkResolvePayload).resolution_note ? `: ${(payload as SquawkResolvePayload).resolution_note.slice(0, 60)}` : ''}`;
    case 'note':
      return `Add note on ${aircraftTail}: "${(payload as NotePayload).content.slice(0, 80)}"`;
    case 'equipment': {
      const p = payload as EquipmentPayload;
      return `Add ${p.category}: ${p.name}${p.make || p.model ? ` (${[p.make, p.model].filter(Boolean).join(' ')})` : ''} to ${aircraftTail}`;
    }
    case 'onboarding_setup': {
      const p = payload as OnboardingSetupPayload;
      const acLabel = [p.aircraft.make, p.aircraft.model].filter(Boolean).join(' ') || p.aircraft.tail_number;
      return `Set up ${p.profile.full_name} (${p.profile.initials}) + register ${p.aircraft.tail_number} (${acLabel})`;
    }
    case 'flight_log': {
      const p = payload as FlightLogPayload;
      const route = (p.pod || p.poa) ? `${p.pod || '?'} → ${p.poa || '?'}` : 'flight';
      const meter = p.tach != null ? `Tach ${p.tach}` : p.ftt != null ? `FTT ${p.ftt}` : p.hobbs != null ? `Hobbs ${p.hobbs}` : '';
      return `Log ${route} on ${aircraftTail}${meter ? ` (${meter})` : ''}`;
    }
    case 'mx_item': {
      const p = payload as MaintenanceItemPayload;
      const interval = p.tracking_type === 'date'
        ? `every ${p.date_interval_days ?? '?'} days`
        : p.tracking_type === 'time'
        ? `every ${p.time_interval ?? '?'} hrs`
        : `${p.time_interval ?? '?'} hrs / ${p.date_interval_days ?? '?'} days`;
      return `Track ${p.item_name} on ${aircraftTail} (${interval})`;
    }
    case 'squawk': {
      const p = payload as SquawkPayload;
      const grounded = p.affects_airworthiness ? ' [GROUNDED]' : '';
      return `Report squawk on ${aircraftTail}${grounded}: ${p.description.slice(0, 60)}`;
    }
    case 'vor_check': {
      const p = payload as VorCheckPayload;
      return `Log VOR check on ${aircraftTail} at ${p.station} (${p.check_type}, ${p.bearing_error}° error)`;
    }
    case 'oil_log': {
      const p = payload as OilLogPayload;
      const added = p.oil_added != null && p.oil_added > 0 ? ` +${p.oil_added} qt` : '';
      return `Log oil on ${aircraftTail}: ${p.oil_qty} qt @ ${p.engine_hours} hrs${added}`;
    }
    case 'tire_check': {
      const p = payload as TireCheckPayload;
      const readings = [
        p.nose_psi != null ? `N ${p.nose_psi}` : null,
        p.left_main_psi != null ? `L ${p.left_main_psi}` : null,
        p.right_main_psi != null ? `R ${p.right_main_psi}` : null,
      ].filter(Boolean).join(' · ');
      return `Log tire PSI on ${aircraftTail}: ${readings || 'no readings'}`;
    }
    case 'reservation_cancel': {
      const p = payload as ReservationCancelPayload;
      return `Cancel reservation on ${aircraftTail}${p.reason ? ` — ${p.reason.slice(0, 60)}` : ''}`;
    }
    case 'squawk_defer': {
      const p = payload as SquawkDeferPayload;
      return `Defer squawk on ${aircraftTail} under ${p.deferral_category}`;
    }
    case 'pilot_invite': {
      const p = payload as PilotInvitePayload;
      return `Invite ${p.email} to ${aircraftTail} (${p.aircraft_role})`;
    }
    case 'aircraft_update': {
      const p = payload as AircraftUpdatePayload;
      const changed = Object.entries(p).filter(([, v]) => v !== undefined).map(([k]) => k.replace(/_/g, ' '));
      return `Update ${aircraftTail}: ${changed.join(', ') || 'no fields'}`;
    }
  }
}

/**
 * Insert a proposed action. Called by the Howard propose_* tool handlers.
 * Returns the id + summary so Howard can reference it in its reply.
 */
export async function proposeAction(
  sb: SupabaseClient,
  params: {
    threadId: string;
    userId: string;
    /** Nullable only for onboarding_setup — the aircraft doesn't
     * exist yet at proposal time; the executor creates it. */
    aircraftId: string | null;
    aircraftTail: string;
    actionType: ActionType;
    payload: any;
  },
): Promise<{ id: string; summary: string }> {
  const summary = summarize(params.actionType, params.payload, params.aircraftTail);
  const { data, error } = await sb
    .from('aft_proposed_actions')
    .insert({
      thread_id: params.threadId,
      user_id: params.userId,
      aircraft_id: params.aircraftId,
      action_type: params.actionType,
      payload: params.payload,
      summary,
      required_role: requiredRoleFor(params.actionType),
      status: 'pending',
    })
    .select('id, summary')
    .single();
  if (error) throw error;
  return data as { id: string; summary: string };
}

/**
 * Execute a confirmed action. Reuses existing API logic by inserting
 * directly through the admin client (user's permission is checked
 * at the /api/howard/actions endpoint before this runs).
 *
 * Returns the created record ID + table, or throws on failure.
 */
export async function executeAction(
  sb: SupabaseClient,
  action: ProposedAction,
  userId: string,
): Promise<{ recordId: string; recordTable: string }> {
  switch (action.action_type) {
    case 'reservation': {
      const p = action.payload as ReservationPayload;
      // Reject reservations that start in the past — Claude can
      // misresolve "tomorrow" against stale clock context.
      const startMs = Date.parse(p.start_time);
      if (!Number.isFinite(startMs) || startMs < Date.now() - 60_000) {
        throw new Error('Reservation start time is in the past.');
      }
      // Block MX-conflict overlaps. The /api/reservations POST has
      // this check; the Howard executor used to bypass it entirely,
      // letting a confirmed action land a reservation inside an
      // already-scheduled maintenance block. Reservation-vs-reservation
      // overlap is still caught by the aft_reservations exclusion
      // constraint at insert time; this gate covers the MX-block path
      // that has no DB constraint.
      const { data: mxEvents, error: mxErr } = await sb
        .from('aft_maintenance_events')
        .select('confirmed_date, estimated_completion')
        .eq('aircraft_id', action.aircraft_id)
        .in('status', ['confirmed', 'in_progress', 'ready_for_pickup'])
        .is('deleted_at', null);
      if (mxErr) throw mxErr;
      for (const ev of (mxEvents || [])) {
        if (!ev.confirmed_date) continue;
        const mxStart = new Date(ev.confirmed_date + 'T00:00:00Z');
        const mxEnd = ev.estimated_completion
          ? new Date(ev.estimated_completion + 'T23:59:59.999Z')
          : new Date(mxStart.getTime() + 86_400_000);
        if (new Date(p.start_time) < mxEnd && new Date(p.end_time) > mxStart) {
          throw new Error('Reservation overlaps a scheduled maintenance block.');
        }
      }
      const { data, error } = await sb
        .from('aft_reservations')
        .insert({
          aircraft_id: action.aircraft_id,
          user_id: userId,
          start_time: p.start_time,
          end_time: p.end_time,
          pilot_initials: p.pilot_initials,
          pod: p.pod || null,
          poa: p.poa || null,
          notes: p.notes || null,
          status: 'confirmed',
        })
        .select('id')
        .single();
      if (error) throw error;
      return { recordId: data.id, recordTable: 'aft_reservations' };
    }

    case 'note': {
      const p = action.payload as NotePayload;
      const { data, error } = await sb
        .from('aft_notes')
        .insert({
          aircraft_id: action.aircraft_id,
          author_id: userId,
          content: p.content,
        })
        .select('id')
        .single();
      if (error) throw error;
      return { recordId: data.id, recordTable: 'aft_notes' };
    }

    case 'squawk_resolve': {
      const p = action.payload as SquawkResolvePayload;
      // Re-verify at execution time — the squawk may have been resolved,
      // deleted, or reassigned between proposal and confirmation.
      const { data: sq } = await sb
        .from('aft_squawks')
        .select('id, aircraft_id, deleted_at, status')
        .eq('id', p.squawk_id)
        .maybeSingle();
      if (!sq || sq.aircraft_id !== action.aircraft_id || sq.deleted_at) {
        throw new Error('Squawk not found for this aircraft.');
      }
      if (sq.status === 'resolved') {
        throw new Error('Squawk was already resolved by someone else.');
      }
      // Scope the UPDATE with a WHERE status='open' guard so even if a
      // concurrent writer slipped in between the SELECT above and this
      // UPDATE, we won't clobber an already-resolved row.
      const { error, data: updated } = await sb
        .from('aft_squawks')
        .update({
          status: 'resolved',
          affects_airworthiness: false,
          resolved_note: p.resolution_note,
        })
        .eq('id', p.squawk_id)
        .eq('status', 'open')
        .select('id');
      if (error) throw error;
      if (!updated || updated.length === 0) {
        throw new Error('Squawk was already resolved by someone else.');
      }
      return { recordId: p.squawk_id, recordTable: 'aft_squawks' };
    }

    case 'equipment': {
      const p = action.payload as EquipmentPayload;
      const { data, error } = await sb
        .from('aft_aircraft_equipment')
        .insert({
          aircraft_id: action.aircraft_id,
          created_by: userId,
          name: p.name,
          category: p.category,
          make: p.make || null,
          model: p.model || null,
          serial: p.serial || null,
          installed_at: p.installed_at || null,
          installed_by: p.installed_by || null,
          ifr_capable: !!p.ifr_capable,
          adsb_out: !!p.adsb_out,
          is_elt: !!p.is_elt,
          transponder_class: p.transponder_class || null,
          transponder_due_date: p.transponder_due_date || null,
          altimeter_due_date: p.altimeter_due_date || null,
          pitot_static_due_date: p.pitot_static_due_date || null,
          elt_battery_expires: p.elt_battery_expires || null,
          notes: p.notes || null,
        })
        .select('id')
        .single();
      if (error) throw error;
      return { recordId: data.id, recordTable: 'aft_aircraft_equipment' };
    }

    case 'onboarding_setup': {
      const p = action.payload as OnboardingSetupPayload;

      // 1. Profile fields — UPSERT, not UPDATE. The signup flow
      // creates an aft_user_roles row, but invited users (or any race
      // where the trigger hasn't landed) wouldn't have one — UPDATE
      // would silently no-op and leave completed_onboarding=false,
      // bouncing the user back into onboarding next render.
      //
      // Include `email` so pilot-invite's dedupe-by-email lookup
      // (which scans aft_user_roles.email) doesn't see this user as
      // "new" and create a second auth row. The classic-form path
      // already writes email here via /api/user/onboarding-complete;
      // the Howard path was missing it.
      let userEmail: string | null = null;
      const { data: userInfo, error: userErr } = await sb.auth.admin.getUserById(userId);
      if (userErr) throw userErr;
      userEmail = userInfo?.user?.email ?? null;
      const profileFields: Record<string, any> = {
        user_id: userId,
        full_name: p.profile.full_name.trim(),
        initials: p.profile.initials.toUpperCase().slice(0, 3),
        email: userEmail,
        // NOTE: completed_onboarding is intentionally NOT flipped here.
        // We flip it only after the aircraft + access rows land
        // successfully — otherwise a partial failure (e.g. dup-tail
        // 23505 on aircraft insert) would leave the user with an
        // empty fleet but the onboarding gate marked done, stranding
        // them on the empty-fleet screen with no clear way back to
        // the welcome chat.
      };
      if (p.profile.faa_ratings && p.profile.faa_ratings.length > 0) {
        profileFields.faa_ratings = p.profile.faa_ratings;
      }
      const { error: profErr } = await sb
        .from('aft_user_roles')
        .upsert(profileFields, { onConflict: 'user_id' });
      if (profErr) throw profErr;

      // 2. Insert the aircraft. Tail normalized to uppercase to match
      // the rest of the app's lookup convention.
      const tailNorm = p.aircraft.tail_number.toUpperCase().trim();
      const make = p.aircraft.make?.trim() || '';
      const model = p.aircraft.model?.trim() || '';
      // aircraft_type is the legacy "Model" string (NOT NULL on the
      // table, predates the make/model split). AircraftForm /
      // AircraftModal / PilotOnboarding all write `aircraft_type =
      // model` (just the model name, not "make model"). Mirror that
      // convention so a Howard-onboarded pilot doesn't see "Cessna
      // 172N" duplicated in the Model field when they later edit via
      // the form. Fall back to make, then to a generic placeholder so
      // the NOT NULL constraint never blows up.
      const aircraftType = model || make || `${p.aircraft.engine_type} aircraft`;
      const aircraftRow: Record<string, any> = {
        tail_number: tailNorm,
        aircraft_type: aircraftType,
        created_by: userId,
        engine_type: p.aircraft.engine_type,
        is_ifr_equipped: !!p.aircraft.is_ifr_equipped,
      };
      if (make) aircraftRow.make = make;
      if (model) aircraftRow.model = model;
      if (p.aircraft.home_airport) aircraftRow.home_airport = p.aircraft.home_airport.toUpperCase().trim();
      // time_zone is forwarded from the pilot's browser via Howard's
      // tool ctx (see propose_onboarding_setup handler). Without it
      // the column default kicks in ('UTC') and Howard quotes Zulu
      // times in every briefing until the pilot edits the aircraft.
      if (p.aircraft.time_zone) aircraftRow.time_zone = p.aircraft.time_zone;
      // Setup meters — match AircraftModal's "setup_*" convention.
      // total_* columns seed from setup_* so live totals start accurate
      // before the first flight log lands.
      if (p.aircraft.setup_aftt != null) {
        aircraftRow.setup_aftt = p.aircraft.setup_aftt;
        aircraftRow.total_airframe_time = p.aircraft.setup_aftt;
      }
      if (p.aircraft.setup_ftt != null) {
        aircraftRow.setup_ftt = p.aircraft.setup_ftt;
        aircraftRow.total_engine_time = p.aircraft.setup_ftt;
      }
      if (p.aircraft.setup_hobbs != null) {
        aircraftRow.setup_hobbs = p.aircraft.setup_hobbs;
        if (aircraftRow.total_airframe_time == null) aircraftRow.total_airframe_time = p.aircraft.setup_hobbs;
      }
      if (p.aircraft.setup_tach != null) {
        aircraftRow.setup_tach = p.aircraft.setup_tach;
        if (aircraftRow.total_engine_time == null) aircraftRow.total_engine_time = p.aircraft.setup_tach;
      }

      const { data: created, error: acErr } = await sb
        .from('aft_aircraft')
        .insert(aircraftRow)
        .select('id, tail_number')
        .single();
      if (acErr) {
        if ((acErr as any).code === '23505') {
          throw new Error(`An aircraft with tail number ${tailNorm} already exists.`);
        }
        throw acErr;
      }

      // 3. Grant the user admin on the aircraft they just registered.
      const { error: accessErr } = await sb
        .from('aft_user_aircraft_access')
        .insert({
          user_id: userId,
          aircraft_id: created.id,
          aircraft_role: 'admin',
        });
      if (accessErr) {
        // Roll back the aircraft insert so we don't leave an orphan.
        await sb.from('aft_aircraft').delete().eq('id', created.id);
        throw accessErr;
      }

      // 4. Now that everything stuck, flip the onboarding gate. A
      // failure here is non-fatal — the user has an aircraft and
      // access; they'll just see the welcome chat again, which is a
      // softer fallback than an empty-fleet stranded state.
      const { error: gateErr } = await sb
        .from('aft_user_roles')
        .update({ completed_onboarding: true })
        .eq('user_id', userId);
      if (gateErr) {
        console.error('[howard onboarding] could not flip completed_onboarding flag', gateErr);
      }

      return { recordId: created.id, recordTable: 'aft_aircraft' };
    }

    case 'mx_schedule': {
      const p = action.payload as MxSchedulePayload;
      // Pull aircraft for contact defaults. Throw on read error so a
      // transient blip doesn't silently emit a work-package email
      // with no mechanic / main contact wired up — the executor
      // would commit the event but the email would have empty TO/CC.
      const { data: ac, error: acErr } = await sb
        .from('aft_aircraft')
        .select('mx_contact, mx_contact_email, main_contact, main_contact_email')
        .eq('id', action.aircraft_id)
        .maybeSingle();
      if (acErr) throw acErr;

      const { data: event, error: evErr } = await sb
        .from('aft_maintenance_events')
        .insert({
          aircraft_id: action.aircraft_id,
          created_by: userId,
          status: 'draft',
          proposed_date: p.proposed_date || null,
          proposed_by: p.proposed_date ? 'owner' : null,
          addon_services: p.addon_services || [],
          mx_contact_name: ac?.mx_contact || null,
          mx_contact_email: ac?.mx_contact_email || null,
          primary_contact_name: ac?.main_contact || null,
          primary_contact_email: ac?.main_contact_email || null,
        } as any)
        .select('id')
        .single();
      if (evErr) throw evErr;
      const eventId = event.id;

      // Attach MX items and squawks as line items (same shape as
      // /api/mx-events/create). Three guards Howard's "I scheduled
      // 5 items" reply needs in order to be truthful:
      //   1. Throw on read error so a transient supabase blip doesn't
      //      silently land an event with zero line items reported as 5.
      //   2. Scope every lookup by aircraft_id — a malicious payload
      //      could pass mx_item_ids / squawk_ids that belong to a
      //      different aircraft the caller has access to, splicing
      //      foreign items into this aircraft's work package.
      //   3. Throw if any ID didn't resolve (deleted between propose
      //      and confirm, or fabricated) — better to fail the action
      //      than to land a partial event Howard says is complete.
      if (p.mx_item_ids && p.mx_item_ids.length > 0) {
        const { data: mxItems, error: mxErr } = await sb
          .from('aft_maintenance_items')
          .select('id, item_name, tracking_type, due_time, due_date')
          .in('id', p.mx_item_ids)
          .eq('aircraft_id', action.aircraft_id)
          .is('deleted_at', null);
        if (mxErr) throw mxErr;
        if ((mxItems?.length ?? 0) !== p.mx_item_ids.length) {
          const found = new Set((mxItems || []).map((m: any) => m.id));
          const missing = p.mx_item_ids.filter(id => !found.has(id));
          throw new Error(`Maintenance item${missing.length > 1 ? 's' : ''} no longer available: ${missing.join(', ')}. Re-propose the schedule.`);
        }
        const lineItems = (mxItems || []).map((mx: any) => ({
          event_id: eventId,
          item_type: 'maintenance',
          maintenance_item_id: mx.id,
          item_name: mx.item_name,
          item_description: mx.tracking_type === 'time'
            ? `Due at ${mx.due_time} hrs`
            : `Due on ${mx.due_date}`,
        }));
        if (lineItems.length > 0) {
          const { error: insErr } = await sb.from('aft_event_line_items').insert(lineItems);
          if (insErr) throw insErr;
        }
      }
      if (p.squawk_ids && p.squawk_ids.length > 0) {
        const { data: squawks, error: sqErr } = await sb
          .from('aft_squawks')
          .select('id, description, location')
          .in('id', p.squawk_ids)
          .eq('aircraft_id', action.aircraft_id)
          .is('deleted_at', null);
        if (sqErr) throw sqErr;
        if ((squawks?.length ?? 0) !== p.squawk_ids.length) {
          const found = new Set((squawks || []).map((s: any) => s.id));
          const missing = p.squawk_ids.filter(id => !found.has(id));
          throw new Error(`Squawk${missing.length > 1 ? 's' : ''} no longer available: ${missing.join(', ')}. Re-propose the schedule.`);
        }
        const lineItems = (squawks || []).map((sq: any) => ({
          event_id: eventId,
          item_type: 'squawk',
          squawk_id: sq.id,
          item_name: sq.description ? `Squawk: ${sq.description}` : `Squawk: ${sq.location || 'No description'}`,
        }));
        if (lineItems.length > 0) {
          const { error: insErr } = await sb.from('aft_event_line_items').insert(lineItems);
          if (insErr) throw insErr;
        }
      }

      return { recordId: eventId, recordTable: 'aft_maintenance_events' };
    }

    // ── Phase 1: logging actions ──────────────────────────────
    // Each delegates to the existing `submit*` helper in
    // submissions.ts so the validation, atomic insert, RLS bypass,
    // and audit hooks match exactly what the web/companion routes
    // produce. Howard's payload is shaped to be a valid input to
    // the corresponding validator.

    case 'flight_log': {
      const p = action.payload as FlightLogPayload;
      const input = validateFlightLogInput(p);
      // No aircraftUpdate — log_flight_atomic self-derives totals
      // from the latest-by-occurred_at log, which is the path the
      // Insert Missing Flight Log admin tool already relies on so
      // out-of-order replays don't poison the rolling totals.
      const result = await submitFlightLog(sb as any, userId, action.aircraft_id!, input, {});
      if (!result.logId) {
        throw new Error('Flight log insert returned no id.');
      }
      return { recordId: result.logId, recordTable: 'aft_flight_logs' };
    }

    case 'mx_item': {
      const p = action.payload as MaintenanceItemPayload;
      // Mirror the same validation that /api/maintenance-items POST
      // applies — tracking_type discrimination + numeric/date field
      // sanitization. The route's validateMxItemRow isn't exported,
      // so this is a close inline equivalent. Keep in sync.
      if (!p.item_name || typeof p.item_name !== 'string' || !p.item_name.trim()) {
        throw new Error('item_name is required.');
      }
      if (p.tracking_type !== 'time' && p.tracking_type !== 'date' && p.tracking_type !== 'both') {
        throw new Error('tracking_type must be "time", "date", or "both".');
      }
      const row: Record<string, any> = {
        aircraft_id: action.aircraft_id,
        item_name: p.item_name.trim().slice(0, 200),
        tracking_type: p.tracking_type,
        is_required: p.is_required ?? true,
        automate_scheduling: true,
        created_by: userId,
      };
      if (p.tracking_type === 'time' || p.tracking_type === 'both') {
        if (typeof p.time_interval !== 'number' || p.time_interval <= 0) {
          throw new Error('time_interval (hours) is required for time-based tracking.');
        }
        row.time_interval = p.time_interval;
        if (typeof p.last_completed_time === 'number' && p.last_completed_time >= 0) {
          row.last_completed_time = p.last_completed_time;
          row.due_time = p.last_completed_time + p.time_interval;
        }
      }
      if (p.tracking_type === 'date' || p.tracking_type === 'both') {
        if (typeof p.date_interval_days !== 'number' || p.date_interval_days <= 0) {
          throw new Error('date_interval_days is required for date-based tracking.');
        }
        row.date_interval_days = Math.trunc(p.date_interval_days);
        if (p.last_completed_date) {
          row.last_completed_date = p.last_completed_date;
          // Compute due_date = last_completed_date + interval. Cast to
          // ms then back to ISO YYYY-MM-DD so DB-side gets a clean
          // calendar date.
          const ms = Date.parse(`${p.last_completed_date}T00:00:00Z`);
          if (Number.isFinite(ms)) {
            const due = new Date(ms + p.date_interval_days * 86_400_000);
            row.due_date = due.toISOString().slice(0, 10);
          }
        }
      }
      if (p.far_reference) row.far_reference = String(p.far_reference).trim().slice(0, 50);
      if (p.notes) row.notes = String(p.notes).trim().slice(0, 1000);
      const { data, error } = await sb.from('aft_maintenance_items').insert(row).select('id').single();
      if (error) throw error;
      return { recordId: data.id, recordTable: 'aft_maintenance_items' };
    }

    case 'squawk': {
      const p = action.payload as SquawkPayload;
      // submitSquawk uses a wide allowlist + strips protected fields;
      // shape Howard's payload into what it expects.
      const input = validateSquawkInput({
        description: p.description,
        location: p.location || null,
        affects_airworthiness: !!p.affects_airworthiness,
        initials: p.initials,
        // Pictures path stays empty — Howard can't upload files via
        // chat. Field-team adds photos from the Squawks tab post-hoc
        // if needed. submitSquawk's pictures-bucket validator is happy
        // with an unset/empty pictures field.
        occurred_at: p.occurred_at || null,
      });
      const result = await submitSquawk(sb as any, userId, action.aircraft_id!, input);
      return { recordId: result.id, recordTable: 'aft_squawks' };
    }

    case 'vor_check': {
      const p = action.payload as VorCheckPayload;
      const input = validateVorCheckInput(p);
      const result = await submitVorCheck(sb as any, userId, action.aircraft_id!, input);
      return { recordId: result.id, recordTable: 'aft_vor_checks' };
    }

    case 'oil_log': {
      const p = action.payload as OilLogPayload;
      const input = validateOilLogInput({
        oil_qty: p.oil_qty,
        oil_added: p.oil_added ?? null,
        engine_hours: p.engine_hours,
        initials: p.initials,
        notes: p.notes ?? null,
        occurred_at: p.occurred_at ?? null,
      });
      const result = await submitOilLog(sb as any, userId, action.aircraft_id!, input);
      return { recordId: result.id, recordTable: 'aft_oil_logs' };
    }

    case 'tire_check': {
      const p = action.payload as TireCheckPayload;
      const input = validateTireCheckInput({
        nose_psi: p.nose_psi ?? null,
        left_main_psi: p.left_main_psi ?? null,
        right_main_psi: p.right_main_psi ?? null,
        initials: p.initials,
        notes: p.notes ?? null,
        occurred_at: p.occurred_at ?? null,
      });
      const result = await submitTireCheck(sb as any, userId, action.aircraft_id!, input);
      return { recordId: result.id, recordTable: 'aft_tire_checks' };
    }

    // ── Phase 2: admin / coordination actions ─────────────────

    case 'reservation_cancel': {
      const p = action.payload as ReservationCancelPayload;
      // Re-verify the reservation still exists, belongs to this
      // aircraft, and isn't already cancelled. The propose-time gate
      // catches the common path; this catches the propose-then-someone-
      // else-cancels-first race.
      const { data: res, error: resErr } = await sb
        .from('aft_reservations')
        .select('id, aircraft_id, user_id, status')
        .eq('id', p.reservation_id)
        .maybeSingle();
      if (resErr) throw resErr;
      if (!res || res.aircraft_id !== action.aircraft_id) {
        throw new Error('Reservation not found on this aircraft.');
      }
      if (res.status === 'cancelled') {
        throw new Error('Reservation was already cancelled.');
      }
      // Permission: own reservation OR aircraft admin OR global admin.
      // The propose handler enforces the same gate up front; re-check
      // at execute time so a mid-window role revocation can't ride
      // through a stale proposal.
      const isOwner = res.user_id === userId;
      if (!isOwner) {
        const { data: callerRole } = await sb
          .from('aft_user_roles')
          .select('role')
          .eq('user_id', userId)
          .maybeSingle();
        const isGlobalAdmin = callerRole?.role === 'admin';
        if (!isGlobalAdmin) {
          const { data: callerAccess } = await sb
            .from('aft_user_aircraft_access')
            .select('aircraft_role')
            .eq('user_id', userId)
            .eq('aircraft_id', action.aircraft_id)
            .maybeSingle();
          if (!callerAccess || callerAccess.aircraft_role !== 'admin') {
            throw new Error('You can only cancel your own reservations.');
          }
        }
      }
      // Status='confirmed' guard mirrors the DELETE route — a concurrent
      // PUT can't slip a stale cancel onto a row whose new times just
      // landed.
      const { error: cancelErr, count: cancelCount } = await sb
        .from('aft_reservations')
        .update(
          {
            status: 'cancelled',
            ...(p.reason ? { notes: p.reason.slice(0, 500) } : {}),
          },
          { count: 'exact' },
        )
        .eq('id', p.reservation_id)
        .eq('aircraft_id', action.aircraft_id)
        .eq('status', 'confirmed');
      if (cancelErr) throw cancelErr;
      if (cancelCount === 0) {
        throw new Error('Reservation could not be cancelled (already cancelled or modified).');
      }
      // Re-read the full reservation row so the email helper has the
      // booker's stored timezone + pilot_name. The earlier read only
      // pulled id/aircraft_id/user_id/status for the permission gate.
      const { data: fullRes } = await sb
        .from('aft_reservations')
        .select('id, aircraft_id, user_id, start_time, end_time, time_zone, pilot_name')
        .eq('id', p.reservation_id)
        .maybeSingle();
      if (fullRes) {
        // Fail-soft: the helper logs internally if it can't fan out.
        // The cancellation itself already counted, so we don't undo it
        // on a transient Resend blip.
        await sendReservationCancelledEmail(sb, fullRes as any, {
          excludeUserId: userId,
        });
      }
      return { recordId: p.reservation_id, recordTable: 'aft_reservations' };
    }

    case 'squawk_defer': {
      const p = action.payload as SquawkDeferPayload;
      // Mirror the route's read gate: squawk exists, belongs to this
      // aircraft, not soft-deleted, not already resolved or deferred.
      const { data: sq, error: sqErr } = await sb
        .from('aft_squawks')
        .select('id, aircraft_id, deleted_at, status, is_deferred')
        .eq('id', p.squawk_id)
        .maybeSingle();
      if (sqErr) throw sqErr;
      if (!sq || sq.aircraft_id !== action.aircraft_id || sq.deleted_at) {
        throw new Error('Squawk not found on this aircraft.');
      }
      if (sq.status === 'resolved') {
        throw new Error('Squawk is already resolved — can\'t defer a closed issue.');
      }
      if (sq.is_deferred) {
        throw new Error('Squawk is already deferred. Edit from the Squawks tab if details need updating.');
      }
      const category = p.deferral_category;
      const VALID_CATS = ['MEL', 'CDL', 'NEF', 'MDL'];
      if (!VALID_CATS.includes(category)) {
        throw new Error(`deferral_category must be one of: ${VALID_CATS.join(', ')}.`);
      }
      if (!p.deferral_procedures_completed) {
        throw new Error('Deferral procedures must be completed per §91.213 before deferring. Confirm with the PIC.');
      }
      const updateRow: Record<string, any> = {
        is_deferred: true,
        deferral_category: category,
        deferral_procedures_completed: true,
        // affects_airworthiness stays true — the airplane is still
        // operating under a deferral, just legally. The grounding
        // calculus accounts for is_deferred separately.
      };
      // Only stamp the matching number field for the chosen category.
      // Empty strings on the other fields would clobber prior values
      // if the squawk had been touched before; using null keeps the
      // intent explicit.
      if (category === 'MEL') updateRow.mel_number = (p.mel_number || '').slice(0, 50);
      if (category === 'CDL') updateRow.cdl_number = (p.cdl_number || '').slice(0, 50);
      if (category === 'NEF') updateRow.nef_number = (p.nef_number || '').slice(0, 50);
      if (category === 'MDL') updateRow.mdl_number = (p.mdl_number || '').slice(0, 50);
      if (p.mel_control_number) updateRow.mel_control_number = String(p.mel_control_number).slice(0, 50);
      if (p.full_name) updateRow.full_name = String(p.full_name).slice(0, 100);
      if (p.certificate_number) updateRow.certificate_number = String(p.certificate_number).slice(0, 50);
      const { error: updErr } = await sb
        .from('aft_squawks')
        .update(updateRow)
        .eq('id', p.squawk_id)
        .eq('aircraft_id', action.aircraft_id)
        .is('deleted_at', null);
      if (updErr) throw updErr;
      return { recordId: p.squawk_id, recordTable: 'aft_squawks' };
    }

    case 'pilot_invite': {
      const p = action.payload as PilotInvitePayload;
      // Mirror /api/pilot-invite's two-path logic so an admin inviting
      // via Howard gets the same outcome as the AdminModals form.
      const emailLc = p.email.toLowerCase().trim();
      const { data: existingUsers, error: exErr } = await sb
        .from('aft_user_roles')
        .select('user_id, email')
        .eq('email', emailLc);
      if (exErr) throw exErr;

      if (existingUsers && existingUsers.length > 0) {
        const targetUserId = existingUsers[0].user_id;
        // No-op when the user already has the requested role — avoid
        // a confusing "invited!" toast when nothing changed.
        const { data: existingAccess } = await sb
          .from('aft_user_aircraft_access')
          .select('aircraft_role')
          .eq('user_id', targetUserId)
          .eq('aircraft_id', action.aircraft_id)
          .maybeSingle();
        if (existingAccess && existingAccess.aircraft_role === p.aircraft_role) {
          throw new Error('This pilot already has the requested access on this aircraft.');
        }
        const { error: upErr } = await sb
          .from('aft_user_aircraft_access')
          .upsert(
            { user_id: targetUserId, aircraft_id: action.aircraft_id, aircraft_role: p.aircraft_role },
            { onConflict: 'user_id,aircraft_id' },
          );
        if (upErr) throw upErr;
        return { recordId: targetUserId, recordTable: 'aft_user_aircraft_access' };
      }

      // New-user path: invite via Supabase Auth, then upsert role + access.
      // The auth client supports `inviteUserByEmail` on the admin namespace.
      const sbAdmin = sb as any;
      const appOrigin = process.env.NEXT_PUBLIC_APP_URL || 'https://track.skywardsociety.com';
      const { data: inviteData, error: inviteErr } = await sbAdmin.auth.admin.inviteUserByEmail(emailLc, {
        redirectTo: `${appOrigin}/update-password`,
      });
      if (inviteErr) {
        const status = (inviteErr as any).status;
        const msg = (inviteErr as any).message || '';
        if (status === 429 || /rate limit/i.test(msg)) {
          throw new Error('Supabase Auth invite rate limit hit. Wait a few minutes and retry.');
        }
        throw inviteErr;
      }
      if (!inviteData?.user?.id) {
        throw new Error('Invite succeeded but no user ID was returned. Retry.');
      }
      const targetUserId = inviteData.user.id;
      const { error: roleErr } = await sb.from('aft_user_roles').upsert({
        user_id: targetUserId,
        role: 'pilot',
        email: emailLc,
        completed_onboarding: true,
      });
      if (roleErr) throw roleErr;
      const { error: accessErr } = await sb
        .from('aft_user_aircraft_access')
        .upsert(
          { user_id: targetUserId, aircraft_id: action.aircraft_id, aircraft_role: p.aircraft_role },
          { onConflict: 'user_id,aircraft_id' },
        );
      if (accessErr) throw accessErr;
      return { recordId: targetUserId, recordTable: 'aft_user_aircraft_access' };
    }

    case 'aircraft_update': {
      const p = action.payload as AircraftUpdatePayload;
      // Only the allowlisted fields actually land in the UPDATE — even
      // if a malicious payload smuggles in `tail_number` or `engine_type`
      // (which would break the calculation pipeline), the destructure
      // below drops it. Mirror AircraftModal's basePayload conventions:
      // ICAO uppercased, empty strings become null.
      const updateRow: Record<string, any> = {};
      if (p.home_airport !== undefined) {
        const ha = String(p.home_airport).trim().toUpperCase();
        updateRow.home_airport = ha || null;
      }
      if (p.time_zone !== undefined) {
        updateRow.time_zone = String(p.time_zone).trim() || 'UTC';
      }
      if (p.is_ifr_equipped !== undefined) {
        updateRow.is_ifr_equipped = !!p.is_ifr_equipped;
      }
      if (p.main_contact !== undefined) {
        updateRow.main_contact = String(p.main_contact).trim() || null;
      }
      if (p.main_contact_phone !== undefined) {
        updateRow.main_contact_phone = String(p.main_contact_phone).trim() || null;
      }
      if (p.main_contact_email !== undefined) {
        updateRow.main_contact_email = String(p.main_contact_email).trim().toLowerCase() || null;
      }
      if (p.mx_contact !== undefined) {
        updateRow.mx_contact = String(p.mx_contact).trim() || null;
      }
      if (p.mx_contact_phone !== undefined) {
        updateRow.mx_contact_phone = String(p.mx_contact_phone).trim() || null;
      }
      if (p.mx_contact_email !== undefined) {
        updateRow.mx_contact_email = String(p.mx_contact_email).trim().toLowerCase() || null;
      }
      if (Object.keys(updateRow).length === 0) {
        throw new Error('No fields to update.');
      }
      const { error: updErr } = await sb
        .from('aft_aircraft')
        .update(updateRow)
        .eq('id', action.aircraft_id);
      if (updErr) throw updErr;
      return { recordId: action.aircraft_id!, recordTable: 'aft_aircraft' };
    }
  }
}

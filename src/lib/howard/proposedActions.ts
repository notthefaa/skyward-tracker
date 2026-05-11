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

export type ActionType =
  | 'reservation'
  | 'mx_schedule'
  | 'squawk_resolve'
  | 'note'
  | 'equipment'
  | 'onboarding_setup';

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
      const profileFields: Record<string, any> = {
        user_id: userId,
        full_name: p.profile.full_name.trim(),
        initials: p.profile.initials.toUpperCase().slice(0, 3),
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
      // table, predates the make/model split). The manual form takes
      // it as a single field; Howard collects make + model separately
      // and we synthesize it here. Fall back to engine_type so the
      // INSERT never violates the NOT NULL — leaving this empty before
      // the fix bounced every Howard-onboarded user with a 500.
      const aircraftType = [make, model].filter(Boolean).join(' ').trim()
        || `${p.aircraft.engine_type} aircraft`;
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
  }
}

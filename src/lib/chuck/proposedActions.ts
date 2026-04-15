// =============================================================
// CHUCK PROPOSED ACTIONS — propose-confirm write model
// =============================================================
// Chuck can't write directly. Every write action flows through:
//   1. Chuck calls a propose_* tool → this module inserts a row in
//      aft_proposed_actions with status='pending', returns the id.
//   2. The UI renders a confirmation card in chat.
//   3. User taps Confirm → /api/chuck/actions/[id] POST → executeAction()
//      runs the actual write using existing API logic.
//   4. User taps Cancel → /api/chuck/actions/[id] DELETE → status='cancelled'.
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
  | 'equipment';

export type RequiredRole = 'access' | 'admin';

export interface ProposedAction {
  id: string;
  thread_id: string;
  message_id: string | null;
  user_id: string;
  aircraft_id: string;
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

// Payload shapes — documented here so Chuck's tool schemas and the
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
  }
}

/**
 * Insert a proposed action. Called by the Chuck propose_* tool handlers.
 * Returns the id + summary so Chuck can reference it in its reply.
 */
export async function proposeAction(
  sb: SupabaseClient,
  params: {
    threadId: string;
    userId: string;
    aircraftId: string;
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
 * at the /api/chuck/actions endpoint before this runs).
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
      // Verify the squawk belongs to the current aircraft.
      const { data: sq } = await sb
        .from('aft_squawks')
        .select('id, aircraft_id, deleted_at')
        .eq('id', p.squawk_id)
        .maybeSingle();
      if (!sq || sq.aircraft_id !== action.aircraft_id || sq.deleted_at) {
        throw new Error('Squawk not found for this aircraft.');
      }
      const { error } = await sb
        .from('aft_squawks')
        .update({
          status: 'resolved',
          affects_airworthiness: false,
          resolved_note: p.resolution_note,
        })
        .eq('id', p.squawk_id);
      if (error) throw error;
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

    case 'mx_schedule': {
      const p = action.payload as MxSchedulePayload;
      // Pull aircraft for contact defaults.
      const { data: ac } = await sb
        .from('aft_aircraft')
        .select('mx_contact, mx_contact_email, main_contact, main_contact_email')
        .eq('id', action.aircraft_id)
        .maybeSingle();

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

      // Attach MX items and squawks as line items (same shape as /api/mx-events/create).
      if (p.mx_item_ids && p.mx_item_ids.length > 0) {
        const { data: mxItems } = await sb.from('aft_maintenance_items')
          .select('*').in('id', p.mx_item_ids).is('deleted_at', null);
        const lineItems = (mxItems || []).map((mx: any) => ({
          event_id: eventId,
          item_type: 'maintenance',
          maintenance_item_id: mx.id,
          item_name: mx.item_name,
          item_description: mx.tracking_type === 'time'
            ? `Due at ${mx.due_time} hrs`
            : `Due on ${mx.due_date}`,
        }));
        if (lineItems.length > 0) await sb.from('aft_event_line_items').insert(lineItems);
      }
      if (p.squawk_ids && p.squawk_ids.length > 0) {
        const { data: squawks } = await sb.from('aft_squawks')
          .select('*').in('id', p.squawk_ids).is('deleted_at', null);
        const lineItems = (squawks || []).map((sq: any) => ({
          event_id: eventId,
          item_type: 'squawk',
          squawk_id: sq.id,
          item_name: sq.description ? `Squawk: ${sq.description}` : `Squawk: ${sq.location || 'No description'}`,
        }));
        if (lineItems.length > 0) await sb.from('aft_event_line_items').insert(lineItems);
      }

      return { recordId: eventId, recordTable: 'aft_maintenance_events' };
    }
  }
}

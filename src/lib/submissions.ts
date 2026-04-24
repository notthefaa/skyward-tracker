// =============================================================
// Shared submission handlers for companion-app-queued log types.
//
// Each function validates its payload, verifies aircraft access,
// and writes a row. Called by the individual routes (e.g.
// /api/oil-logs) AND by the batch endpoint (/api/batch-submit)
// so a queue-flush can push mixed types in a single round-trip.
//
// Validation errors throw CodedError with a stable machine code
// so the companion app can switch on it.
//
// Every handler accepts an optional `occurred_at` (client-supplied
// ISO string). Absent → the DB default `now()` fires. Present →
// respected verbatim, which is what makes out-of-order offline
// queue replay safe: the event's real timestamp is preserved,
// and dials / compliance math sort by occurred_at (not by
// created_at, which is always "server saw it just now").
// =============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { CodedError } from './apiResponse';
import { setAppUser } from './audit';
import { stripProtectedFields } from './validation';
import { isIsoDateTime } from './validation';

type AdminClient = SupabaseClient<any, any, any>;

// ─── occurred_at helper ─────────────────────────────────────

/**
 * Validate and normalize a client-supplied occurred_at. Returns
 * the ISO string (DB coerces to timestamptz) or null to let the
 * DB default fire. Throws on garbage.
 */
function normalizeOccurredAt(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') {
    throw new CodedError('VALIDATION_ERROR', 'occurred_at must be an ISO datetime string.', 400);
  }
  if (!isIsoDateTime(raw)) {
    throw new CodedError('VALIDATION_ERROR', 'occurred_at must be an ISO datetime with timezone (e.g. 2026-04-24T14:30:00Z).', 400);
  }
  // Reject future-dated submissions beyond a clock-skew buffer.
  // Android/iOS can drift 5-10 minutes without NTP sync, especially
  // after airplane-mode cycles. 10 minutes is the compromise: loose
  // enough for real-world phone clocks, tight enough to catch
  // intentionally-backfilled-forward compliance games.
  const t = Date.parse(raw);
  if (t > Date.now() + 10 * 60 * 1000) {
    throw new CodedError('VALIDATION_ERROR', 'occurred_at is in the future.', 400);
  }
  return raw;
}

// ─── shared validation helpers ──────────────────────────────

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CodedError('VALIDATION_ERROR', `${field} is required.`, 400);
  }
  return value.trim();
}

function requireFiniteNumber(value: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new CodedError('VALIDATION_ERROR', `${field} must be a finite number.`, 400);
  }
  if (opts.min !== undefined && num < opts.min) {
    throw new CodedError('VALIDATION_ERROR', `${field} must be ≥ ${opts.min}.`, 400);
  }
  if (opts.max !== undefined && num > opts.max) {
    throw new CodedError('VALIDATION_ERROR', `${field} must be ≤ ${opts.max}.`, 400);
  }
  return num;
}

function optionalFiniteNumber(value: unknown, field: string, opts: { min?: number } = {}): number | null {
  if (value === null || value === undefined || value === '') return null;
  return requireFiniteNumber(value, field, opts);
}

// ─── flight log ─────────────────────────────────────────────

export interface FlightLogInput {
  pod?: string | null;
  poa?: string | null;
  initials?: string | null;
  ftt?: unknown;
  tach?: unknown;
  aftt?: unknown;
  hobbs?: unknown;
  landings?: unknown;
  engine_cycles?: unknown;
  fuel_gallons?: unknown;
  trip_reason?: string | null;
  pax_info?: string | null;
  occurred_at?: string;
}

/**
 * Validate flight-log numeric fields. Mirrors validateLogData() in
 * the individual route; kept here so the batch endpoint can share it.
 */
export function validateFlightLogInput(raw: unknown): FlightLogInput {
  if (!raw || typeof raw !== 'object') {
    throw new CodedError('VALIDATION_ERROR', 'Invalid log data.', 400);
  }
  const d = raw as Record<string, unknown>;
  const numericFields = ['landings', 'engine_cycles', 'tach', 'ftt', 'hobbs', 'aftt', 'fuel_gallons'];
  for (const field of numericFields) {
    const v = d[field];
    if (v === null || v === undefined || v === '') continue;
    const num = Number(v);
    if (!Number.isFinite(num) || num < 0) {
      throw new CodedError('VALIDATION_ERROR', `Invalid ${field}: must be a finite non-negative number.`, 400);
    }
  }
  return { ...(d as FlightLogInput), occurred_at: normalizeOccurredAt(d.occurred_at) ?? undefined };
}

export async function submitFlightLog(
  sb: AdminClient,
  userId: string,
  aircraftId: string,
  logData: FlightLogInput,
  aircraftUpdate: Record<string, unknown>,
): Promise<{ logId?: string; isLatest?: boolean }> {
  const { data, error } = await sb.rpc('log_flight_atomic', {
    p_aircraft_id: aircraftId,
    p_user_id: userId,
    p_log_data: logData ?? {},
    p_aircraft_update: aircraftUpdate ?? {},
  });
  if (error) {
    const status = error.code === 'P0002' ? 404 : error.code === 'P0001' ? 400 : 500;
    const code =
      error.code === 'P0002' ? 'AIRCRAFT_NOT_FOUND'
      : error.code === 'P0001' ? 'IMPLAUSIBLE_DELTA'
      : 'INTERNAL_ERROR';
    throw new CodedError(code, error.message, status);
  }
  return {
    logId: (data as any)?.log_id,
    isLatest: (data as any)?.is_latest,
  };
}

// ─── VOR check ──────────────────────────────────────────────

const VOR_TOLERANCES: Record<string, number> = {
  'VOT': 4,
  'Ground Checkpoint': 4,
  'Airborne Checkpoint': 6,
  'Dual VOR': 4,
};

export interface VorCheckInput {
  check_type: string;
  station: string;
  bearing_error: number;
  initials: string;
  occurred_at?: string | null;
}

export function validateVorCheckInput(raw: unknown): VorCheckInput {
  if (!raw || typeof raw !== 'object') {
    throw new CodedError('VALIDATION_ERROR', 'Invalid log data.', 400);
  }
  const d = raw as Record<string, unknown>;
  const check_type = requireString(d.check_type, 'check_type');
  if (!(check_type in VOR_TOLERANCES)) {
    throw new CodedError('VALIDATION_ERROR', 'Invalid check type.', 400);
  }
  const station = requireString(d.station, 'station');
  const initials = requireString(d.initials, 'initials').toUpperCase();
  const bearing_error = requireFiniteNumber(d.bearing_error, 'bearing_error');
  return {
    check_type,
    station,
    initials,
    bearing_error,
    occurred_at: normalizeOccurredAt(d.occurred_at),
  };
}

export async function submitVorCheck(
  sb: AdminClient,
  userId: string,
  aircraftId: string,
  input: VorCheckInput,
): Promise<{ id: string; passed: boolean }> {
  const tolerance = VOR_TOLERANCES[input.check_type];
  const passed = Math.abs(input.bearing_error) <= tolerance;
  await setAppUser(sb, userId);
  const { data, error } = await sb.from('aft_vor_checks').insert({
    aircraft_id: aircraftId,
    user_id: userId,
    check_type: input.check_type,
    station: input.station,
    bearing_error: input.bearing_error,
    tolerance,
    passed,
    initials: input.initials,
    ...(input.occurred_at ? { occurred_at: input.occurred_at } : {}),
  }).select('id').single();
  if (error) throw new CodedError('INTERNAL_ERROR', error.message, 500);
  return { id: data!.id, passed };
}

// ─── Oil log ────────────────────────────────────────────────

export interface OilLogInput {
  oil_qty: number;
  oil_added: number | null;
  engine_hours: number;
  initials: string;
  notes: string | null;
  occurred_at?: string | null;
}

export function validateOilLogInput(raw: unknown): OilLogInput {
  if (!raw || typeof raw !== 'object') {
    throw new CodedError('VALIDATION_ERROR', 'Invalid log data.', 400);
  }
  const d = raw as Record<string, unknown>;
  const initials = requireString(d.initials, 'initials').toUpperCase();
  const oil_qty = requireFiniteNumber(d.oil_qty, 'oil_qty', { min: 0 });
  const engine_hours = requireFiniteNumber(d.engine_hours, 'engine_hours', { min: 0 });
  const oil_added = optionalFiniteNumber(d.oil_added, 'oil_added', { min: 0 });
  const notesRaw = d.notes;
  const notes = (typeof notesRaw === 'string' && notesRaw.trim()) ? notesRaw.trim() : null;
  return {
    oil_qty,
    oil_added,
    engine_hours,
    initials,
    notes,
    occurred_at: normalizeOccurredAt(d.occurred_at),
  };
}

export async function submitOilLog(
  sb: AdminClient,
  userId: string,
  aircraftId: string,
  input: OilLogInput,
): Promise<{ id: string }> {
  await setAppUser(sb, userId);
  const { data, error } = await sb.from('aft_oil_logs').insert({
    aircraft_id: aircraftId,
    user_id: userId,
    oil_qty: input.oil_qty,
    oil_added: input.oil_added,
    engine_hours: input.engine_hours,
    initials: input.initials,
    notes: input.notes,
    ...(input.occurred_at ? { occurred_at: input.occurred_at } : {}),
  }).select('id').single();
  if (error) throw new CodedError('INTERNAL_ERROR', error.message, 500);
  return { id: data!.id };
}

// ─── Tire check ─────────────────────────────────────────────

export interface TireCheckInput {
  nose_psi: number | null;
  left_main_psi: number | null;
  right_main_psi: number | null;
  initials: string;
  notes: string | null;
  occurred_at?: string | null;
}

export function validateTireCheckInput(raw: unknown): TireCheckInput {
  if (!raw || typeof raw !== 'object') {
    throw new CodedError('VALIDATION_ERROR', 'Invalid log data.', 400);
  }
  const d = raw as Record<string, unknown>;
  const initials = requireString(d.initials, 'initials').toUpperCase();
  const nose_psi = optionalFiniteNumber(d.nose_psi, 'nose_psi', { min: 0 });
  const left_main_psi = optionalFiniteNumber(d.left_main_psi, 'left_main_psi', { min: 0 });
  const right_main_psi = optionalFiniteNumber(d.right_main_psi, 'right_main_psi', { min: 0 });
  const notesRaw = d.notes;
  const notes = (typeof notesRaw === 'string' && notesRaw.trim()) ? notesRaw.trim() : null;
  return {
    nose_psi,
    left_main_psi,
    right_main_psi,
    initials,
    notes,
    occurred_at: normalizeOccurredAt(d.occurred_at),
  };
}

export async function submitTireCheck(
  sb: AdminClient,
  userId: string,
  aircraftId: string,
  input: TireCheckInput,
): Promise<{ id: string }> {
  await setAppUser(sb, userId);
  const { data, error } = await sb.from('aft_tire_checks').insert({
    aircraft_id: aircraftId,
    user_id: userId,
    nose_psi: input.nose_psi,
    left_main_psi: input.left_main_psi,
    right_main_psi: input.right_main_psi,
    initials: input.initials,
    notes: input.notes,
    ...(input.occurred_at ? { occurred_at: input.occurred_at } : {}),
  }).select('id').single();
  if (error) throw new CodedError('INTERNAL_ERROR', error.message, 500);
  return { id: data!.id };
}

// ─── Squawk ─────────────────────────────────────────────────

export interface SquawkInput {
  [key: string]: unknown;
  occurred_at?: string | null;
}

export function validateSquawkInput(raw: unknown): SquawkInput {
  if (!raw || typeof raw !== 'object') {
    throw new CodedError('VALIDATION_ERROR', 'Invalid squawk data.', 400);
  }
  const d = raw as Record<string, unknown>;
  // Squawks use a wide allowlist historically (stripProtectedFields
  // removes server-owned ones). We just normalize occurred_at here
  // and pass the rest through — existing insert path does the rest.
  return {
    ...d,
    occurred_at: normalizeOccurredAt(d.occurred_at),
  };
}

export async function submitSquawk(
  sb: AdminClient,
  userId: string,
  aircraftId: string,
  input: SquawkInput,
): Promise<{ id: string; row: any }> {
  await setAppUser(sb, userId);
  const { occurred_at, ...rest } = input;
  const safeSquawk = stripProtectedFields(rest);
  const payload: any = { ...safeSquawk, aircraft_id: aircraftId, reported_by: userId };
  if (occurred_at) payload.occurred_at = occurred_at;
  const { data, error } = await sb
    .from('aft_squawks')
    .insert(payload)
    .select()
    .single();
  if (error) throw new CodedError('INTERNAL_ERROR', error.message, 500);
  return { id: data!.id, row: data };
}

// `requireAircraftAccessCoded` lives in ./submissionAuth — it has to
// import from ./auth (which pulls in env at module load), so keeping
// it out of this file means the validators here stay testable without
// spinning up the full Supabase env.

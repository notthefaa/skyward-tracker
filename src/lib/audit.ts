// =============================================================
// AUDIT HELPERS — attribute writes to the authenticated user
// and perform soft-deletes on retention-tracked tables.
//
// The generic trigger `log_record_history` (migration 009)
// reads `app.current_user_id` to fill in user_id on each row.
// Every API route that writes to a tracked table must call
// setAppUser() first — otherwise history rows have a NULL user.
// =============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Attach the current authenticated user to the Postgres session so the
 * history trigger captures who made the change.
 *
 * Safe to call repeatedly. Non-blocking on failure (we log and continue
 * rather than failing writes just because audit attribution broke).
 */
export async function setAppUser(sb: SupabaseClient, userId: string): Promise<void> {
  try {
    await sb.rpc('set_app_user', { p_user_id: userId });
  } catch (err) {
    console.warn('[audit] setAppUser failed:', err);
  }
}

/**
 * Soft-delete a row by stamping `deleted_at` and `deleted_by`.
 * Returns the error (or null) so callers can propagate.
 *
 * Call setAppUser(sb, userId) first so the UPDATE trigger attributes
 * correctly in aft_record_history.
 */
export async function softDelete(
  sb: SupabaseClient,
  table: string,
  column: string,
  value: string | string[],
  userId: string,
): Promise<{ error: any }> {
  await setAppUser(sb, userId);
  const q = sb
    .from(table)
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId });
  const { error } = Array.isArray(value)
    ? await q.in(column, value).is('deleted_at', null)
    : await q.eq(column, value).is('deleted_at', null);
  return { error };
}

/**
 * List of tables that use soft-delete. Keep in sync with migration 009.
 * Anything outside this list can be hard-deleted (howard messages,
 * user access grants, note_reads, preferences).
 */
export const SOFT_DELETE_TABLES = new Set<string>([
  'aft_aircraft',
  'aft_flight_logs',
  'aft_maintenance_items',
  'aft_maintenance_events',
  'aft_event_line_items',
  'aft_squawks',
  'aft_vor_checks',
  'aft_tire_checks',
  'aft_oil_logs',
  'aft_notes',
  'aft_documents',
]);

-- =============================================================
-- Migration 022: Atomic flight-log DELETE (+ aircraft-totals update)
-- =============================================================
-- DELETE /flight-logs previously ran two separate UPDATEs:
--   1) soft-delete the log row
--   2) (optionally) roll back aircraft totals
-- with no error check on the second. A failure on step 2 left the
-- log soft-deleted but totals still reflecting the "deleted" flight,
-- drifting aircraft hours out of sync.
--
-- This RPC locks the aircraft row, applies the soft-delete, applies
-- the aircraft-totals update, and attributes the session user for
-- the history trigger — all in one transaction. A failure on either
-- side rolls both back.
--
-- Mirrors edit_flight_log_atomic (migration 021).
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION delete_flight_log_atomic(
  p_log_id          uuid,
  p_aircraft_id     uuid,
  p_user_id         uuid,
  p_aircraft_update jsonb
) RETURNS jsonb AS $$
DECLARE
  v_log_aircraft uuid;
  v_already_deleted timestamptz;
BEGIN
  -- Lock the aircraft row so a concurrent POST can't interleave.
  PERFORM 1 FROM aft_aircraft
   WHERE id = p_aircraft_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aircraft not found' USING ERRCODE = 'P0002';
  END IF;

  -- Verify the log exists and belongs to this aircraft.
  SELECT aircraft_id, deleted_at INTO v_log_aircraft, v_already_deleted
    FROM aft_flight_logs
   WHERE id = p_log_id;
  IF v_log_aircraft IS NULL THEN
    RAISE EXCEPTION 'Flight log not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_log_aircraft <> p_aircraft_id THEN
    RAISE EXCEPTION 'Flight log does not belong to the given aircraft'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_already_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'Flight log is already deleted' USING ERRCODE = 'P0001';
  END IF;

  -- Attribute this transaction for the history trigger.
  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  -- Soft-delete the log row.
  UPDATE aft_flight_logs
     SET deleted_at = now(),
         deleted_by = p_user_id
   WHERE id = p_log_id;

  -- Roll back aircraft totals to the caller-computed previous values
  -- (e.g. the next-most-recent log). Only fields present in the
  -- payload are touched; absent fields stay untouched.
  IF p_aircraft_update IS NOT NULL AND p_aircraft_update <> '{}'::jsonb THEN
    UPDATE aft_aircraft SET
      total_airframe_time = coalesce(
        nullif(p_aircraft_update->>'total_airframe_time', '')::numeric,
        total_airframe_time
      ),
      total_engine_time = coalesce(
        nullif(p_aircraft_update->>'total_engine_time', '')::numeric,
        total_engine_time
      ),
      current_fuel_gallons = coalesce(
        nullif(p_aircraft_update->>'current_fuel_gallons', '')::numeric,
        current_fuel_gallons
      ),
      fuel_last_updated = coalesce(
        nullif(p_aircraft_update->>'fuel_last_updated', '')::timestamptz,
        fuel_last_updated
      )
    WHERE id = p_aircraft_id;
  END IF;

  RETURN jsonb_build_object('log_id', p_log_id, 'success', true);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION delete_flight_log_atomic(uuid, uuid, uuid, jsonb)
  TO authenticated, service_role;

COMMIT;

-- =============================================================
-- Migration 021: Atomic flight-log EDIT (+ aircraft-totals update)
-- =============================================================
-- PUT /flight-logs previously ran two separate UPDATEs with no
-- error check on the second. If the aircraft update failed, the
-- log row was already persisted and totals drifted out of sync.
--
-- This RPC wraps both updates in one transaction and attributes
-- the change to the caller for the history trigger. Unlike the
-- POST path (log_flight_atomic), edit does NOT enforce
-- monotonicity or the 24hr bound — admins edit to correct prior
-- mistakes, which may legitimately move totals backward.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION edit_flight_log_atomic(
  p_log_id          uuid,
  p_aircraft_id     uuid,
  p_user_id         uuid,
  p_log_data        jsonb,
  p_aircraft_update jsonb
) RETURNS jsonb AS $$
DECLARE
  v_log_aircraft uuid;
BEGIN
  -- Lock the aircraft row so a concurrent POST can't interleave.
  PERFORM 1 FROM aft_aircraft
   WHERE id = p_aircraft_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aircraft not found' USING ERRCODE = 'P0002';
  END IF;

  -- Verify the log belongs to this aircraft (defense in depth).
  SELECT aircraft_id INTO v_log_aircraft
  FROM aft_flight_logs
  WHERE id = p_log_id AND deleted_at IS NULL;
  IF v_log_aircraft IS NULL THEN
    RAISE EXCEPTION 'Flight log not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_log_aircraft <> p_aircraft_id THEN
    RAISE EXCEPTION 'Flight log does not belong to the given aircraft'
      USING ERRCODE = 'P0001';
  END IF;

  -- Attribute this transaction for the history trigger.
  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  -- Update log — only fields present in the payload are touched.
  -- Using coalesce lets the caller omit fields they don't want to change.
  UPDATE aft_flight_logs SET
    pod           = coalesce(p_log_data->>'pod', pod),
    poa           = coalesce(p_log_data->>'poa', poa),
    initials      = coalesce(p_log_data->>'initials', initials),
    ftt           = coalesce(nullif(p_log_data->>'ftt', '')::numeric, ftt),
    tach          = coalesce(nullif(p_log_data->>'tach', '')::numeric, tach),
    aftt          = coalesce(nullif(p_log_data->>'aftt', '')::numeric, aftt),
    hobbs         = coalesce(nullif(p_log_data->>'hobbs', '')::numeric, hobbs),
    landings      = coalesce(nullif(p_log_data->>'landings', '')::int, landings),
    engine_cycles = coalesce(nullif(p_log_data->>'engine_cycles', '')::int, engine_cycles),
    fuel_gallons  = coalesce(nullif(p_log_data->>'fuel_gallons', '')::numeric, fuel_gallons),
    trip_reason   = coalesce(p_log_data->>'trip_reason', trip_reason),
    pax_info      = coalesce(p_log_data->>'pax_info', pax_info)
  WHERE id = p_log_id;

  -- Update aircraft totals (only fields present in the payload).
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

GRANT EXECUTE ON FUNCTION edit_flight_log_atomic(uuid, uuid, uuid, jsonb, jsonb)
  TO authenticated, service_role;

COMMIT;

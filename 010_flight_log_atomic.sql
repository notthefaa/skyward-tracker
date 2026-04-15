-- =============================================================
-- Migration 010: Atomic flight-log insert + aircraft-totals update
-- =============================================================
-- Prevents two simultaneous log writes from clobbering aircraft
-- totals. Enforces time monotonicity and a 24-hr/log sanity bound.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION log_flight_atomic(
  p_aircraft_id uuid,
  p_user_id uuid,
  p_log_data jsonb,
  p_aircraft_update jsonb
) RETURNS jsonb AS $$
DECLARE
  v_current_aftt numeric;
  v_current_ftt  numeric;
  v_new_aftt     numeric;
  v_new_ftt      numeric;
  v_new_hobbs    numeric;
  v_new_tach     numeric;
  v_log_id       uuid;
BEGIN
  -- Lock the aircraft row — serializes concurrent log writes.
  SELECT total_airframe_time, total_engine_time
    INTO v_current_aftt, v_current_ftt
  FROM aft_aircraft
  WHERE id = p_aircraft_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aircraft not found' USING ERRCODE = 'P0002';
  END IF;

  v_new_aftt  := nullif(p_aircraft_update->>'total_airframe_time', '')::numeric;
  v_new_ftt   := nullif(p_aircraft_update->>'total_engine_time',   '')::numeric;
  v_new_hobbs := nullif(p_log_data->>'hobbs', '')::numeric;
  v_new_tach  := nullif(p_log_data->>'tach',  '')::numeric;

  -- Monotonicity: aircraft totals can only go forward.
  IF v_new_aftt IS NOT NULL AND v_current_aftt IS NOT NULL AND v_new_aftt < v_current_aftt THEN
    RAISE EXCEPTION 'New airframe time (%.2f) is less than current (%.2f)', v_new_aftt, v_current_aftt
      USING ERRCODE = 'P0001';
  END IF;
  IF v_new_ftt IS NOT NULL AND v_current_ftt IS NOT NULL AND v_new_ftt < v_current_ftt THEN
    RAISE EXCEPTION 'New engine time (%.2f) is less than current (%.2f)', v_new_ftt, v_current_ftt
      USING ERRCODE = 'P0001';
  END IF;

  -- Sanity bound: one log shouldn't claim >24 hrs of flight.
  IF v_new_aftt IS NOT NULL AND v_current_aftt IS NOT NULL AND (v_new_aftt - v_current_aftt) > 24 THEN
    RAISE EXCEPTION 'Implausible airframe delta: %.2f hrs in a single log', v_new_aftt - v_current_aftt
      USING ERRCODE = 'P0001';
  END IF;
  IF v_new_ftt IS NOT NULL AND v_current_ftt IS NOT NULL AND (v_new_ftt - v_current_ftt) > 24 THEN
    RAISE EXCEPTION 'Implausible engine delta: %.2f hrs in a single log', v_new_ftt - v_current_ftt
      USING ERRCODE = 'P0001';
  END IF;

  -- Attribute to the caller for the history trigger.
  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  -- Insert the flight log. Extract all known columns from the JSONB.
  INSERT INTO aft_flight_logs (
    aircraft_id, user_id,
    pod, poa, initials,
    ftt, tach, aftt, hobbs,
    landings, engine_cycles,
    fuel_gallons, trip_reason, pax_info
  ) VALUES (
    p_aircraft_id, p_user_id,
    p_log_data->>'pod',
    p_log_data->>'poa',
    p_log_data->>'initials',
    nullif(p_log_data->>'ftt', '')::numeric,
    nullif(p_log_data->>'tach', '')::numeric,
    nullif(p_log_data->>'aftt', '')::numeric,
    nullif(p_log_data->>'hobbs', '')::numeric,
    coalesce(nullif(p_log_data->>'landings', '')::int, 0),
    nullif(p_log_data->>'engine_cycles', '')::int,
    nullif(p_log_data->>'fuel_gallons', '')::numeric,
    p_log_data->>'trip_reason',
    p_log_data->>'pax_info'
  )
  RETURNING id INTO v_log_id;

  -- Update aircraft totals (only fields present in the payload).
  UPDATE aft_aircraft
  SET
    total_airframe_time = coalesce(v_new_aftt, total_airframe_time),
    total_engine_time   = coalesce(v_new_ftt,  total_engine_time),
    current_fuel_gallons = coalesce(
      nullif(p_aircraft_update->>'current_fuel_gallons', '')::numeric,
      current_fuel_gallons
    ),
    fuel_last_updated = coalesce(
      nullif(p_aircraft_update->>'fuel_last_updated', '')::timestamptz,
      fuel_last_updated
    )
  WHERE id = p_aircraft_id;

  RETURN jsonb_build_object('log_id', v_log_id, 'success', true);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION log_flight_atomic(uuid, uuid, jsonb, jsonb)
  TO authenticated, service_role;

COMMIT;

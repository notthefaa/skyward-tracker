-- =============================================================
-- Migration 042: fix fuel_last_updated + is_latest in flight-log RPCs
-- =============================================================
-- Two bugs in migrations 040/041:
--
-- 1) fuel_last_updated tracked the latest LOG's occurred_at, not the
--    latest FUEL READING. A flight logged without fuel_gallons would
--    correctly leave current_fuel_gallons alone, but would still
--    advance fuel_last_updated to that log's time — so the aircraft
--    looked like "fuel measured just now" when actually the last
--    measurement came from an older log. Dashboards read as fresh
--    when they aren't.
--
--    Fix: query the latest log with fuel_gallons IS NOT NULL in a
--    separate SELECT; use that row's occurred_at for fuel_last_updated
--    only when it genuinely carries a fuel reading.
--
-- 2) is_latest in log_flight_atomic's return jsonb was derived by
--    comparing aftt + occurred_at equality. Two legitimate logs with
--    the same aftt at the same occurred_at (edge, but possible in a
--    same-second live submission with identical payloads) would
--    misreport.
--
--    Fix: derive is_latest by id match — the row we inserted's id
--    compared to the id of the derived-latest log. Unambiguous.
--
-- Run in the Supabase SQL Editor. Requires migration 041.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION log_flight_atomic(
  p_aircraft_id uuid,
  p_user_id uuid,
  p_log_data jsonb,
  p_aircraft_update jsonb
) RETURNS jsonb AS $$
DECLARE
  v_new_aftt      numeric;
  v_new_ftt       numeric;
  v_new_occurred  timestamptz;
  v_prior_aftt    numeric;
  v_prior_ftt     numeric;
  v_log_id        uuid;
  v_latest_id     uuid;
  v_latest_aftt   numeric;
  v_latest_ftt    numeric;
  v_fuel_id       uuid;
  v_fuel_gallons  numeric;
  v_fuel_ts       timestamptz;
BEGIN
  PERFORM 1 FROM aft_aircraft
    WHERE id = p_aircraft_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aircraft not found' USING ERRCODE = 'P0002';
  END IF;

  v_new_aftt     := nullif(p_log_data->>'aftt', '')::numeric;
  v_new_ftt      := nullif(p_log_data->>'ftt',  '')::numeric;
  v_new_occurred := coalesce(
    nullif(p_log_data->>'occurred_at', '')::timestamptz,
    now()
  );

  -- Sanity bound against the log immediately prior in occurred_at order.
  SELECT aftt, ftt INTO v_prior_aftt, v_prior_ftt
    FROM aft_flight_logs
   WHERE aircraft_id = p_aircraft_id
     AND deleted_at IS NULL
     AND occurred_at <= v_new_occurred
   ORDER BY occurred_at DESC, created_at DESC
   LIMIT 1;

  IF v_new_aftt IS NOT NULL AND v_prior_aftt IS NOT NULL
     AND (v_new_aftt - v_prior_aftt) > 24 THEN
    RAISE EXCEPTION 'Implausible airframe delta: %.2f hrs in a single log',
      v_new_aftt - v_prior_aftt USING ERRCODE = 'P0001';
  END IF;
  IF v_new_ftt IS NOT NULL AND v_prior_ftt IS NOT NULL
     AND (v_new_ftt - v_prior_ftt) > 24 THEN
    RAISE EXCEPTION 'Implausible engine delta: %.2f hrs in a single log',
      v_new_ftt - v_prior_ftt USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  INSERT INTO aft_flight_logs (
    aircraft_id, user_id,
    pod, poa, initials,
    ftt, tach, aftt, hobbs,
    landings, engine_cycles,
    fuel_gallons, trip_reason, pax_info,
    occurred_at
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
    p_log_data->>'pax_info',
    v_new_occurred
  )
  RETURNING id INTO v_log_id;

  -- Latest-by-occurred_at log for the airframe/engine totals.
  SELECT id, aftt, ftt
    INTO v_latest_id, v_latest_aftt, v_latest_ftt
    FROM aft_flight_logs
   WHERE aircraft_id = p_aircraft_id
     AND deleted_at IS NULL
   ORDER BY occurred_at DESC, created_at DESC
   LIMIT 1;

  -- Latest-by-occurred_at log that ACTUALLY HAS a fuel reading. This
  -- is a separate query because the latest flight overall may have
  -- been logged without fuel data, and we don't want to advance
  -- fuel_last_updated past the actual last-observed fuel moment.
  SELECT id, fuel_gallons, occurred_at
    INTO v_fuel_id, v_fuel_gallons, v_fuel_ts
    FROM aft_flight_logs
   WHERE aircraft_id = p_aircraft_id
     AND deleted_at IS NULL
     AND fuel_gallons IS NOT NULL
   ORDER BY occurred_at DESC, created_at DESC
   LIMIT 1;

  UPDATE aft_aircraft
  SET
    total_airframe_time  = coalesce(v_latest_aftt, total_airframe_time),
    total_engine_time    = coalesce(v_latest_ftt,  total_engine_time),
    current_fuel_gallons = coalesce(v_fuel_gallons, current_fuel_gallons),
    fuel_last_updated    = coalesce(v_fuel_ts, fuel_last_updated)
  WHERE id = p_aircraft_id;

  RETURN jsonb_build_object(
    'log_id', v_log_id,
    'success', true,
    -- Unambiguous: is this row the one the aircraft aggregate now
    -- points at? If another log has a later occurred_at, v_latest_id
    -- won't match v_log_id.
    'is_latest', v_latest_id = v_log_id
  );
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION log_flight_atomic(uuid, uuid, jsonb, jsonb)
  TO authenticated, service_role;


CREATE OR REPLACE FUNCTION edit_flight_log_atomic(
  p_log_id          uuid,
  p_aircraft_id     uuid,
  p_user_id         uuid,
  p_log_data        jsonb,
  p_aircraft_update jsonb
) RETURNS jsonb AS $$
DECLARE
  v_log_aircraft  uuid;
  v_latest_aftt   numeric;
  v_latest_ftt    numeric;
  v_fuel_gallons  numeric;
  v_fuel_ts       timestamptz;
BEGIN
  PERFORM 1 FROM aft_aircraft
   WHERE id = p_aircraft_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aircraft not found' USING ERRCODE = 'P0002';
  END IF;

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

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

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
    pax_info      = coalesce(p_log_data->>'pax_info', pax_info),
    occurred_at   = coalesce(nullif(p_log_data->>'occurred_at', '')::timestamptz, occurred_at)
  WHERE id = p_log_id;

  SELECT aftt, ftt
    INTO v_latest_aftt, v_latest_ftt
    FROM aft_flight_logs
   WHERE aircraft_id = p_aircraft_id
     AND deleted_at IS NULL
   ORDER BY occurred_at DESC, created_at DESC
   LIMIT 1;

  SELECT fuel_gallons, occurred_at
    INTO v_fuel_gallons, v_fuel_ts
    FROM aft_flight_logs
   WHERE aircraft_id = p_aircraft_id
     AND deleted_at IS NULL
     AND fuel_gallons IS NOT NULL
   ORDER BY occurred_at DESC, created_at DESC
   LIMIT 1;

  UPDATE aft_aircraft SET
    total_airframe_time  = coalesce(v_latest_aftt, total_airframe_time),
    total_engine_time    = coalesce(v_latest_ftt,  total_engine_time),
    current_fuel_gallons = coalesce(v_fuel_gallons, current_fuel_gallons),
    fuel_last_updated    = coalesce(v_fuel_ts, fuel_last_updated)
  WHERE id = p_aircraft_id;

  RETURN jsonb_build_object('log_id', p_log_id, 'success', true);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION edit_flight_log_atomic(uuid, uuid, uuid, jsonb, jsonb)
  TO authenticated, service_role;


CREATE OR REPLACE FUNCTION delete_flight_log_atomic(
  p_log_id          uuid,
  p_aircraft_id     uuid,
  p_user_id         uuid,
  p_aircraft_update jsonb
) RETURNS jsonb AS $$
DECLARE
  v_log_aircraft    uuid;
  v_already_deleted timestamptz;
  v_latest_aftt     numeric;
  v_latest_ftt      numeric;
  v_fuel_gallons    numeric;
  v_fuel_ts         timestamptz;
BEGIN
  PERFORM 1 FROM aft_aircraft
   WHERE id = p_aircraft_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aircraft not found' USING ERRCODE = 'P0002';
  END IF;

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

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  UPDATE aft_flight_logs
     SET deleted_at = now(),
         deleted_by = p_user_id
   WHERE id = p_log_id;

  SELECT aftt, ftt
    INTO v_latest_aftt, v_latest_ftt
    FROM aft_flight_logs
   WHERE aircraft_id = p_aircraft_id
     AND deleted_at IS NULL
   ORDER BY occurred_at DESC, created_at DESC
   LIMIT 1;

  SELECT fuel_gallons, occurred_at
    INTO v_fuel_gallons, v_fuel_ts
    FROM aft_flight_logs
   WHERE aircraft_id = p_aircraft_id
     AND deleted_at IS NULL
     AND fuel_gallons IS NOT NULL
   ORDER BY occurred_at DESC, created_at DESC
   LIMIT 1;

  UPDATE aft_aircraft SET
    total_airframe_time  = coalesce(v_latest_aftt, total_airframe_time),
    total_engine_time    = coalesce(v_latest_ftt,  total_engine_time),
    current_fuel_gallons = coalesce(v_fuel_gallons, current_fuel_gallons),
    fuel_last_updated    = coalesce(v_fuel_ts, fuel_last_updated)
  WHERE id = p_aircraft_id;

  RETURN jsonb_build_object('log_id', p_log_id, 'success', true);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION delete_flight_log_atomic(uuid, uuid, uuid, jsonb)
  TO authenticated, service_role;

COMMIT;

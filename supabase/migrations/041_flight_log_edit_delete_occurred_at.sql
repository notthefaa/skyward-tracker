-- =============================================================
-- Migration 041: edit_flight_log_atomic + delete_flight_log_atomic
--                self-derive aircraft totals from latest log
-- =============================================================
-- Companion to migration 040. With aircraft totals now derived
-- from the log with the greatest occurred_at on every POST, the
-- EDIT and DELETE paths must do the same. Otherwise:
--   * Editing the latest log's aftt wouldn't update aircraft totals
--     (the RPC used client-supplied aircraft_update, which a minimal
--     caller might omit).
--   * Deleting the latest log left aircraft totals pointing at a
--     row that no longer exists.
--
-- Both RPCs now:
--   * Accept an optional `occurred_at` in p_log_data (edit only).
--   * Apply the edit/delete.
--   * Derive aircraft aggregate from the remaining latest-by-
--     occurred_at log. If no logs remain (delete last), the aircraft
--     totals are left untouched — admin can reset manually via the
--     aircraft edit modal.
--
-- The p_aircraft_update payload is retained as a backwards-compat
-- hint but ignored when a latest log exists; the derive is
-- authoritative. This makes the aggregates self-healing — any drift
-- between log rows and aircraft totals gets corrected on the next
-- write.
--
-- Run in the Supabase SQL Editor. Requires migration 040.
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
  v_log_aircraft  uuid;
  v_latest_aftt   numeric;
  v_latest_ftt    numeric;
  v_latest_fuel   numeric;
  v_latest_fuelts timestamptz;
BEGIN
  -- Lock the aircraft row so a concurrent POST can't interleave.
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

  -- Update log — only fields present in the payload are touched.
  -- occurred_at is editable so an admin can fix a bad timestamp; the
  -- derive step below picks up the move automatically.
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

  -- Derive aircraft aggregate from the latest-by-occurred_at log.
  -- This is the self-healing step: if the edit changed the latest
  -- log's aftt/ftt, or promoted/demoted this row's occurred_at past
  -- another row, aggregates follow automatically.
  SELECT aftt, ftt, fuel_gallons, occurred_at
    INTO v_latest_aftt, v_latest_ftt, v_latest_fuel, v_latest_fuelts
    FROM aft_flight_logs
   WHERE aircraft_id = p_aircraft_id
     AND deleted_at IS NULL
   ORDER BY occurred_at DESC, created_at DESC
   LIMIT 1;

  IF v_latest_aftt IS NOT NULL OR v_latest_ftt IS NOT NULL THEN
    UPDATE aft_aircraft SET
      total_airframe_time  = coalesce(v_latest_aftt, total_airframe_time),
      total_engine_time    = coalesce(v_latest_ftt,  total_engine_time),
      current_fuel_gallons = coalesce(v_latest_fuel, current_fuel_gallons),
      fuel_last_updated    = coalesce(v_latest_fuelts, fuel_last_updated)
    WHERE id = p_aircraft_id;
  END IF;

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
  v_latest_fuel     numeric;
  v_latest_fuelts   timestamptz;
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

  -- Derive aircraft aggregate from the new latest-by-occurred_at log.
  -- If no rows remain (last log deleted), we leave aircraft totals
  -- untouched — admin can reset manually via the aircraft edit modal.
  SELECT aftt, ftt, fuel_gallons, occurred_at
    INTO v_latest_aftt, v_latest_ftt, v_latest_fuel, v_latest_fuelts
    FROM aft_flight_logs
   WHERE aircraft_id = p_aircraft_id
     AND deleted_at IS NULL
   ORDER BY occurred_at DESC, created_at DESC
   LIMIT 1;

  IF v_latest_aftt IS NOT NULL OR v_latest_ftt IS NOT NULL THEN
    UPDATE aft_aircraft SET
      total_airframe_time  = coalesce(v_latest_aftt, total_airframe_time),
      total_engine_time    = coalesce(v_latest_ftt,  total_engine_time),
      current_fuel_gallons = coalesce(v_latest_fuel, current_fuel_gallons),
      fuel_last_updated    = coalesce(v_latest_fuelts, fuel_last_updated)
    WHERE id = p_aircraft_id;
  END IF;

  RETURN jsonb_build_object('log_id', p_log_id, 'success', true);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION delete_flight_log_atomic(uuid, uuid, uuid, jsonb)
  TO authenticated, service_role;

COMMIT;

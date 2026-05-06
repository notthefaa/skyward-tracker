-- =============================================================
-- Migration 057: delete_flight_log_atomic — fall back to setup_*
-- =============================================================
-- The current RPC re-derives totals from "the latest remaining log."
-- When the deleted log was the ONLY log on the aircraft, no rows
-- remain and v_latest_aftt / v_latest_ftt come back NULL. The
-- COALESCE in the UPDATE then keeps the existing totals — i.e. the
-- deleted log's values — and the aircraft is stuck reporting times
-- it never officially flew.
--
-- Pilot-visible symptom: a user creates a single flight log by
-- mistake (say, off by 50 hrs), deletes it, and the aircraft's
-- airframe + engine totals stay at the wrong number until they
-- manually edit the aircraft. There's no UI affordance for "reset
-- to setup time" in normal flow — the only path is to find the
-- deleted log, restore it, edit values, log a correcting flight,
-- and re-delete.
--
-- Fix: when no logs remain, fall back to setup_aftt / setup_ftt
-- (or setup_hobbs / setup_tach for piston), using GREATEST so the
-- 0-default of one side doesn't suppress the populated one. Mirrors
-- the create_aircraft_atomic + onboarding_setup logic that turns
-- setup_* into the initial total_*.
--
-- Idempotent.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_flight_log_atomic(
  p_log_id uuid,
  p_aircraft_id uuid,
  p_user_id uuid,
  p_aircraft_update jsonb
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_log_aircraft     uuid;
  v_already_deleted  timestamptz;
  v_latest_aftt      numeric;
  v_latest_ftt       numeric;
  v_fuel_gallons     numeric;
  v_fuel_ts          timestamptz;
  v_remaining_count  bigint;
  v_setup_aftt       numeric;
  v_setup_ftt        numeric;
  v_setup_hobbs      numeric;
  v_setup_tach       numeric;
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

  -- After a delete, re-derive from whichever log is now the latest.
  -- Same coalesce chain so piston aircraft get correctly updated.
  SELECT
    coalesce(aftt, hobbs, tach),
    coalesce(ftt, tach)
    INTO v_latest_aftt, v_latest_ftt
    FROM aft_flight_logs
   WHERE aircraft_id = p_aircraft_id
     AND deleted_at IS NULL
   ORDER BY occurred_at DESC, created_at DESC
   LIMIT 1;

  -- No-log fall-back: when the deleted log was the only one, the
  -- SELECT above returns NULL and the COALESCE in the UPDATE used
  -- to leave totals at the deleted log's values. Use the setup_*
  -- columns the operator entered at registration as the floor.
  -- GREATEST handles the 0-default cleanly: turbine aircraft populate
  -- aftt/ftt and leave hobbs/tach at 0; piston flips that.
  SELECT count(*) INTO v_remaining_count
    FROM aft_flight_logs
   WHERE aircraft_id = p_aircraft_id
     AND deleted_at IS NULL;

  IF v_remaining_count = 0 THEN
    SELECT setup_aftt, setup_ftt, setup_hobbs, setup_tach
      INTO v_setup_aftt, v_setup_ftt, v_setup_hobbs, v_setup_tach
      FROM aft_aircraft
     WHERE id = p_aircraft_id;
    v_latest_aftt := GREATEST(coalesce(v_setup_aftt, 0), coalesce(v_setup_hobbs, 0));
    v_latest_ftt  := GREATEST(coalesce(v_setup_ftt,  0), coalesce(v_setup_tach,  0));
  END IF;

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
$$;

COMMIT;

-- 075_delete_flight_log_setup_fallback_zero_unset.sql
--
-- Sibling to migration 074. Same `nullif(setup_*, 0)` trap, this
-- time in delete_flight_log_atomic's setup-baseline fallback.
--
-- Migration 057 wrote the fallback as:
--
--   v_latest_aftt := GREATEST(
--     coalesce(v_setup_aftt,  0),
--     coalesce(v_setup_hobbs, 0)
--   );
--   v_latest_ftt  := GREATEST(
--     coalesce(v_setup_ftt,   0),
--     coalesce(v_setup_tach,  0)
--   );
--
-- Two bugs in that formula, both surfaced by piston tach-only
-- aircraft (the same fleet shape the field report 2026-05-15 hit):
--
--   1. `setup_tach` is missing from the airframe candidate list.
--      For piston-no-hobbs the tach IS the airframe meter — the
--      log_flight_atomic coalesce chain already encodes this as
--      `coalesce(aftt, hobbs, tach)`. After a user deletes the only
--      flight log on such an aircraft, the GREATEST returns 0 (both
--      setup_aftt and setup_hobbs are NULL after the form-side
--      fixes), and `total_airframe_time` snaps to 0 — downstream
--      MX math then anchors against 0 and reports the aircraft as
--      having flown 0 hrs.
--
--   2. `coalesce(setup_*, 0)` treats a stale schema-default 0 as a
--      real baseline. Same `nullif(..., 0)` defense migration 074
--      added to log_flight_atomic's first-flight fallback.
--
-- Fix: add setup_tach to the airframe GREATEST, and wrap every
-- setup_* in `nullif(..., 0)` so default-0 values fall through.
-- Genuine brand-new aircraft (all setup_* at 0) get
-- `total_airframe_time = 0` and `total_engine_time = 0`, which is
-- the correct semantic — the aircraft hasn't flown.
--
-- Trigger conditions: piston tach-only + exactly one flight log +
-- user deletes that log. Narrow path; P2 latent. Cheap to close
-- while the migration-074 fix is fresh in the codebase.
--
-- Idempotent.

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
  -- SELECT above returns NULL. Reseed totals from the setup_*
  -- baselines. Two defenses:
  --
  --   * `nullif(..., 0)` so a schema-default 0 doesn't win the
  --     GREATEST over a real setup value on the other side. Same
  --     pattern as migration 074's log_flight_atomic fix.
  --   * setup_tach is in BOTH airframe and engine candidate lists,
  --     so piston-no-hobbs aircraft (airframe time tracked via tach)
  --     reseed correctly instead of snapping to 0.
  SELECT count(*) INTO v_remaining_count
    FROM aft_flight_logs
   WHERE aircraft_id = p_aircraft_id
     AND deleted_at IS NULL;

  IF v_remaining_count = 0 THEN
    SELECT setup_aftt, setup_ftt, setup_hobbs, setup_tach
      INTO v_setup_aftt, v_setup_ftt, v_setup_hobbs, v_setup_tach
      FROM aft_aircraft
     WHERE id = p_aircraft_id;
    v_latest_aftt := GREATEST(
      coalesce(nullif(v_setup_aftt,  0), 0),
      coalesce(nullif(v_setup_hobbs, 0), 0),
      coalesce(nullif(v_setup_tach,  0), 0)
    );
    v_latest_ftt  := GREATEST(
      coalesce(nullif(v_setup_ftt,  0), 0),
      coalesce(nullif(v_setup_tach, 0), 0)
    );
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

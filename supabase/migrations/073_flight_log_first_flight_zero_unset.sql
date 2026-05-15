-- 073_flight_log_first_flight_zero_unset.sql
--
-- Two fixes to log_flight_atomic, both surfaced by the same field
-- report: pilot tries to log their first flight on a piston tach-only
-- aircraft (previous reading 1231.3, new reading 1233.5) and the
-- toast says "implausible airframe delta: 1233.5.2f hrs in a single
-- log". Real delta is 2.2 hrs; the user is blocked from logging.
--
-- ── Bug 1: first-flight fallback picks default-0 over the real baseline
--
-- Migration 072 added a fallback for the very-first-flight case
-- (no prior log to anchor the 24hr sanity check against): use the
-- aircraft's setup_* values as the baseline.
--
--   coalesce(setup_aftt, setup_hobbs, setup_tach)
--   coalesce(setup_ftt,  setup_tach)
--
-- But the aft_aircraft schema sets every setup_* column to
-- DEFAULT 0. An aircraft created via a code path that omits the
-- unused-meter columns from the INSERT (e.g. Howard's
-- propose_onboarding_setup direct .insert(), which only sets the
-- meters Claude received) ends up with setup_hobbs=0 on a piston
-- tach-only aircraft — and `coalesce(0, 0, 1231.3)` returns 0, not
-- the real setup_tach baseline. The user's first flight log then
-- gets compared to 0 and bounces with "delta = 1233.5".
--
-- Fix: `nullif(setup_*, 0)` inside the fallback coalesce. A
-- default-0 column now flows through to the next candidate rather
-- than poisoning the chain. Genuine brand-new aircraft (all setups
-- legitimately at 0) fall through to NULL and skip the sanity
-- check entirely — same behavior as an aircraft with no setup
-- baseline at all. The "typo 15000 on a brand-new engine" case
-- migration 072 worried about is still caught when the user *did*
-- enter a non-zero starting baseline; the only regression is the
-- (extremely rare) "brand-new aircraft AND first-log-is-a-typo"
-- combo, which beats blocking every legitimate first flight on an
-- already-deployed Howard-onboarded fleet.
--
-- ── Bug 2: RAISE EXCEPTION format-string leftover
--
-- PG's RAISE only understands `%` as a placeholder — `%I` and `%L`
-- for identifiers/literals, nothing else. The current template
-- `'... %.2f hrs ...'` is read as: substitute `%` with the value,
-- leave the literal `.2f` alone. So the user saw "1233.5.2f hrs".
-- Round the value via SQL and pass through `%`.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

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

  -- Incoming-log canonical values: coalesce through the engine-type
  -- fallback chain so the sanity guard below works for both piston
  -- and turbine payloads. Turbine logs fill aftt/ftt; piston fills
  -- hobbs/tach; piston without a hobbs meter only fills tach.
  v_new_aftt := coalesce(
    nullif(p_log_data->>'aftt',  '')::numeric,
    nullif(p_log_data->>'hobbs', '')::numeric,
    nullif(p_log_data->>'tach',  '')::numeric
  );
  v_new_ftt := coalesce(
    nullif(p_log_data->>'ftt',  '')::numeric,
    nullif(p_log_data->>'tach', '')::numeric
  );
  v_new_occurred := coalesce(
    nullif(p_log_data->>'occurred_at', '')::timestamptz,
    now()
  );

  -- Sanity bound against the log immediately prior in occurred_at
  -- order. Same coalesce chain so the comparison is apples-to-apples.
  SELECT
    coalesce(aftt, hobbs, tach),
    coalesce(ftt, tach)
    INTO v_prior_aftt, v_prior_ftt
    FROM aft_flight_logs
  WHERE aircraft_id = p_aircraft_id
    AND deleted_at IS NULL
    AND occurred_at <= v_new_occurred
  ORDER BY occurred_at DESC, created_at DESC
  LIMIT 1;

  -- First-flight fallback: when no prior log exists, compare against
  -- the aircraft's setup baseline. nullif(..., 0) treats a stale
  -- default-0 value as unset so the coalesce doesn't anchor against
  -- it. See header comment for the full reason.
  IF v_prior_aftt IS NULL AND v_prior_ftt IS NULL THEN
    SELECT
      coalesce(nullif(setup_aftt, 0), nullif(setup_hobbs, 0), nullif(setup_tach, 0)),
      coalesce(nullif(setup_ftt, 0),  nullif(setup_tach, 0))
      INTO v_prior_aftt, v_prior_ftt
      FROM aft_aircraft
    WHERE id = p_aircraft_id;
  END IF;

  IF v_new_aftt IS NOT NULL AND v_prior_aftt IS NOT NULL
    AND (v_new_aftt - v_prior_aftt) > 24 THEN
    RAISE EXCEPTION 'Implausible airframe delta: % hrs in a single log',
      round(v_new_aftt - v_prior_aftt, 2) USING ERRCODE = 'P0001';
  END IF;
  IF v_new_ftt IS NOT NULL AND v_prior_ftt IS NOT NULL
    AND (v_new_ftt - v_prior_ftt) > 24 THEN
    RAISE EXCEPTION 'Implausible engine delta: % hrs in a single log',
      round(v_new_ftt - v_prior_ftt, 2) USING ERRCODE = 'P0001';
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

  -- Latest-by-occurred_at log for airframe + engine totals.
  -- coalesce chain resolves to: aftt (turbine airframe), else
  -- hobbs (piston airframe w/ hobbs meter), else tach (piston
  -- airframe w/o hobbs meter). Engine side: ftt (turbine) else
  -- tach (piston — tach IS the engine time for a piston).
  SELECT
    id,
    coalesce(aftt, hobbs, tach),
    coalesce(ftt, tach)
    INTO v_latest_id, v_latest_aftt, v_latest_ftt
    FROM aft_flight_logs
  WHERE aircraft_id = p_aircraft_id
    AND deleted_at IS NULL
  ORDER BY occurred_at DESC, created_at DESC
  LIMIT 1;

  -- Fuel derive unchanged — fuel_gallons is engine-type-agnostic.
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
    'is_latest', v_latest_id = v_log_id
  );
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION log_flight_atomic(uuid, uuid, jsonb, jsonb)
  TO authenticated, service_role;

COMMIT;

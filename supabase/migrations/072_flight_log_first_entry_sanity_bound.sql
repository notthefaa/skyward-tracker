  -- 072_flight_log_first_entry_sanity_bound.sql
  --
  -- log_flight_atomic already rejects a single-leg delta > 24 hrs, but
  -- the sanity check short-circuits to a no-op when no prior log exists
  -- for the aircraft: v_prior_aftt / v_prior_ftt come from a SELECT
  -- against aft_flight_logs which returns NULL, and the `IS NOT NULL`
  -- guard then skips the > 24 comparison entirely. A typo on the very
  -- first flight of a new aircraft (e.g. Tach "15000" instead of "1500")
  -- therefore lands silently, writes to aft_aircraft.total_engine_time,
  -- and poisons every downstream prediction (burnRate, MX projected
  -- days, AD compliance, oil/tire hours-since).
  --
  -- Fix: when no prior log exists, fall back to the aircraft's setup_*
  -- baseline values. Those represent the starting meter state at
  -- aircraft creation, so they're the right reference point for "is the
  -- first flight's delta plausible?". Mirrors the coalesce chain on the
  -- log side so piston / turbine / airframe-meterless aircraft all use
  -- consistent meters.
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

    -- Sanity bound against the log immediately prior in occurred_at order.
    -- Same coalesce chain so the comparison is apples-to-apples.
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
    -- the aircraft's setup baseline so a 10× typo on the very first
    -- entry doesn't silently land. Without this, the `IS NOT NULL`
    -- guards below skip the > 24 hrs check entirely on first-flight.
    IF v_prior_aftt IS NULL AND v_prior_ftt IS NULL THEN
      SELECT
        coalesce(setup_aftt, setup_hobbs, setup_tach),
        coalesce(setup_ftt, setup_tach)
        INTO v_prior_aftt, v_prior_ftt
        FROM aft_aircraft
      WHERE id = p_aircraft_id;
    END IF;

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

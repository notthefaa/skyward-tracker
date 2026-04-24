-- =============================================================
-- Migration 040: log_flight_atomic — occurred_at + out-of-order replay
-- =============================================================
-- The previous version (migration 010) enforced strict monotonicity:
-- a new flight log's aftt/ftt had to be >= the aircraft's current
-- totals, or the RPC rejected it. That works fine when submissions
-- arrive live and in order, but it breaks the companion app's
-- offline queue: if Pilot A logs a leg at 14:00 offline and Pilot B
-- logs a leg at 15:00 online, Pilot B's row reaches the DB first and
-- updates aftt. When Pilot A's queue flushes, their (legitimately
-- lower) aftt trips the monotonicity check and bounces.
--
-- New behavior:
--   1) The RPC accepts `occurred_at` from the log payload (falls back
--      to now() if absent — legacy clients keep working).
--   2) The log row is inserted with the supplied occurred_at.
--   3) After insert, the aircraft aggregate (total_airframe_time,
--      total_engine_time, current_fuel_gallons, fuel_last_updated)
--      is *derived* from the log with the greatest occurred_at
--      (created_at DESC as tiebreaker). That means out-of-order
--      replays simply don't disturb the aircraft's "current" totals —
--      the derive always pins to the truly-latest-by-occurred_at row.
--   4) Sanity bound: the incoming aftt/ftt is compared against the
--      row immediately *prior* to it in occurred_at order. A delta
--      > 24hr still rejects (typo guard), but the check respects the
--      event's actual place in the timeline rather than assuming
--      "new = latest".
--
-- Run in the Supabase SQL Editor. Requires migration 039.
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
  v_new_hobbs     numeric;
  v_new_tach      numeric;
  v_new_occurred  timestamptz;
  v_prior_aftt    numeric;
  v_prior_ftt     numeric;
  v_log_id        uuid;
  v_latest_aftt   numeric;
  v_latest_ftt    numeric;
  v_latest_hobbs  numeric;
  v_latest_tach   numeric;
  v_latest_fuel   numeric;
  v_latest_fuelts timestamptz;
BEGIN
  -- Lock the aircraft row — serializes concurrent log writes so the
  -- derive-latest step at the end sees a consistent view.
  PERFORM 1 FROM aft_aircraft
    WHERE id = p_aircraft_id AND deleted_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aircraft not found' USING ERRCODE = 'P0002';
  END IF;

  v_new_aftt     := nullif(p_log_data->>'aftt', '')::numeric;
  v_new_ftt      := nullif(p_log_data->>'ftt',  '')::numeric;
  v_new_hobbs    := nullif(p_log_data->>'hobbs', '')::numeric;
  v_new_tach     := nullif(p_log_data->>'tach',  '')::numeric;
  -- occurred_at: client-supplied (offline queue) or now() (live submit).
  v_new_occurred := coalesce(
    nullif(p_log_data->>'occurred_at', '')::timestamptz,
    now()
  );

  -- Sanity bound against the log *immediately prior in occurred_at order*.
  -- A delta > 24hr for a single flight is almost certainly a typo. This
  -- check runs whether the new log is the latest or a late-arriving
  -- backfill — the check is relative to the event's real place in the
  -- timeline, not the aircraft's current max.
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

  -- Attribute to the caller for the history trigger.
  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  -- Insert the flight log.
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

  -- Derive aircraft aggregate from the log with the greatest
  -- occurred_at. Out-of-order replays don't disturb this: if the new
  -- log isn't actually the latest, the SELECT picks the still-latest
  -- row and the aircraft aggregate stays put.
  SELECT aftt, ftt, hobbs, tach, fuel_gallons, occurred_at
    INTO v_latest_aftt, v_latest_ftt, v_latest_hobbs, v_latest_tach,
         v_latest_fuel, v_latest_fuelts
    FROM aft_flight_logs
   WHERE aircraft_id = p_aircraft_id
     AND deleted_at IS NULL
   ORDER BY occurred_at DESC, created_at DESC
   LIMIT 1;

  UPDATE aft_aircraft
  SET
    total_airframe_time  = coalesce(v_latest_aftt, total_airframe_time),
    total_engine_time    = coalesce(v_latest_ftt,  total_engine_time),
    -- Fuel is a "right now" observation; only update when we actually
    -- have the latest log's fuel reading (else keep the current value).
    current_fuel_gallons = coalesce(v_latest_fuel, current_fuel_gallons),
    fuel_last_updated    = coalesce(v_latest_fuelts, fuel_last_updated)
  WHERE id = p_aircraft_id;

  RETURN jsonb_build_object(
    'log_id', v_log_id,
    'success', true,
    -- Let the caller know whether this insert ended up as the latest
    -- or slotted into history — UI can show "added out of order" when
    -- false.
    'is_latest', v_latest_aftt IS NOT DISTINCT FROM v_new_aftt
                 AND v_latest_fuelts = v_new_occurred
  );
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION log_flight_atomic(uuid, uuid, jsonb, jsonb)
  TO authenticated, service_role;

COMMIT;

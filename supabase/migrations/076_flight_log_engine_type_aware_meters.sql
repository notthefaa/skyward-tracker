-- 076_flight_log_engine_type_aware_meters.sql
--
-- Field report 2026-05-16: piston tach-only aircraft N6872A. Pilot
-- enters tach=1233.50 against a previous tach of 1231.3. Real delta
-- is 2.2 hrs. RPC reports "Implausible airframe delta: 1233.5 hrs"
-- — i.e., the prior anchor resolved to 0, not 1231.3.
--
-- Diagnostic on N6872A's prior log:
--   id=fdb28508-...  aftt=null  hobbs=0  tach=1231.3  ftt=null
--
-- The stale `hobbs=0` is the smoking gun. log_flight_atomic computes
-- airframe time via
--   coalesce(aftt, hobbs, tach)
-- to cover both engine types in one formula — and `0` is non-null,
-- so coalesce returns 0 and every subsequent sanity bound anchors
-- against the wrong meter.
--
-- How `hobbs=0` landed on a tach-only piston log: either an earlier
-- Howard propose_flight_log before the engine-type guard, or a
-- pilot who typed "0" in the Hobbs field when the aircraft used to
-- claim it had a hobbs meter (the b0f7efb coerce later nulled the
-- aircraft's setup_hobbs, but the historical log retained the 0).
--
-- Migration 074 added nullif(..., 0) on the SETUP fallback, but the
-- per-log chain never got the same defense — and migration 074
-- assumed the only ambiguous case was the default-0 column. A
-- pilot-entered or Howard-proposed 0 on the log itself slips right
-- through unscathed.
--
-- Structural fix: branch on engine_type so the meters used for
-- sanity bounds + aircraft-total derivation match physical reality,
-- AND wrap the secondary (optional) airframe meter in nullif(.., 0)
-- so a stale 0 on a per-log row falls through to the primary meter.
--
--   Piston:   airframe = coalesce(nullif(hobbs, 0), tach)
--             engine   = tach
--   Turbine:  airframe = coalesce(nullif(aftt, 0),  ftt)
--             engine   = ftt
--
-- Applied to all three flight-log RPCs so edit / delete totals stay
-- in lockstep with insert:
--
--   * log_flight_atomic       — new-log sanity check + totals derive
--   * edit_flight_log_atomic  — re-derive totals after edit
--   * delete_flight_log_atomic — re-derive totals after delete
--
-- Idempotent: CREATE OR REPLACE on every function.
--
-- Sibling data backfill ships at the bottom of this file:
--
--   * Clear cross-type meter leakage: piston rows lose any stale
--     setup_aftt / setup_ftt + log aftt / ftt; turbine rows lose
--     any stale setup_hobbs / setup_tach + log hobbs / tach.
--   * Clear hobbs=0 / aftt=0 on flight logs fleet-wide (a flown
--     aircraft can't have a 0 secondary meter on the log — that's
--     either pilot/OCR/tool noise or a default that leaked).
--   * Re-anchor aircraft totals from the cleaned-up latest log.

BEGIN;

-- ─── log_flight_atomic ────────────────────────────────────────

CREATE OR REPLACE FUNCTION log_flight_atomic(
  p_aircraft_id uuid,
  p_user_id uuid,
  p_log_data jsonb,
  p_aircraft_update jsonb
) RETURNS jsonb AS $$
DECLARE
  v_engine_type   text;
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
  SELECT engine_type INTO v_engine_type
    FROM aft_aircraft
   WHERE id = p_aircraft_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aircraft not found' USING ERRCODE = 'P0002';
  END IF;

  -- Engine-type-aware new-value resolution. Piston uses hobbs/tach
  -- only; turbine uses aftt/ftt only. Cross-type fields on the
  -- incoming payload are ignored at sanity-check time (they may
  -- still land in the table — the INSERT below is unchanged — but
  -- they can no longer anchor the comparison). nullif(..., 0) on
  -- the secondary meter so a pilot-entered "0" on Hobbs/AFTT falls
  -- through to the primary instead of poisoning the coalesce.
  IF v_engine_type = 'Turbine' THEN
    v_new_aftt := coalesce(
      nullif(nullif(p_log_data->>'aftt', '')::numeric, 0),
      nullif(p_log_data->>'ftt',  '')::numeric
    );
    v_new_ftt := nullif(p_log_data->>'ftt', '')::numeric;
  ELSE
    v_new_aftt := coalesce(
      nullif(nullif(p_log_data->>'hobbs', '')::numeric, 0),
      nullif(p_log_data->>'tach',  '')::numeric
    );
    v_new_ftt := nullif(p_log_data->>'tach', '')::numeric;
  END IF;

  v_new_occurred := coalesce(
    nullif(p_log_data->>'occurred_at', '')::timestamptz,
    now()
  );

  -- Prior log: same engine-type-aware chain so the comparison is
  -- apples-to-apples regardless of stale leakage on the other side.
  IF v_engine_type = 'Turbine' THEN
    SELECT coalesce(nullif(aftt, 0), ftt), ftt
      INTO v_prior_aftt, v_prior_ftt
      FROM aft_flight_logs
     WHERE aircraft_id = p_aircraft_id
       AND deleted_at IS NULL
       AND occurred_at <= v_new_occurred
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT 1;
  ELSE
    SELECT coalesce(nullif(hobbs, 0), tach), tach
      INTO v_prior_aftt, v_prior_ftt
      FROM aft_flight_logs
     WHERE aircraft_id = p_aircraft_id
       AND deleted_at IS NULL
       AND occurred_at <= v_new_occurred
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT 1;
  END IF;

  -- First-flight fallback: setup_* baseline, also engine-aware +
  -- nullif(..., 0) so a stale DEFAULT-0 column doesn't anchor.
  IF v_prior_aftt IS NULL AND v_prior_ftt IS NULL THEN
    IF v_engine_type = 'Turbine' THEN
      SELECT coalesce(nullif(setup_aftt, 0), nullif(setup_ftt, 0)),
             nullif(setup_ftt, 0)
        INTO v_prior_aftt, v_prior_ftt
        FROM aft_aircraft
       WHERE id = p_aircraft_id;
    ELSE
      SELECT coalesce(nullif(setup_hobbs, 0), nullif(setup_tach, 0)),
             nullif(setup_tach, 0)
        INTO v_prior_aftt, v_prior_ftt
        FROM aft_aircraft
       WHERE id = p_aircraft_id;
    END IF;
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

  -- Secondary meters (aftt / hobbs) get nullif(.., 0) so a 0 from
  -- Howard / batch-submit / a future client lands as NULL rather
  -- than poisoning the next entry's coalesce chain.
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
    nullif(nullif(p_log_data->>'aftt', '')::numeric, 0),
    nullif(nullif(p_log_data->>'hobbs', '')::numeric, 0),
    coalesce(nullif(p_log_data->>'landings', '')::int, 0),
    nullif(p_log_data->>'engine_cycles', '')::int,
    nullif(p_log_data->>'fuel_gallons', '')::numeric,
    p_log_data->>'trip_reason',
    p_log_data->>'pax_info',
    v_new_occurred
  )
  RETURNING id INTO v_log_id;

  -- Latest-by-occurred_at re-derive (engine-aware) so aircraft
  -- totals stay anchored to the right physical meter.
  IF v_engine_type = 'Turbine' THEN
    SELECT id, coalesce(nullif(aftt, 0), ftt), ftt
      INTO v_latest_id, v_latest_aftt, v_latest_ftt
      FROM aft_flight_logs
     WHERE aircraft_id = p_aircraft_id
       AND deleted_at IS NULL
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT 1;
  ELSE
    SELECT id, coalesce(nullif(hobbs, 0), tach), tach
      INTO v_latest_id, v_latest_aftt, v_latest_ftt
      FROM aft_flight_logs
     WHERE aircraft_id = p_aircraft_id
       AND deleted_at IS NULL
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT 1;
  END IF;

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

-- ─── edit_flight_log_atomic ───────────────────────────────────

CREATE OR REPLACE FUNCTION edit_flight_log_atomic(
  p_log_id          uuid,
  p_aircraft_id     uuid,
  p_user_id         uuid,
  p_log_data        jsonb,
  p_aircraft_update jsonb
) RETURNS jsonb AS $$
DECLARE
  v_engine_type   text;
  v_log_aircraft  uuid;
  v_latest_aftt   numeric;
  v_latest_ftt    numeric;
  v_fuel_gallons  numeric;
  v_fuel_ts       timestamptz;
BEGIN
  SELECT engine_type INTO v_engine_type
    FROM aft_aircraft
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

  -- Clear-on-empty semantics unchanged from migration 071.
  UPDATE aft_flight_logs SET
    pod           = CASE WHEN p_log_data ? 'pod'          THEN nullif(p_log_data->>'pod', '')                    ELSE pod          END,
    poa           = CASE WHEN p_log_data ? 'poa'          THEN nullif(p_log_data->>'poa', '')                    ELSE poa          END,
    initials      = coalesce(nullif(p_log_data->>'initials', ''), initials),
    ftt           = coalesce(nullif(p_log_data->>'ftt', '')::numeric, ftt),
    tach          = coalesce(nullif(p_log_data->>'tach', '')::numeric, tach),
    aftt          = CASE WHEN p_log_data ? 'aftt'         THEN nullif(nullif(p_log_data->>'aftt', '')::numeric, 0)  ELSE aftt         END,
    hobbs         = CASE WHEN p_log_data ? 'hobbs'        THEN nullif(nullif(p_log_data->>'hobbs', '')::numeric, 0) ELSE hobbs        END,
    landings      = coalesce(nullif(p_log_data->>'landings', '')::int, landings),
    engine_cycles = coalesce(nullif(p_log_data->>'engine_cycles', '')::int, engine_cycles),
    fuel_gallons  = CASE WHEN p_log_data ? 'fuel_gallons' THEN nullif(p_log_data->>'fuel_gallons', '')::numeric  ELSE fuel_gallons END,
    trip_reason   = CASE WHEN p_log_data ? 'trip_reason'  THEN nullif(p_log_data->>'trip_reason', '')            ELSE trip_reason  END,
    pax_info      = CASE WHEN p_log_data ? 'pax_info'     THEN nullif(p_log_data->>'pax_info', '')               ELSE pax_info     END,
    occurred_at   = coalesce(nullif(p_log_data->>'occurred_at', '')::timestamptz, occurred_at)
  WHERE id = p_log_id;

  -- Engine-aware re-derive so an edited piston log doesn't pick up
  -- a stale aftt on the same row and overshoot the airframe total.
  IF v_engine_type = 'Turbine' THEN
    SELECT coalesce(nullif(aftt, 0), ftt), ftt
      INTO v_latest_aftt, v_latest_ftt
      FROM aft_flight_logs
     WHERE aircraft_id = p_aircraft_id
       AND deleted_at IS NULL
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT 1;
  ELSE
    SELECT coalesce(nullif(hobbs, 0), tach), tach
      INTO v_latest_aftt, v_latest_ftt
      FROM aft_flight_logs
     WHERE aircraft_id = p_aircraft_id
       AND deleted_at IS NULL
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT 1;
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
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION edit_flight_log_atomic(uuid, uuid, uuid, jsonb, jsonb)
  TO authenticated, service_role;

-- ─── delete_flight_log_atomic ────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_flight_log_atomic(
  p_log_id uuid,
  p_aircraft_id uuid,
  p_user_id uuid,
  p_aircraft_update jsonb
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_engine_type      text;
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
  SELECT engine_type INTO v_engine_type
    FROM aft_aircraft
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

  -- Engine-aware re-derive from whichever log is now the latest.
  IF v_engine_type = 'Turbine' THEN
    SELECT coalesce(nullif(aftt, 0), ftt), ftt
      INTO v_latest_aftt, v_latest_ftt
      FROM aft_flight_logs
     WHERE aircraft_id = p_aircraft_id
       AND deleted_at IS NULL
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT 1;
  ELSE
    SELECT coalesce(nullif(hobbs, 0), tach), tach
      INTO v_latest_aftt, v_latest_ftt
      FROM aft_flight_logs
     WHERE aircraft_id = p_aircraft_id
       AND deleted_at IS NULL
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT 1;
  END IF;

  -- No-log fall-back: re-seed from setup_* baselines (engine-aware,
  -- nullif(..., 0) so DEFAULT-0 doesn't win the GREATEST).
  SELECT count(*) INTO v_remaining_count
    FROM aft_flight_logs
   WHERE aircraft_id = p_aircraft_id
     AND deleted_at IS NULL;

  IF v_remaining_count = 0 THEN
    SELECT setup_aftt, setup_ftt, setup_hobbs, setup_tach
      INTO v_setup_aftt, v_setup_ftt, v_setup_hobbs, v_setup_tach
      FROM aft_aircraft
     WHERE id = p_aircraft_id;
    IF v_engine_type = 'Turbine' THEN
      v_latest_aftt := GREATEST(
        coalesce(nullif(v_setup_aftt, 0), 0),
        coalesce(nullif(v_setup_ftt,  0), 0)
      );
      v_latest_ftt  := coalesce(nullif(v_setup_ftt, 0), 0);
    ELSE
      v_latest_aftt := GREATEST(
        coalesce(nullif(v_setup_hobbs, 0), 0),
        coalesce(nullif(v_setup_tach,  0), 0)
      );
      v_latest_ftt  := coalesce(nullif(v_setup_tach, 0), 0);
    END IF;
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

-- ─── Data backfill: clear cross-type meter leakage ────────────
--
-- For every aircraft, null out the columns that belong to the OTHER
-- engine type. After this, no piston row carries a stale aftt/ftt
-- and no turbine row carries a stale hobbs/tach. Genuine readings
-- on the correct meter side are untouched.
--
-- Applied last so any in-flight RPC that still references the old
-- coalesce chains (shouldn't be any after the CREATE OR REPLACE
-- above, but a same-transaction safety net) sees the new shape.

UPDATE aft_aircraft
   SET setup_aftt = NULL, setup_ftt = NULL
 WHERE engine_type = 'Piston'
   AND (setup_aftt IS NOT NULL OR setup_ftt IS NOT NULL);

UPDATE aft_aircraft
   SET setup_hobbs = NULL, setup_tach = NULL
 WHERE engine_type = 'Turbine'
   AND (setup_hobbs IS NOT NULL OR setup_tach IS NOT NULL);

UPDATE aft_flight_logs fl
   SET aftt = NULL, ftt = NULL
  FROM aft_aircraft a
 WHERE fl.aircraft_id = a.id
   AND a.engine_type = 'Piston'
   AND (fl.aftt IS NOT NULL OR fl.ftt IS NOT NULL);

UPDATE aft_flight_logs fl
   SET hobbs = NULL, tach = NULL
  FROM aft_aircraft a
 WHERE fl.aircraft_id = a.id
   AND a.engine_type = 'Turbine'
   AND (fl.hobbs IS NOT NULL OR fl.tach IS NOT NULL);

-- Clear stale zero on the secondary (optional) airframe meter.
-- A flown aircraft can't have hobbs=0 / aftt=0 on a log row — that
-- value is either Howard/OCR noise or a pilot mistake that got past
-- the form. Treat 0 as "not present". This is what unsticks the
-- N6872A field report: the May 13 log had hobbs=0 on a tach-only
-- piston, which the coalesce was picking over tach=1231.3.
UPDATE aft_flight_logs SET hobbs = NULL WHERE hobbs = 0;
UPDATE aft_flight_logs SET aftt  = NULL WHERE aftt  = 0;

-- Re-anchor aircraft totals after the column wipe so totals
-- reflect the cleaned-up latest log instead of the stale value
-- they were last set to. Engine-aware + nullif(.., 0) to match the
-- new RPC shape.
UPDATE aft_aircraft a SET
  total_airframe_time = coalesce((
    SELECT CASE WHEN a.engine_type = 'Turbine'
                THEN coalesce(nullif(fl.aftt, 0), fl.ftt)
                ELSE coalesce(nullif(fl.hobbs, 0), fl.tach)
           END
      FROM aft_flight_logs fl
     WHERE fl.aircraft_id = a.id AND fl.deleted_at IS NULL
     ORDER BY fl.occurred_at DESC, fl.created_at DESC
     LIMIT 1
  ), a.total_airframe_time),
  total_engine_time = coalesce((
    SELECT CASE WHEN a.engine_type = 'Turbine' THEN fl.ftt ELSE fl.tach END
      FROM aft_flight_logs fl
     WHERE fl.aircraft_id = a.id AND fl.deleted_at IS NULL
     ORDER BY fl.occurred_at DESC, fl.created_at DESC
     LIMIT 1
  ), a.total_engine_time)
 WHERE a.deleted_at IS NULL;

COMMIT;

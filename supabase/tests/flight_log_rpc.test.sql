-- =============================================================
-- Integration test: flight-log RPCs (migrations 010 + 022 + 042)
-- =============================================================
-- Exercises the companion-app offline-queue scenarios end-to-end
-- against a real Postgres. Run with:
--
--   docker exec -e PGPASSWORD=tester skyward-pg \
--     psql -U tester -d skyward_test -v ON_ERROR_STOP=1 \
--     -f /tmp/flight_log_rpc.test.sql
--
-- Each scenario starts with TRUNCATE so tests are independent.
-- Uses RAISE NOTICE for pass signals; any failed assertion aborts
-- the run (ON_ERROR_STOP=1).
-- =============================================================

-- ─── Schema stub ───────────────────────────────────────────────
-- Minimal columns from the real schema — just what the RPC reads
-- or writes. Keeps the test hermetic; no auth.users, no triggers.

DROP TABLE IF EXISTS aft_flight_logs CASCADE;
DROP TABLE IF EXISTS aft_aircraft CASCADE;

CREATE TABLE aft_aircraft (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tail_number           text NOT NULL,
  total_airframe_time   numeric,
  total_engine_time     numeric,
  current_fuel_gallons  numeric,
  fuel_last_updated     timestamptz,
  deleted_at            timestamptz
);

CREATE TABLE aft_flight_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id    uuid NOT NULL REFERENCES aft_aircraft(id),
  user_id        uuid,
  pod            text,
  poa            text,
  initials       text,
  aftt           numeric,
  ftt            numeric,
  hobbs          numeric,
  tach           numeric,
  landings       int,
  engine_cycles  int,
  fuel_gallons   numeric,
  trip_reason    text,
  pax_info       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  deleted_by     uuid
);

CREATE INDEX ON aft_flight_logs (aircraft_id, occurred_at DESC) WHERE deleted_at IS NULL;

-- ─── Load the RPCs (migrations 042 content) ─────────────────────
-- Loaded by the runner script before this file runs, via psql -f.

-- ─── Helpers ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION test_reset() RETURNS void AS $$
BEGIN
  TRUNCATE aft_flight_logs CASCADE;
  TRUNCATE aft_aircraft CASCADE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION test_seed_aircraft() RETURNS uuid AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO aft_aircraft (tail_number, total_airframe_time, total_engine_time)
  VALUES ('N205WH', 1000.0, 1000.0)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION test_assert(cond boolean, msg text) RETURNS void AS $$
BEGIN
  IF NOT cond THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', msg;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ─── Scenario 1: live submit, in-order ─────────────────────────
DO $$
DECLARE
  v_aircraft uuid;
  v_user     uuid := gen_random_uuid();
  v_result   jsonb;
  v_aftt     numeric;
BEGIN
  PERFORM test_reset();
  v_aircraft := test_seed_aircraft();

  v_result := log_flight_atomic(
    v_aircraft, v_user,
    jsonb_build_object(
      'initials', 'AG',
      'aftt', 1001.5,
      'ftt',  1001.5,
      'landings', 2,
      'fuel_gallons', 40
    ),
    '{}'::jsonb
  );

  SELECT total_airframe_time INTO v_aftt FROM aft_aircraft WHERE id = v_aircraft;
  PERFORM test_assert(v_aftt = 1001.5, 'aftt should advance to 1001.5');
  PERFORM test_assert((v_result->>'is_latest')::boolean = true, 'is_latest should be true on first insert');

  RAISE NOTICE 'PASS: Scenario 1 — live submit advances aircraft';
END $$;

-- ─── Scenario 2: out-of-order — Pilot B's later flight lands first ─
DO $$
DECLARE
  v_aircraft uuid;
  v_user_a   uuid := gen_random_uuid();
  v_user_b   uuid := gen_random_uuid();
  v_result   jsonb;
  v_aftt     numeric;
BEGIN
  PERFORM test_reset();
  v_aircraft := test_seed_aircraft();

  -- Pilot B flies at 15:00 online, lands first.
  v_result := log_flight_atomic(
    v_aircraft, v_user_b,
    jsonb_build_object(
      'initials', 'BP',
      'aftt', 1001.0,
      'ftt', 1001.0,
      'occurred_at', '2026-04-24T15:00:00Z',
      'fuel_gallons', 35
    ),
    '{}'::jsonb
  );
  PERFORM test_assert((v_result->>'is_latest')::boolean = true, 'Pilot B first insert should be latest');

  SELECT total_airframe_time INTO v_aftt FROM aft_aircraft WHERE id = v_aircraft;
  PERFORM test_assert(v_aftt = 1001.0, 'Aircraft should be at Pilot B aftt (1001.0)');

  -- Pilot A's 14:00 flight flushes from offline queue after Pilot B's row
  -- is already in. Before the fix this would have bounced off the
  -- monotonicity check (1000.5 < 1001.0). Now it should insert and the
  -- aircraft aggregate should STAY at Pilot B's 1001.0.
  v_result := log_flight_atomic(
    v_aircraft, v_user_a,
    jsonb_build_object(
      'initials', 'AG',
      'aftt', 1000.5,
      'ftt', 1000.5,
      'occurred_at', '2026-04-24T14:00:00Z'
    ),
    '{}'::jsonb
  );
  PERFORM test_assert((v_result->>'is_latest')::boolean = false, 'Late-arriving earlier flight should NOT be latest');

  SELECT total_airframe_time INTO v_aftt FROM aft_aircraft WHERE id = v_aircraft;
  PERFORM test_assert(v_aftt = 1001.0, 'Aircraft aggregate must stay at Pilot B (1001.0) after out-of-order replay');

  -- Both logs should exist.
  PERFORM test_assert(
    (SELECT count(*) FROM aft_flight_logs WHERE aircraft_id = v_aircraft) = 2,
    'Both logs persisted'
  );

  RAISE NOTICE 'PASS: Scenario 2 — out-of-order replay preserves aircraft aggregate';
END $$;

-- ─── Scenario 3: fuel_last_updated tracks only fuel-bearing logs ───
DO $$
DECLARE
  v_aircraft uuid;
  v_user     uuid := gen_random_uuid();
  v_fuel     numeric;
  v_fuel_ts  timestamptz;
BEGIN
  PERFORM test_reset();
  v_aircraft := test_seed_aircraft();

  -- First log: has fuel reading.
  PERFORM log_flight_atomic(
    v_aircraft, v_user,
    jsonb_build_object(
      'initials', 'AG', 'aftt', 1001.0, 'ftt', 1001.0,
      'fuel_gallons', 40,
      'occurred_at', '2026-04-24T14:00:00Z'
    ),
    '{}'::jsonb
  );

  SELECT current_fuel_gallons, fuel_last_updated INTO v_fuel, v_fuel_ts
    FROM aft_aircraft WHERE id = v_aircraft;
  PERFORM test_assert(v_fuel = 40, 'fuel should be 40 after first log');
  PERFORM test_assert(v_fuel_ts = '2026-04-24T14:00:00Z'::timestamptz, 'fuel_last_updated matches first log');

  -- Second log: NO fuel reading (pilot logged tach only).
  -- This is the bug-fix scenario: fuel_last_updated must NOT advance
  -- because this log has no fuel data. The aircraft's last observed
  -- fuel still belongs to the 14:00 log.
  PERFORM log_flight_atomic(
    v_aircraft, v_user,
    jsonb_build_object(
      'initials', 'AG', 'aftt', 1002.0, 'ftt', 1002.0,
      'occurred_at', '2026-04-24T16:00:00Z'
      -- no fuel_gallons
    ),
    '{}'::jsonb
  );

  SELECT current_fuel_gallons, fuel_last_updated INTO v_fuel, v_fuel_ts
    FROM aft_aircraft WHERE id = v_aircraft;
  PERFORM test_assert(v_fuel = 40, 'current_fuel_gallons stays at 40 (last fuel reading)');
  PERFORM test_assert(
    v_fuel_ts = '2026-04-24T14:00:00Z'::timestamptz,
    'fuel_last_updated MUST stay at 14:00 — the fuel-only fix'
  );

  RAISE NOTICE 'PASS: Scenario 3 — fuel_last_updated tracks fuel readings, not every log';
END $$;

-- ─── Scenario 4: 24hr sanity bound against prior occurred_at ────
DO $$
DECLARE
  v_aircraft uuid;
  v_user     uuid := gen_random_uuid();
  v_failed   boolean := false;
BEGIN
  PERFORM test_reset();
  v_aircraft := test_seed_aircraft();

  -- Seed a log at 14:00 with aftt=1000.
  PERFORM log_flight_atomic(
    v_aircraft, v_user,
    jsonb_build_object(
      'initials', 'AG', 'aftt', 1000.0, 'ftt', 1000.0,
      'occurred_at', '2026-04-24T14:00:00Z'
    ),
    '{}'::jsonb
  );

  -- Now submit a log at 14:30 claiming 30hr delta (typo).
  BEGIN
    PERFORM log_flight_atomic(
      v_aircraft, v_user,
      jsonb_build_object(
        'initials', 'AG', 'aftt', 1030.0, 'ftt', 1030.0,
        'occurred_at', '2026-04-24T14:30:00Z'
      ),
      '{}'::jsonb
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_failed := true;
  END;

  PERFORM test_assert(v_failed, '30hr single-leg delta must be rejected');
  RAISE NOTICE 'PASS: Scenario 4 — 24hr sanity bound catches typos';
END $$;

-- ─── Scenario 5: backfilling a gap doesn't bounce off sanity ────
DO $$
DECLARE
  v_aircraft uuid;
  v_user     uuid := gen_random_uuid();
  v_result   jsonb;
BEGIN
  PERFORM test_reset();
  v_aircraft := test_seed_aircraft();

  -- Latest: log at 16:00 with aftt=1010 (10hr of flying).
  PERFORM log_flight_atomic(
    v_aircraft, v_user,
    jsonb_build_object(
      'initials', 'AG', 'aftt', 1010.0, 'ftt', 1010.0,
      'occurred_at', '2026-04-24T16:00:00Z'
    ),
    '{}'::jsonb
  );

  -- Companion app replays a missed 10:00 flight with aftt=1005 (5hr).
  -- This is valid: the flight genuinely predates the latest. Sanity
  -- check runs against prior-by-occurred_at (NULL here → skip), not
  -- against the aircraft max. Should land without bouncing.
  v_result := log_flight_atomic(
    v_aircraft, v_user,
    jsonb_build_object(
      'initials', 'AG', 'aftt', 1005.0, 'ftt', 1005.0,
      'occurred_at', '2026-04-24T10:00:00Z'
    ),
    '{}'::jsonb
  );

  PERFORM test_assert((v_result->>'is_latest')::boolean = false, 'Backfilled earlier flight is NOT latest');
  PERFORM test_assert(
    (SELECT total_airframe_time FROM aft_aircraft WHERE id = v_aircraft) = 1010.0,
    'Aircraft aggregate stays at latest (1010.0)'
  );
  RAISE NOTICE 'PASS: Scenario 5 — gap backfill slots into history';
END $$;

-- ─── Scenario 6: edit the latest log re-derives aggregate ───────
DO $$
DECLARE
  v_aircraft uuid;
  v_user     uuid := gen_random_uuid();
  v_log_id   uuid;
  v_aftt     numeric;
BEGIN
  PERFORM test_reset();
  v_aircraft := test_seed_aircraft();

  INSERT INTO aft_flight_logs (aircraft_id, user_id, aftt, ftt, occurred_at)
  VALUES (v_aircraft, v_user, 1005.0, 1005.0, '2026-04-24T14:00:00Z')
  RETURNING id INTO v_log_id;
  UPDATE aft_aircraft SET total_airframe_time = 1005.0, total_engine_time = 1005.0
   WHERE id = v_aircraft;

  -- Admin corrects the aftt (typo fix, was 1005, should be 1002).
  PERFORM edit_flight_log_atomic(
    v_log_id, v_aircraft, v_user,
    jsonb_build_object('aftt', 1002.0),
    '{}'::jsonb
  );

  SELECT total_airframe_time INTO v_aftt FROM aft_aircraft WHERE id = v_aircraft;
  PERFORM test_assert(v_aftt = 1002.0, 'Aircraft aggregate follows edit on latest log');
  RAISE NOTICE 'PASS: Scenario 6 — edit re-derives aircraft aggregate';
END $$;

-- ─── Scenario 7: delete last log leaves aircraft untouched ──────
DO $$
DECLARE
  v_aircraft uuid;
  v_user     uuid := gen_random_uuid();
  v_log_id   uuid;
  v_aftt     numeric;
BEGIN
  PERFORM test_reset();
  v_aircraft := test_seed_aircraft();

  INSERT INTO aft_flight_logs (aircraft_id, user_id, aftt, ftt, occurred_at)
  VALUES (v_aircraft, v_user, 1005.0, 1005.0, '2026-04-24T14:00:00Z')
  RETURNING id INTO v_log_id;
  UPDATE aft_aircraft SET total_airframe_time = 1005.0 WHERE id = v_aircraft;

  PERFORM delete_flight_log_atomic(v_log_id, v_aircraft, v_user, '{}'::jsonb);

  SELECT total_airframe_time INTO v_aftt FROM aft_aircraft WHERE id = v_aircraft;
  -- After all logs deleted, we leave aircraft totals alone (admin
  -- resets manually). Otherwise the aggregate would go NULL and
  -- every downstream calc would hit a NULL-safety path.
  PERFORM test_assert(v_aftt = 1005.0, 'Aircraft totals preserved after last log deleted');
  RAISE NOTICE 'PASS: Scenario 7 — delete last log preserves aircraft totals';
END $$;

-- ─── Scenario 8: delete latest log promotes next-latest ─────────
DO $$
DECLARE
  v_aircraft uuid;
  v_user     uuid := gen_random_uuid();
  v_log_old  uuid;
  v_log_new  uuid;
  v_aftt     numeric;
BEGIN
  PERFORM test_reset();
  v_aircraft := test_seed_aircraft();

  INSERT INTO aft_flight_logs (aircraft_id, user_id, aftt, ftt, occurred_at)
  VALUES (v_aircraft, v_user, 1005.0, 1005.0, '2026-04-24T14:00:00Z')
  RETURNING id INTO v_log_old;
  INSERT INTO aft_flight_logs (aircraft_id, user_id, aftt, ftt, occurred_at)
  VALUES (v_aircraft, v_user, 1010.0, 1010.0, '2026-04-24T16:00:00Z')
  RETURNING id INTO v_log_new;
  UPDATE aft_aircraft SET total_airframe_time = 1010.0 WHERE id = v_aircraft;

  PERFORM delete_flight_log_atomic(v_log_new, v_aircraft, v_user, '{}'::jsonb);

  SELECT total_airframe_time INTO v_aftt FROM aft_aircraft WHERE id = v_aircraft;
  PERFORM test_assert(v_aftt = 1005.0, 'Aircraft totals fall back to next-latest (1005.0)');
  RAISE NOTICE 'PASS: Scenario 8 — delete latest promotes next-latest';
END $$;

-- ─── Scenario 9: concurrent writes serialize via FOR UPDATE ─────
-- (Not asserted here — would need two connections. The FOR UPDATE
-- lock is known correct from migration 010's track record; the
-- change in 042 preserves the same PERFORM 1 ... FOR UPDATE.)

DO $$ BEGIN RAISE NOTICE 'All flight-log RPC scenarios passed'; END $$;

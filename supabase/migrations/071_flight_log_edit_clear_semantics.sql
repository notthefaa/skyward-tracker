-- 071_flight_log_edit_clear_semantics.sql
--
-- edit_flight_log_atomic previously used `coalesce(p_log_data->>'field', field)`
-- for every column. JSON null and `nullif('', '')` both resolve to SQL NULL,
-- so any payload that sends `{field: null}` or `{field: ''}` (which is exactly
-- what TimesTab does when a pilot clears the Reason / POD / POA / PAX /
-- Fuel field on edit) silently kept the existing value — the edit appeared
-- to succeed but the cleared field came back unchanged on reload.
--
-- Switch nullable columns to a key-existence CASE:
--   * key absent              → keep existing value
--   * key present + null/''   → clear to NULL
--   * key present + value     → write the value
--
-- NOT NULL columns (initials, landings, engine_cycles, occurred_at) keep
-- coalesce semantics so a stray null can't crash the row. ftt/tach are
-- nominally nullable on the column but are *the* primary meter on
-- their respective engine type — keep coalesce so a typo can't wipe them.
-- aftt/hobbs are secondary meters and explicitly marked (Opt) in the
-- form, so they're clearable.

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
    pod           = CASE WHEN p_log_data ? 'pod'          THEN nullif(p_log_data->>'pod', '')                    ELSE pod          END,
    poa           = CASE WHEN p_log_data ? 'poa'          THEN nullif(p_log_data->>'poa', '')                    ELSE poa          END,
    initials      = coalesce(nullif(p_log_data->>'initials', ''), initials),
    ftt           = coalesce(nullif(p_log_data->>'ftt', '')::numeric, ftt),
    tach          = coalesce(nullif(p_log_data->>'tach', '')::numeric, tach),
    aftt          = CASE WHEN p_log_data ? 'aftt'         THEN nullif(p_log_data->>'aftt', '')::numeric          ELSE aftt         END,
    hobbs         = CASE WHEN p_log_data ? 'hobbs'        THEN nullif(p_log_data->>'hobbs', '')::numeric         ELSE hobbs        END,
    landings      = coalesce(nullif(p_log_data->>'landings', '')::int, landings),
    engine_cycles = coalesce(nullif(p_log_data->>'engine_cycles', '')::int, engine_cycles),
    fuel_gallons  = CASE WHEN p_log_data ? 'fuel_gallons' THEN nullif(p_log_data->>'fuel_gallons', '')::numeric  ELSE fuel_gallons END,
    trip_reason   = CASE WHEN p_log_data ? 'trip_reason'  THEN nullif(p_log_data->>'trip_reason', '')            ELSE trip_reason  END,
    pax_info      = CASE WHEN p_log_data ? 'pax_info'     THEN nullif(p_log_data->>'pax_info', '')               ELSE pax_info     END,
    occurred_at   = coalesce(nullif(p_log_data->>'occurred_at', '')::timestamptz, occurred_at)
  WHERE id = p_log_id;

  -- Re-derive from the latest-by-occurred_at log with the coalesce
  -- chain so edits on piston logs update aircraft totals correctly.
  SELECT
    coalesce(aftt, hobbs, tach),
    coalesce(ftt, tach)
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

COMMIT;

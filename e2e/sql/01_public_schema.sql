--
-- PostgreSQL database dump
--

\restrict Apug02WIKWekzz9al7aZIKlRMGii1lvPNWZQeuidBXhUtQllAFg5zc2H7q2CYoV

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.9

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: aft_equipment_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.aft_equipment_category AS ENUM (
    'engine',
    'propeller',
    'avionics',
    'transponder',
    'altimeter',
    'pitot_static',
    'elt',
    'adsb',
    'autopilot',
    'gps',
    'radio',
    'intercom',
    'instrument',
    'landing_gear',
    'lighting',
    'accessory',
    'other'
);


--
-- Name: aft_ads_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aft_ads_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


--
-- Name: aft_block_locked_line_item_updates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aft_block_locked_line_item_updates() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    -- Allow only lock/unlock bookkeeping + deleted_at soft-delete from admins.
    IF (
      NEW.locked_at IS DISTINCT FROM OLD.locked_at
      OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
    ) AND (
      NEW.line_status = OLD.line_status
      AND NEW.completion_date IS NOT DISTINCT FROM OLD.completion_date
      AND NEW.completion_time IS NOT DISTINCT FROM OLD.completion_time
      AND NEW.completed_by_name IS NOT DISTINCT FROM OLD.completed_by_name
      AND NEW.completed_by_cert IS NOT DISTINCT FROM OLD.completed_by_cert
      AND NEW.cert_type IS NOT DISTINCT FROM OLD.cert_type
      AND NEW.cert_number IS NOT DISTINCT FROM OLD.cert_number
      AND NEW.cert_expiry IS NOT DISTINCT FROM OLD.cert_expiry
      AND NEW.tach_at_completion IS NOT DISTINCT FROM OLD.tach_at_completion
      AND NEW.hobbs_at_completion IS NOT DISTINCT FROM OLD.hobbs_at_completion
      AND NEW.logbook_ref IS NOT DISTINCT FROM OLD.logbook_ref
      AND NEW.work_description IS NOT DISTINCT FROM OLD.work_description
    ) THEN
      RETURN NEW;  -- lock bookkeeping OK
    ELSE
      RAISE EXCEPTION 'Line item % is locked (event completed). Unlock before editing.', OLD.id
        USING ERRCODE = 'P0003';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: aft_equipment_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aft_equipment_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


--
-- Name: aft_lock_on_complete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aft_lock_on_complete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'complete' AND OLD.status IS DISTINCT FROM 'complete' THEN
    NEW.locked_at := coalesce(NEW.locked_at, now());

    UPDATE aft_event_line_items
      SET locked_at = coalesce(locked_at, now())
      WHERE event_id = NEW.id AND locked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: aft_squawks_rotate_token_on_resolve(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aft_squawks_rotate_token_on_resolve() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'resolved' AND COALESCE(OLD.status, '') <> 'resolved' THEN
    NEW.access_token := replace(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '');
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: aft_squawks_set_access_token(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aft_squawks_set_access_token() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.access_token IS NULL THEN
    NEW.access_token := replace(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '');
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: complete_mx_event_atomic(uuid, uuid, jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_mx_event_atomic(p_event_id uuid, p_user_id uuid, p_completions jsonb, p_partial boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_completion        jsonb;
  v_line_item         aft_event_line_items;
  v_mx_item           aft_maintenance_items;
  v_event_aircraft_id uuid;
  v_completion_dt     date;
  v_completion_hr     numeric;
  v_tach              numeric;
  v_hobbs             numeric;
  v_completed_names   text[] := '{}';
  v_unmatched_ids     text[] := '{}';
  v_all_resolved      boolean;
BEGIN
  IF p_completions IS NULL OR jsonb_typeof(p_completions) <> 'array' THEN
    RAISE EXCEPTION 'completions must be a JSON array';
  END IF;

  -- Pull the event's aircraft and verify it's still alive. The
  -- `deleted_at IS NULL` filter closes the TOCTOU race against a
  -- concurrent soft-delete: if the event was cancelled between the
  -- API's pre-check and this RPC firing, abort before any side
  -- effects run rather than silently advancing intervals on items
  -- belonging to a deleted event.
  SELECT aircraft_id INTO v_event_aircraft_id
    FROM aft_maintenance_events
    WHERE id = p_event_id
      AND deleted_at IS NULL;
  IF v_event_aircraft_id IS NULL THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'P0002';
  END IF;

  FOR v_completion IN SELECT * FROM jsonb_array_elements(p_completions) LOOP
    v_completion_dt := NULLIF(v_completion->>'completionDate', '')::date;
    v_completion_hr := NULLIF(v_completion->>'completionTime', '')::numeric;
    v_tach  := NULLIF(v_completion->>'tachAtCompletion',  '')::numeric;
    v_hobbs := NULLIF(v_completion->>'hobbsAtCompletion', '')::numeric;

    UPDATE aft_event_line_items SET
      line_status          = 'complete',
      completion_date      = v_completion_dt,
      completion_time      = v_completion_hr,
      completed_by_name    = NULLIF(v_completion->>'completedByName',  ''),
      completed_by_cert    = NULLIF(v_completion->>'completedByCert',  ''),
      work_description     = NULLIF(v_completion->>'workDescription',  ''),
      cert_type            = NULLIF(v_completion->>'certType',         ''),
      cert_number          = NULLIF(v_completion->>'certNumber',       ''),
      cert_expiry          = NULLIF(v_completion->>'certExpiry',       '')::date,
      tach_at_completion   = v_tach,
      hobbs_at_completion  = v_hobbs,
      logbook_ref          = NULLIF(v_completion->>'logbookRef',       '')
    WHERE id = (v_completion->>'lineItemId')::uuid
      AND event_id = p_event_id
    RETURNING * INTO v_line_item;

    IF v_line_item.id IS NULL THEN
      v_unmatched_ids := array_append(v_unmatched_ids, v_completion->>'lineItemId');
      CONTINUE;
    END IF;
    v_completed_names := array_append(v_completed_names, v_line_item.item_name);

    -- Advance MX-item interval if linked. `deleted_at IS NULL`
    -- guards against a soft-deleted item being silently
    -- resurrected with overwritten due fields — a deleted item
    -- that's later restored should come back with the state it
    -- had at delete time, not whatever the most recent unrelated
    -- event happened to write.
    IF v_line_item.maintenance_item_id IS NOT NULL THEN
      SELECT * INTO v_mx_item
        FROM aft_maintenance_items
        WHERE id = v_line_item.maintenance_item_id
          AND deleted_at IS NULL;

      IF FOUND THEN
        IF (v_mx_item.tracking_type = 'time' OR v_mx_item.tracking_type = 'both')
           AND v_completion_hr IS NOT NULL THEN
          UPDATE aft_maintenance_items SET
            last_completed_time     = v_completion_hr,
            due_time                = CASE
              WHEN time_interval IS NOT NULL THEN v_completion_hr + time_interval
              ELSE due_time
            END,
            reminder_5_sent         = false,
            reminder_15_sent        = false,
            reminder_30_sent        = false,
            mx_schedule_sent        = false,
            primary_heads_up_sent   = false
          WHERE id = v_mx_item.id;
        END IF;

        IF (v_mx_item.tracking_type = 'date' OR v_mx_item.tracking_type = 'both')
           AND v_completion_dt IS NOT NULL THEN
          UPDATE aft_maintenance_items SET
            last_completed_date     = v_completion_dt,
            due_date                = CASE
              WHEN date_interval_days IS NOT NULL
                THEN (v_completion_dt + (date_interval_days || ' days')::interval)::date
              ELSE due_date
            END,
            reminder_5_sent         = false,
            reminder_15_sent        = false,
            reminder_30_sent        = false,
            mx_schedule_sent        = false,
            primary_heads_up_sent   = false
          WHERE id = v_mx_item.id;
        END IF;
      END IF;
    END IF;

    IF v_line_item.squawk_id IS NOT NULL THEN
      UPDATE aft_squawks SET
        status                = 'resolved',
        affects_airworthiness = false,
        resolved_by_event_id  = p_event_id
      WHERE id = v_line_item.squawk_id
        AND aircraft_id = v_event_aircraft_id
        AND deleted_at IS NULL;
    END IF;
  END LOOP;

  SELECT bool_and(line_status IN ('complete', 'deferred'))
    INTO v_all_resolved
    FROM aft_event_line_items
    WHERE event_id = p_event_id AND deleted_at IS NULL;

  -- Re-check deleted_at on the event status flip too. If the event
  -- was deleted mid-loop the side effects above are still inside the
  -- same transaction and would roll back; this is belt-and-suspenders.
  IF v_all_resolved AND NOT COALESCE(p_partial, false) THEN
    UPDATE aft_maintenance_events
      SET status = 'complete', completed_at = now()
      WHERE id = p_event_id
        AND deleted_at IS NULL;
    INSERT INTO aft_event_messages (event_id, sender, message_type, message)
      VALUES (
        p_event_id, 'system', 'status_update',
        'Maintenance event completed. All tracking items have been reset.'
      );
  ELSIF v_all_resolved THEN
    UPDATE aft_maintenance_events
      SET status = 'complete', completed_at = now()
      WHERE id = p_event_id
        AND deleted_at IS NULL;
    INSERT INTO aft_event_messages (event_id, sender, message_type, message)
      VALUES (
        p_event_id, 'system', 'status_update',
        'All items resolved. Maintenance event completed and tracking reset.'
      );
  ELSE
    INSERT INTO aft_event_messages (event_id, sender, message_type, message)
      VALUES (
        p_event_id, 'system', 'status_update',
        'Logbook data entered for: ' || array_to_string(v_completed_names, ', ')
          || '. Tracking reset for completed items. Remaining items still open.'
      );
  END IF;

  RETURN jsonb_build_object(
    'all_resolved',   COALESCE(v_all_resolved, false),
    'unmatched_ids',  v_unmatched_ids
  );
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: aft_aircraft; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_aircraft (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tail_number text NOT NULL,
    aircraft_type text NOT NULL,
    total_airframe_time numeric DEFAULT 0,
    total_engine_time numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    engine_type text DEFAULT 'Piston'::text,
    serial_number text,
    home_airport text,
    main_contact text,
    avatar_url text,
    current_fuel_gallons numeric DEFAULT 0,
    main_contact_phone text,
    main_contact_email text,
    mx_contact text,
    mx_contact_phone text,
    mx_contact_email text,
    fuel_last_updated timestamp with time zone,
    setup_aftt numeric DEFAULT 0,
    setup_ftt numeric DEFAULT 0,
    setup_hobbs numeric DEFAULT 0,
    setup_tach numeric DEFAULT 0,
    created_by uuid,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    is_ifr_equipped boolean,
    is_for_hire boolean,
    make text,
    model text,
    year_mfg integer,
    time_zone text DEFAULT 'UTC'::text NOT NULL,
    type_certificate text,
    CONSTRAINT aft_aircraft_engine_type_check CHECK ((engine_type = ANY (ARRAY['Piston'::text, 'Turbine'::text])))
);


--
-- Name: COLUMN aft_aircraft.time_zone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.aft_aircraft.time_zone IS 'IANA timezone identifier (e.g. America/Los_Angeles). Used by server-side date-math (cron MX reminders, airworthiness status) so calendar-day calculations match the pilot''s local date instead of the UTC runtime.';


--
-- Name: COLUMN aft_aircraft.type_certificate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.aft_aircraft.type_certificate IS 'FAA Type Certificate number (e.g. A13WE for the Cessna 172). When set, the AD matcher includes it as a search needle against Federal Register abstracts, which often cite TC holders explicitly.';


--
-- Name: create_aircraft_atomic(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_aircraft_atomic(p_user_id uuid, p_payload jsonb) RETURNS public.aft_aircraft
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_aircraft aft_aircraft;
BEGIN
  -- Aircraft row. `created_by` is force-set from the trusted server-
  -- side user id, not whatever the payload claims.
  INSERT INTO aft_aircraft
    SELECT * FROM jsonb_populate_record(
      NULL::aft_aircraft,
      p_payload || jsonb_build_object('created_by', p_user_id)
    )
    RETURNING * INTO v_aircraft;

  -- Creator becomes an aircraft admin.
  INSERT INTO aft_user_aircraft_access (user_id, aircraft_id, aircraft_role)
    VALUES (p_user_id, v_aircraft.id, 'admin');

  -- First-time onboarding — UPSERT instead of UPDATE so a missing
  -- aft_user_roles row gets created on the spot. ON CONFLICT clause
  -- keeps the existing role/email values intact and only flips the
  -- onboarding flag, matching the migration-034 semantics ("only
  -- write if not already set").
  INSERT INTO aft_user_roles (user_id, role, completed_onboarding)
    VALUES (p_user_id, 'pilot', true)
    ON CONFLICT (user_id) DO UPDATE
      SET completed_onboarding = true
      WHERE aft_user_roles.completed_onboarding = false;

  RETURN v_aircraft;
END;
$$;


--
-- Name: create_mx_event_atomic(uuid, uuid, date, text[], uuid[], uuid[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_mx_event_atomic(p_aircraft_id uuid, p_user_id uuid, p_proposed_date date, p_addon_services text[], p_mx_item_ids uuid[], p_squawk_ids uuid[], p_initial_message text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_event_id uuid;
  v_aircraft aft_aircraft;
BEGIN
  SELECT * INTO v_aircraft
    FROM aft_aircraft
    WHERE id = p_aircraft_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aircraft not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO aft_maintenance_events (
    aircraft_id, created_by, status,
    proposed_date, proposed_by,
    addon_services,
    mx_contact_name, mx_contact_email,
    primary_contact_name, primary_contact_email
  )
  VALUES (
    p_aircraft_id, p_user_id, 'draft',
    p_proposed_date,
    CASE WHEN p_proposed_date IS NOT NULL THEN 'owner' ELSE NULL END,
    COALESCE(p_addon_services, ARRAY[]::text[]),
    v_aircraft.mx_contact,    v_aircraft.mx_contact_email,
    v_aircraft.main_contact,  v_aircraft.main_contact_email
  )
  RETURNING id INTO v_event_id;

  -- Maintenance items → line items.
  -- Aircraft scope check stops a cross-aircraft id from being
  -- attached; ids that don't belong to p_aircraft_id are just
  -- dropped from the SELECT (the API layer is the one that
  -- decides whether to surface a 404).
  IF p_mx_item_ids IS NOT NULL AND array_length(p_mx_item_ids, 1) > 0 THEN
    INSERT INTO aft_event_line_items (
      event_id, item_type, maintenance_item_id, item_name, item_description
    )
    SELECT
      v_event_id, 'maintenance', mx.id, mx.item_name,
      CASE
        WHEN mx.tracking_type = 'time' THEN 'Due at ' || mx.due_time || ' hrs'
        ELSE 'Due on ' || mx.due_date
      END
    FROM aft_maintenance_items mx
    WHERE mx.id = ANY(p_mx_item_ids)
      AND mx.aircraft_id = p_aircraft_id
      AND mx.deleted_at IS NULL;
  END IF;

  -- Squawks → line items. Same aircraft scope.
  IF p_squawk_ids IS NOT NULL AND array_length(p_squawk_ids, 1) > 0 THEN
    INSERT INTO aft_event_line_items (
      event_id, item_type, squawk_id, item_name, item_description
    )
    SELECT
      v_event_id, 'squawk', sq.id,
      CASE
        WHEN sq.description IS NOT NULL AND sq.description <> ''
          THEN 'Squawk: ' || sq.description
        ELSE 'Squawk: ' || COALESCE(NULLIF(sq.location, ''), 'No description')
      END,
      CASE
        WHEN sq.affects_airworthiness AND sq.location IS NOT NULL AND sq.location <> ''
          THEN 'Grounded at ' || sq.location
        ELSE NULLIF(sq.description, '')
      END
    FROM aft_squawks sq
    WHERE sq.id = ANY(p_squawk_ids)
      AND sq.aircraft_id = p_aircraft_id
      AND sq.deleted_at IS NULL;
  END IF;

  -- Addon services → line items
  IF p_addon_services IS NOT NULL AND array_length(p_addon_services, 1) > 0 THEN
    INSERT INTO aft_event_line_items (event_id, item_type, item_name, item_description)
    SELECT v_event_id, 'addon', value, NULL
    FROM unnest(p_addon_services) AS value;
  END IF;

  -- System message recording the creation.
  INSERT INTO aft_event_messages (event_id, sender, message_type, message)
    VALUES (v_event_id, 'system', 'status_update', p_initial_message);

  RETURN v_event_id;
END;
$$;


--
-- Name: delete_flight_log_atomic(uuid, uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_flight_log_atomic(p_log_id uuid, p_aircraft_id uuid, p_user_id uuid, p_aircraft_update jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: edit_flight_log_atomic(uuid, uuid, uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.edit_flight_log_atomic(p_log_id uuid, p_aircraft_id uuid, p_user_id uuid, p_log_data jsonb, p_aircraft_update jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: howard_rate_limit_check(uuid, bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.howard_rate_limit_check(p_user_id uuid, p_window_ms bigint, p_max_requests integer) RETURNS TABLE(allowed boolean, retry_after_ms bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_now      bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_cutoff   bigint := v_now - p_window_ms;
  v_existing bigint[];
  v_kept     bigint[];
  v_oldest   bigint;
BEGIN
  -- Lock the per-user row so concurrent callers serialize.
  SELECT timestamps INTO v_existing
  FROM aft_howard_rate_limit
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_existing IS NULL THEN
    -- First request ever: insert + allow.
    INSERT INTO aft_howard_rate_limit (user_id, timestamps, updated_at)
    VALUES (p_user_id, ARRAY[v_now], now())
    ON CONFLICT (user_id) DO UPDATE
      SET timestamps = EXCLUDED.timestamps, updated_at = now();
    RETURN QUERY SELECT true, 0::bigint;
    RETURN;
  END IF;

  -- Drop timestamps older than the window.
  SELECT coalesce(array_agg(t ORDER BY t), '{}'::bigint[]) INTO v_kept
  FROM unnest(v_existing) AS t
  WHERE t > v_cutoff;

  IF array_length(v_kept, 1) IS NOT NULL AND array_length(v_kept, 1) >= p_max_requests THEN
    -- Over budget — caller should retry after the oldest kept
    -- timestamp falls out of the window.
    v_oldest := v_kept[1];
    UPDATE aft_howard_rate_limit
    SET timestamps = v_kept, updated_at = now()
    WHERE user_id = p_user_id;
    RETURN QUERY SELECT false, (v_oldest + p_window_ms - v_now)::bigint;
    RETURN;
  END IF;

  -- Allowed: record this timestamp.
  v_kept := v_kept || v_now;
  UPDATE aft_howard_rate_limit
  SET timestamps = v_kept, updated_at = now()
  WHERE user_id = p_user_id;
  RETURN QUERY SELECT true, 0::bigint;
END;
$$;


--
-- Name: howard_web_search_check(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.howard_web_search_check(p_user_id uuid, p_max integer) RETURNS TABLE(allowed boolean, count_after integer)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_today date := (now() at time zone 'UTC')::date;
  v_count int;
BEGIN
  -- Lock the per-user-per-day row so concurrent callers serialize.
  SELECT call_count INTO v_count
    FROM aft_howard_web_search_daily
    WHERE user_id = p_user_id AND day = v_today
    FOR UPDATE;

  IF v_count IS NULL THEN
    INSERT INTO aft_howard_web_search_daily (user_id, day, call_count, updated_at)
    VALUES (p_user_id, v_today, 1, now())
    ON CONFLICT (user_id, day) DO UPDATE
      SET call_count = aft_howard_web_search_daily.call_count + 1,
          updated_at = now()
    RETURNING call_count INTO v_count;
    RETURN QUERY SELECT true, v_count;
    RETURN;
  END IF;

  IF v_count >= p_max THEN
    RETURN QUERY SELECT false, v_count;
    RETURN;
  END IF;

  UPDATE aft_howard_web_search_daily
    SET call_count = call_count + 1, updated_at = now()
    WHERE user_id = p_user_id AND day = v_today
    RETURNING call_count INTO v_count;
  RETURN QUERY SELECT true, v_count;
END;
$$;


--
-- Name: log_flight_atomic(uuid, uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_flight_atomic(p_aircraft_id uuid, p_user_id uuid, p_log_data jsonb, p_aircraft_update jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: log_record_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_record_history() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_user_id       uuid;
  v_aircraft_id   uuid;
  v_record_id     uuid;
  v_old           jsonb;
  v_new           jsonb;
  v_is_soft_del   boolean := false;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;

  -- Detect a soft-delete: deleted_at transitioning from NULL to set.
  -- jsonb ->> yields NULL if the column doesn't exist on the row, so
  -- this is safe on tables that don't have deleted_at (none of the
  -- tracked tables today, but future-proof).
  IF TG_OP = 'UPDATE'
     AND (v_old->>'deleted_at') IS NULL
     AND (v_new->>'deleted_at') IS NOT NULL THEN
    v_is_soft_del := true;
  END IF;

  -- ── User attribution, most-reliable first. ────────────────────────
  BEGIN
    IF TG_OP = 'INSERT' THEN
      v_user_id := nullif(v_new->>'created_by', '')::uuid;
    ELSIF v_is_soft_del THEN
      v_user_id := nullif(v_new->>'deleted_by', '')::uuid;
    ELSIF TG_OP = 'DELETE' THEN
      v_user_id := nullif(v_old->>'deleted_by', '')::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  -- Fall back to the transaction session var (when set in the same
  -- transaction as the write — works for direct SQL / PostgREST
  -- multi-step procs; does NOT work for supabase-js because each
  -- rpc/insert is a separate HTTP transaction).
  IF v_user_id IS NULL THEN
    BEGIN
      v_user_id := nullif(current_setting('app.current_user_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_user_id := NULL;
    END;
  END IF;

  -- Last resort: whoever's logged in via PostgREST auth (NULL under
  -- service-role, which is how the API layer connects).
  IF v_user_id IS NULL THEN
    BEGIN
      v_user_id := auth.uid();
    EXCEPTION WHEN OTHERS THEN
      v_user_id := NULL;
    END;
  END IF;

  -- ── Identify the record + its aircraft. ───────────────────────────
  IF TG_OP = 'DELETE' THEN
    v_record_id := (v_old->>'id')::uuid;
    v_aircraft_id := coalesce(
      nullif(v_old->>'aircraft_id', '')::uuid,
      CASE WHEN TG_TABLE_NAME = 'aft_aircraft' THEN v_record_id ELSE NULL END
    );
    INSERT INTO aft_record_history (table_name, record_id, aircraft_id, operation, user_id, old_row, new_row)
    VALUES (TG_TABLE_NAME, v_record_id, v_aircraft_id, 'DELETE', v_user_id, v_old, NULL);
    RETURN OLD;
  ELSE
    v_record_id := (v_new->>'id')::uuid;
    v_aircraft_id := coalesce(
      nullif(v_new->>'aircraft_id', '')::uuid,
      CASE WHEN TG_TABLE_NAME = 'aft_aircraft' THEN v_record_id ELSE NULL END
    );
    IF TG_OP = 'INSERT' THEN
      INSERT INTO aft_record_history (table_name, record_id, aircraft_id, operation, user_id, old_row, new_row)
      VALUES (TG_TABLE_NAME, v_record_id, v_aircraft_id, 'INSERT', v_user_id, NULL, v_new);
    ELSE
      INSERT INTO aft_record_history (table_name, record_id, aircraft_id, operation, user_id, old_row, new_row)
      VALUES (TG_TABLE_NAME, v_record_id, v_aircraft_id, 'UPDATE', v_user_id, v_old, v_new);
    END IF;
    RETURN NEW;
  END IF;
END;
$$;


--
-- Name: match_document_chunks(text, uuid, integer, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_document_chunks(query_embedding text, match_aircraft_id uuid, match_count integer DEFAULT 5, match_threshold double precision DEFAULT 0.3) RETURNS TABLE(id uuid, document_id uuid, chunk_index integer, content text, page_number integer, similarity double precision)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.document_id,
    c.chunk_index,
    c.content,
    c.page_number,
    1 - (c.embedding <=> query_embedding::vector) AS similarity
  FROM aft_document_chunks c
  JOIN aft_documents d ON d.id = c.document_id
  WHERE d.aircraft_id = match_aircraft_id
    AND d.deleted_at IS NULL
    AND d.status = 'ready'
    AND 1 - (c.embedding <=> query_embedding::vector) > match_threshold
  ORDER BY c.embedding <=> query_embedding::vector
  LIMIT match_count;
END;
$$;


--
-- Name: match_document_chunks(public.vector, uuid, integer, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_document_chunks(query_embedding public.vector, match_aircraft_id uuid, match_count integer DEFAULT 5, match_threshold double precision DEFAULT 0.3) RETURNS TABLE(id uuid, document_id uuid, chunk_index integer, content text, similarity double precision)
    LANGUAGE sql STABLE
    AS $$
  SELECT
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.content,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM aft_document_chunks dc
  JOIN aft_documents d ON d.id = dc.document_id
  WHERE d.aircraft_id = match_aircraft_id
    AND d.status = 'ready'
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;


--
-- Name: set_app_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_app_user(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id::text, true);
END;
$$;


--
-- Name: submit_rate_limit_check(uuid, bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_rate_limit_check(p_user_id uuid, p_window_ms bigint, p_max_requests integer) RETURNS TABLE(allowed boolean, retry_after_ms bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_now      bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_cutoff   bigint := v_now - p_window_ms;
  v_existing bigint[];
  v_kept     bigint[];
  v_oldest   bigint;
BEGIN
  SELECT timestamps INTO v_existing
  FROM aft_submit_rate_limit
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_existing IS NULL THEN
    INSERT INTO aft_submit_rate_limit (user_id, timestamps, updated_at)
    VALUES (p_user_id, ARRAY[v_now], now())
    ON CONFLICT (user_id) DO UPDATE
      SET timestamps = EXCLUDED.timestamps, updated_at = now();
    RETURN QUERY SELECT true, 0::bigint;
    RETURN;
  END IF;

  SELECT coalesce(array_agg(t ORDER BY t), '{}'::bigint[]) INTO v_kept
  FROM unnest(v_existing) AS t
  WHERE t > v_cutoff;

  IF array_length(v_kept, 1) IS NOT NULL AND array_length(v_kept, 1) >= p_max_requests THEN
    v_oldest := v_kept[1];
    UPDATE aft_submit_rate_limit
    SET timestamps = v_kept, updated_at = now()
    WHERE user_id = p_user_id;
    RETURN QUERY SELECT false, (v_oldest + p_window_ms - v_now)::bigint;
    RETURN;
  END IF;

  v_kept := v_kept || v_now;
  UPDATE aft_submit_rate_limit
  SET timestamps = v_kept, updated_at = now()
  WHERE user_id = p_user_id;
  RETURN QUERY SELECT true, 0::bigint;
END;
$$;


--
-- Name: update_user_prefs_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_user_prefs_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: aft_ad_applicability_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_ad_applicability_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ad_number text NOT NULL,
    source_hash text NOT NULL,
    parsed jsonb NOT NULL,
    parsed_at timestamp with time zone DEFAULT now() NOT NULL,
    parsed_by text DEFAULT 'haiku'::text NOT NULL
);


--
-- Name: TABLE aft_ad_applicability_cache; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.aft_ad_applicability_cache IS 'Global, aircraft-agnostic cache of LLM-parsed AD applicability. One Haiku parse per AD serves every aircraft that matches it. Keyed by (ad_number, source_hash) so content changes trigger a re-parse.';


--
-- Name: COLUMN aft_ad_applicability_cache.parsed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.aft_ad_applicability_cache.parsed IS 'Structured applicability: serial_ranges [{start, end, inclusive}], engine_matches [string], prop_matches [string], notes (string).';


--
-- Name: aft_aircraft_equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_aircraft_equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aircraft_id uuid NOT NULL,
    category public.aft_equipment_category NOT NULL,
    name text NOT NULL,
    make text,
    model text,
    serial text,
    part_number text,
    installed_at date,
    installed_by text,
    removed_at date,
    removed_reason text,
    ifr_capable boolean DEFAULT false NOT NULL,
    adsb_out boolean DEFAULT false NOT NULL,
    adsb_in boolean DEFAULT false NOT NULL,
    transponder_class text,
    is_elt boolean DEFAULT false NOT NULL,
    elt_battery_expires date,
    elt_battery_cumulative_hours numeric,
    pitot_static_due_date date,
    transponder_due_date date,
    altimeter_due_date date,
    vor_due_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    deleted_at timestamp with time zone,
    deleted_by uuid
);


--
-- Name: aft_airworthiness_directives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_airworthiness_directives (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aircraft_id uuid NOT NULL,
    ad_number text NOT NULL,
    amendment text,
    subject text NOT NULL,
    applicability text,
    source_url text,
    source text DEFAULT 'manual'::text NOT NULL,
    effective_date date,
    is_superseded boolean DEFAULT false NOT NULL,
    superseded_by text,
    compliance_type text DEFAULT 'one_time'::text NOT NULL,
    initial_compliance_hours numeric,
    initial_compliance_date date,
    recurring_interval_hours numeric,
    recurring_interval_months integer,
    last_complied_date date,
    last_complied_time numeric,
    last_complied_by text,
    next_due_date date,
    next_due_time numeric,
    compliance_method text,
    notes text,
    affects_airworthiness boolean DEFAULT true NOT NULL,
    synced_at timestamp with time zone,
    sync_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    applicability_status text,
    applicability_reason text,
    applicability_checked_at timestamp with time zone,
    CONSTRAINT aft_airworthiness_directives_applicability_status_check CHECK (((applicability_status IS NULL) OR (applicability_status = ANY (ARRAY['applies'::text, 'does_not_apply'::text, 'review_required'::text])))),
    CONSTRAINT aft_airworthiness_directives_compliance_type_check CHECK ((compliance_type = ANY (ARRAY['one_time'::text, 'recurring'::text]))),
    CONSTRAINT aft_airworthiness_directives_source_check CHECK ((source = ANY (ARRAY['drs_sync'::text, 'manual'::text, 'user_added'::text])))
);


--
-- Name: COLUMN aft_airworthiness_directives.applicability_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.aft_airworthiness_directives.applicability_status IS 'Verdict on whether this AD applies to THIS aircraft specifically. ''applies'' = in-serial / matching engine, ''does_not_apply'' = out of range, ''review_required'' = matched make/model but serial-level check was ambiguous. NULL = never checked (e.g. manual entries or pre-038 rows).';


--
-- Name: aft_document_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_document_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    embedding public.vector(1536),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    page_number integer
);


--
-- Name: aft_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aircraft_id uuid NOT NULL,
    user_id uuid,
    filename text NOT NULL,
    file_url text NOT NULL,
    doc_type text NOT NULL,
    page_count integer,
    status text DEFAULT 'processing'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    sha256 text,
    file_size bigint,
    CONSTRAINT aft_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['POH'::text, 'AFM'::text, 'Supplement'::text, 'MEL'::text, 'SOP'::text, 'Other'::text]))),
    CONSTRAINT aft_documents_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'ready'::text, 'error'::text])))
);


--
-- Name: aft_event_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_event_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    item_type text NOT NULL,
    maintenance_item_id uuid,
    squawk_id uuid,
    item_name text NOT NULL,
    item_description text,
    line_status text DEFAULT 'pending'::text NOT NULL,
    mechanic_comment text,
    completion_date date,
    completion_time numeric,
    completed_by_name text,
    completed_by_cert text,
    work_description text,
    created_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    deleted_by uuid,
    cert_type text,
    cert_number text,
    cert_expiry date,
    tach_at_completion numeric,
    hobbs_at_completion numeric,
    logbook_ref text,
    locked_at timestamp with time zone,
    locked_by uuid,
    CONSTRAINT aft_event_line_items_cert_type_check CHECK ((cert_type = ANY (ARRAY['A&P'::text, 'IA'::text, 'Repairman'::text, 'Pilot-Owner'::text, 'Other'::text]))),
    CONSTRAINT aft_event_line_items_item_type_check CHECK ((item_type = ANY (ARRAY['maintenance'::text, 'squawk'::text, 'addon'::text]))),
    CONSTRAINT aft_event_line_items_line_status_check CHECK ((line_status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'complete'::text, 'deferred'::text])))
);


--
-- Name: aft_event_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_event_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    sender text NOT NULL,
    message_type text NOT NULL,
    proposed_date date,
    message text,
    created_at timestamp with time zone DEFAULT now(),
    attachments jsonb,
    CONSTRAINT aft_event_messages_message_type_check CHECK ((message_type = ANY (ARRAY['propose_date'::text, 'confirm'::text, 'counter'::text, 'comment'::text, 'status_update'::text]))),
    CONSTRAINT aft_event_messages_sender_check CHECK ((sender = ANY (ARRAY['owner'::text, 'mechanic'::text, 'system'::text])))
);


--
-- Name: aft_flight_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_flight_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aircraft_id uuid,
    user_id uuid,
    aftt numeric,
    ftt numeric,
    engine_cycles integer NOT NULL,
    landings integer NOT NULL,
    initials text NOT NULL,
    pax_info text,
    trip_reason text,
    created_at timestamp with time zone DEFAULT now(),
    hobbs numeric,
    tach numeric,
    fuel_gallons numeric,
    pod text,
    poa text,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT aft_flight_logs_trip_reason_check CHECK (((trip_reason = ANY (ARRAY['PE'::text, 'BE'::text, 'MX'::text, 'T'::text, ''::text])) OR (trip_reason IS NULL)))
);


--
-- Name: aft_howard_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_howard_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    tool_calls jsonb,
    tool_results jsonb,
    input_tokens integer,
    output_tokens integer,
    cache_read_tokens integer,
    cache_create_tokens integer,
    model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT aft_chuck_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);


--
-- Name: aft_howard_rate_limit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_howard_rate_limit (
    user_id uuid NOT NULL,
    timestamps bigint[] DEFAULT '{}'::bigint[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: aft_howard_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_howard_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    summary text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: aft_howard_web_search_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_howard_web_search_daily (
    user_id uuid NOT NULL,
    day date NOT NULL,
    call_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: aft_maintenance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_maintenance_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aircraft_id uuid NOT NULL,
    created_by uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    proposed_date date,
    proposed_by text,
    confirmed_date date,
    addon_services jsonb DEFAULT '[]'::jsonb,
    access_token text DEFAULT encode(extensions.gen_random_bytes(32), 'hex'::text) NOT NULL,
    mechanic_notes text,
    estimated_completion date,
    created_at timestamp with time zone DEFAULT now(),
    confirmed_at timestamp with time zone,
    completed_at timestamp with time zone,
    mx_contact_name text,
    mx_contact_email text,
    primary_contact_name text,
    primary_contact_email text,
    service_duration_days integer,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    locked_at timestamp with time zone,
    locked_by uuid,
    CONSTRAINT aft_maintenance_events_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduling'::text, 'confirmed'::text, 'in_progress'::text, 'ready_for_pickup'::text, 'complete'::text, 'cancelled'::text])))
);


--
-- Name: COLUMN aft_maintenance_events.service_duration_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.aft_maintenance_events.service_duration_days IS 'Estimated duration of service in days. Set by the mechanic when proposing or confirming a date. Used to compute estimated_completion and block the calendar.';


--
-- Name: aft_maintenance_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_maintenance_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aircraft_id uuid,
    item_name text NOT NULL,
    due_date date,
    due_time numeric,
    created_at timestamp with time zone DEFAULT now(),
    tracking_type text DEFAULT 'time'::text,
    is_required boolean DEFAULT true,
    last_completed_time numeric,
    time_interval numeric,
    last_completed_date date,
    date_interval_days integer,
    automate_scheduling boolean DEFAULT false,
    reminder_30_sent boolean DEFAULT false,
    reminder_15_sent boolean DEFAULT false,
    reminder_5_sent boolean DEFAULT false,
    mx_schedule_sent boolean DEFAULT false,
    primary_heads_up_sent boolean DEFAULT false,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT aft_maintenance_items_tracking_type_check CHECK ((tracking_type = ANY (ARRAY['time'::text, 'date'::text, 'both'::text])))
);


--
-- Name: aft_note_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_note_reads (
    note_id uuid NOT NULL,
    user_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now()
);


--
-- Name: aft_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aircraft_id uuid,
    content text NOT NULL,
    author_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    pictures text[],
    edited_at timestamp with time zone,
    author_email text,
    author_initials text,
    deleted_at timestamp with time zone,
    deleted_by uuid
);


--
-- Name: aft_notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_notification_preferences (
    user_id uuid NOT NULL,
    notification_type text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: aft_oil_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_oil_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aircraft_id uuid NOT NULL,
    user_id uuid,
    oil_qty numeric(4,1) NOT NULL,
    oil_added numeric(4,1),
    engine_hours numeric(8,1) NOT NULL,
    initials text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: aft_proposed_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_proposed_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    message_id uuid,
    user_id uuid NOT NULL,
    aircraft_id uuid,
    action_type text NOT NULL,
    payload jsonb NOT NULL,
    summary text NOT NULL,
    required_role text DEFAULT 'access'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    confirmed_at timestamp with time zone,
    confirmed_by uuid,
    cancelled_at timestamp with time zone,
    executed_at timestamp with time zone,
    executed_record_id uuid,
    executed_record_table text,
    error_message text,
    CONSTRAINT aft_proposed_actions_action_type_check CHECK ((action_type = ANY (ARRAY['reservation'::text, 'mx_schedule'::text, 'squawk_resolve'::text, 'note'::text, 'equipment'::text, 'onboarding_setup'::text]))),
    CONSTRAINT aft_proposed_actions_required_role_check CHECK ((required_role = ANY (ARRAY['access'::text, 'admin'::text]))),
    CONSTRAINT aft_proposed_actions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text, 'executed'::text, 'failed'::text])))
);


--
-- Name: aft_record_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_record_history (
    id bigint NOT NULL,
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    aircraft_id uuid,
    operation text NOT NULL,
    user_id uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    old_row jsonb,
    new_row jsonb,
    CONSTRAINT aft_record_history_operation_check CHECK ((operation = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


--
-- Name: aft_record_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.aft_record_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: aft_record_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.aft_record_history_id_seq OWNED BY public.aft_record_history.id;


--
-- Name: aft_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aircraft_id uuid NOT NULL,
    user_id uuid,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    title text,
    route text,
    pilot_name text,
    pilot_initials text,
    status text DEFAULT 'confirmed'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    time_zone text,
    CONSTRAINT aft_reservations_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'cancelled'::text]))),
    CONSTRAINT valid_time_range CHECK ((end_time > start_time))
);


--
-- Name: aft_squawks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_squawks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aircraft_id uuid,
    description text NOT NULL,
    status text DEFAULT 'open'::text,
    reported_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    location text,
    pictures text[],
    is_deferred boolean DEFAULT false,
    mel_number text,
    cdl_number text,
    nef_number text,
    mdl_number text,
    mel_control_number text,
    deferral_category text,
    deferral_procedures_completed boolean DEFAULT false,
    signature_data text,
    signature_date date,
    full_name text,
    certificate_number text,
    affects_airworthiness boolean DEFAULT false,
    reporter_initials text,
    resolved_by_event_id uuid,
    resolved_note text,
    edited_at timestamp with time zone,
    edited_by_initials text,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    mx_notify_failed boolean DEFAULT false NOT NULL,
    access_token text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT aft_squawks_deferral_category_check CHECK ((deferral_category = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text, 'NA'::text, NULL::text]))),
    CONSTRAINT aft_squawks_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))
);


--
-- Name: aft_submit_rate_limit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_submit_rate_limit (
    user_id uuid NOT NULL,
    timestamps bigint[] DEFAULT '{}'::bigint[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: aft_system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_system_settings (
    id integer DEFAULT 1 NOT NULL,
    reminder_1 integer DEFAULT 30,
    reminder_2 integer DEFAULT 15,
    reminder_3 integer DEFAULT 5,
    sched_time integer DEFAULT 10,
    sched_days integer DEFAULT 30,
    predictive_sched_days integer DEFAULT 45,
    reminder_hours_1 integer DEFAULT 30,
    reminder_hours_2 integer DEFAULT 15,
    reminder_hours_3 integer DEFAULT 5
);


--
-- Name: aft_tire_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_tire_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aircraft_id uuid NOT NULL,
    user_id uuid,
    nose_psi numeric(5,1),
    left_main_psi numeric(5,1),
    right_main_psi numeric(5,1),
    initials text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: aft_user_aircraft_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_user_aircraft_access (
    user_id uuid NOT NULL,
    aircraft_id uuid NOT NULL,
    aircraft_role text DEFAULT 'pilot'::text NOT NULL,
    CONSTRAINT aft_user_aircraft_access_aircraft_role_check CHECK ((aircraft_role = ANY (ARRAY['admin'::text, 'pilot'::text]))),
    CONSTRAINT aft_user_aircraft_access_role_chk CHECK ((aircraft_role = ANY (ARRAY['admin'::text, 'pilot'::text])))
);


--
-- Name: aft_user_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_user_preferences (
    user_id uuid NOT NULL,
    pref_key text NOT NULL,
    value jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: aft_user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_user_roles (
    user_id uuid NOT NULL,
    role text DEFAULT 'pilot'::text,
    initials text,
    email text,
    full_name text,
    faa_ratings text[] DEFAULT '{}'::text[] NOT NULL,
    completed_onboarding boolean DEFAULT false NOT NULL,
    tour_completed boolean DEFAULT false NOT NULL,
    CONSTRAINT aft_user_roles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'pilot'::text])))
);


--
-- Name: COLUMN aft_user_roles.faa_ratings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.aft_user_roles.faa_ratings IS 'Pilot FAA ratings / certificates held by the user (e.g. PPL, IFR, CPL, ATP, CFI, CFII, MEI, ME, Student, Sport, Recreational). App-level whitelist in src/lib/types.ts. Purely for Howard context + UI; not used for authorization.';


--
-- Name: aft_vor_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aft_vor_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aircraft_id uuid NOT NULL,
    user_id uuid,
    check_type text NOT NULL,
    station text NOT NULL,
    bearing_error numeric(4,1) NOT NULL,
    tolerance numeric(4,1) NOT NULL,
    passed boolean NOT NULL,
    initials text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT aft_vor_checks_check_type_check CHECK ((check_type = ANY (ARRAY['VOT'::text, 'Ground Checkpoint'::text, 'Airborne Checkpoint'::text, 'Dual VOR'::text])))
);


--
-- Name: itin_aircraft; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.itin_aircraft (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tail_number text NOT NULL,
    aircraft_type text
);


--
-- Name: itin_fbos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.itin_fbos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    airport_code text NOT NULL,
    fbo_name text NOT NULL,
    address text
);


--
-- Name: itin_itineraries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.itin_itineraries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trip_name text NOT NULL,
    trip_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: itin_passengers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.itin_passengers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    email text
);


--
-- Name: itin_pilots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.itin_pilots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    email text
);


--
-- Name: aft_record_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_record_history ALTER COLUMN id SET DEFAULT nextval('public.aft_record_history_id_seq'::regclass);


--
-- Name: aft_ad_applicability_cache aft_ad_applicability_cache_ad_number_source_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_ad_applicability_cache
    ADD CONSTRAINT aft_ad_applicability_cache_ad_number_source_hash_key UNIQUE (ad_number, source_hash);


--
-- Name: aft_ad_applicability_cache aft_ad_applicability_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_ad_applicability_cache
    ADD CONSTRAINT aft_ad_applicability_cache_pkey PRIMARY KEY (id);


--
-- Name: aft_aircraft_equipment aft_aircraft_equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_aircraft_equipment
    ADD CONSTRAINT aft_aircraft_equipment_pkey PRIMARY KEY (id);


--
-- Name: aft_aircraft aft_aircraft_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_aircraft
    ADD CONSTRAINT aft_aircraft_pkey PRIMARY KEY (id);


--
-- Name: aft_aircraft aft_aircraft_tail_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_aircraft
    ADD CONSTRAINT aft_aircraft_tail_number_key UNIQUE (tail_number);


--
-- Name: aft_airworthiness_directives aft_airworthiness_directives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_airworthiness_directives
    ADD CONSTRAINT aft_airworthiness_directives_pkey PRIMARY KEY (id);


--
-- Name: aft_howard_messages aft_chuck_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_howard_messages
    ADD CONSTRAINT aft_chuck_messages_pkey PRIMARY KEY (id);


--
-- Name: aft_howard_threads aft_chuck_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_howard_threads
    ADD CONSTRAINT aft_chuck_threads_pkey PRIMARY KEY (id);


--
-- Name: aft_document_chunks aft_document_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_document_chunks
    ADD CONSTRAINT aft_document_chunks_pkey PRIMARY KEY (id);


--
-- Name: aft_documents aft_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_documents
    ADD CONSTRAINT aft_documents_pkey PRIMARY KEY (id);


--
-- Name: aft_event_line_items aft_event_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_event_line_items
    ADD CONSTRAINT aft_event_line_items_pkey PRIMARY KEY (id);


--
-- Name: aft_event_messages aft_event_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_event_messages
    ADD CONSTRAINT aft_event_messages_pkey PRIMARY KEY (id);


--
-- Name: aft_flight_logs aft_flight_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_flight_logs
    ADD CONSTRAINT aft_flight_logs_pkey PRIMARY KEY (id);


--
-- Name: aft_howard_rate_limit aft_howard_rate_limit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_howard_rate_limit
    ADD CONSTRAINT aft_howard_rate_limit_pkey PRIMARY KEY (user_id);


--
-- Name: aft_howard_threads aft_howard_threads_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_howard_threads
    ADD CONSTRAINT aft_howard_threads_user_id_unique UNIQUE (user_id);


--
-- Name: aft_howard_web_search_daily aft_howard_web_search_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_howard_web_search_daily
    ADD CONSTRAINT aft_howard_web_search_daily_pkey PRIMARY KEY (user_id, day);


--
-- Name: aft_maintenance_events aft_maintenance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_maintenance_events
    ADD CONSTRAINT aft_maintenance_events_pkey PRIMARY KEY (id);


--
-- Name: aft_maintenance_items aft_maintenance_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_maintenance_items
    ADD CONSTRAINT aft_maintenance_items_pkey PRIMARY KEY (id);


--
-- Name: aft_note_reads aft_note_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_note_reads
    ADD CONSTRAINT aft_note_reads_pkey PRIMARY KEY (note_id, user_id);


--
-- Name: aft_notes aft_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_notes
    ADD CONSTRAINT aft_notes_pkey PRIMARY KEY (id);


--
-- Name: aft_notification_preferences aft_notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_notification_preferences
    ADD CONSTRAINT aft_notification_preferences_pkey PRIMARY KEY (user_id, notification_type);


--
-- Name: aft_oil_logs aft_oil_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_oil_logs
    ADD CONSTRAINT aft_oil_logs_pkey PRIMARY KEY (id);


--
-- Name: aft_proposed_actions aft_proposed_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_proposed_actions
    ADD CONSTRAINT aft_proposed_actions_pkey PRIMARY KEY (id);


--
-- Name: aft_record_history aft_record_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_record_history
    ADD CONSTRAINT aft_record_history_pkey PRIMARY KEY (id);


--
-- Name: aft_reservations aft_reservations_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_reservations
    ADD CONSTRAINT aft_reservations_no_overlap EXCLUDE USING gist (aircraft_id WITH =, tstzrange(start_time, end_time) WITH &&) WHERE ((status = 'confirmed'::text));


--
-- Name: aft_reservations aft_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_reservations
    ADD CONSTRAINT aft_reservations_pkey PRIMARY KEY (id);


--
-- Name: aft_squawks aft_squawks_access_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_squawks
    ADD CONSTRAINT aft_squawks_access_token_key UNIQUE (access_token);


--
-- Name: aft_squawks aft_squawks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_squawks
    ADD CONSTRAINT aft_squawks_pkey PRIMARY KEY (id);


--
-- Name: aft_submit_rate_limit aft_submit_rate_limit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_submit_rate_limit
    ADD CONSTRAINT aft_submit_rate_limit_pkey PRIMARY KEY (user_id);


--
-- Name: aft_system_settings aft_system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_system_settings
    ADD CONSTRAINT aft_system_settings_pkey PRIMARY KEY (id);


--
-- Name: aft_tire_checks aft_tire_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_tire_checks
    ADD CONSTRAINT aft_tire_checks_pkey PRIMARY KEY (id);


--
-- Name: aft_user_aircraft_access aft_user_aircraft_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_user_aircraft_access
    ADD CONSTRAINT aft_user_aircraft_access_pkey PRIMARY KEY (user_id, aircraft_id);


--
-- Name: aft_user_preferences aft_user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_user_preferences
    ADD CONSTRAINT aft_user_preferences_pkey PRIMARY KEY (user_id, pref_key);


--
-- Name: aft_user_roles aft_user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_user_roles
    ADD CONSTRAINT aft_user_roles_pkey PRIMARY KEY (user_id);


--
-- Name: aft_vor_checks aft_vor_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_vor_checks
    ADD CONSTRAINT aft_vor_checks_pkey PRIMARY KEY (id);


--
-- Name: itin_aircraft itin_aircraft_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.itin_aircraft
    ADD CONSTRAINT itin_aircraft_pkey PRIMARY KEY (id);


--
-- Name: itin_aircraft itin_aircraft_tail_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.itin_aircraft
    ADD CONSTRAINT itin_aircraft_tail_number_key UNIQUE (tail_number);


--
-- Name: itin_fbos itin_fbos_airport_code_fbo_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.itin_fbos
    ADD CONSTRAINT itin_fbos_airport_code_fbo_name_key UNIQUE (airport_code, fbo_name);


--
-- Name: itin_fbos itin_fbos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.itin_fbos
    ADD CONSTRAINT itin_fbos_pkey PRIMARY KEY (id);


--
-- Name: itin_itineraries itin_itineraries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.itin_itineraries
    ADD CONSTRAINT itin_itineraries_pkey PRIMARY KEY (id);


--
-- Name: itin_itineraries itin_itineraries_trip_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.itin_itineraries
    ADD CONSTRAINT itin_itineraries_trip_name_key UNIQUE (trip_name);


--
-- Name: itin_passengers itin_passengers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.itin_passengers
    ADD CONSTRAINT itin_passengers_name_key UNIQUE (name);


--
-- Name: itin_passengers itin_passengers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.itin_passengers
    ADD CONSTRAINT itin_passengers_pkey PRIMARY KEY (id);


--
-- Name: itin_pilots itin_pilots_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.itin_pilots
    ADD CONSTRAINT itin_pilots_name_key UNIQUE (name);


--
-- Name: itin_pilots itin_pilots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.itin_pilots
    ADD CONSTRAINT itin_pilots_pkey PRIMARY KEY (id);


--
-- Name: aft_reservations no_overlapping_reservations; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_reservations
    ADD CONSTRAINT no_overlapping_reservations EXCLUDE USING gist (aircraft_id WITH =, tstzrange(start_time, end_time) WITH &&) WHERE ((status = 'confirmed'::text));


--
-- Name: idx_ad_cache_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_cache_lookup ON public.aft_ad_applicability_cache USING btree (ad_number, source_hash);


--
-- Name: idx_ads_aircraft_adnum_live; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ads_aircraft_adnum_live ON public.aft_airworthiness_directives USING btree (aircraft_id, ad_number) WHERE (deleted_at IS NULL);


--
-- Name: idx_ads_aircraft_due_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_aircraft_due_time ON public.aft_airworthiness_directives USING btree (aircraft_id, next_due_time) WHERE ((deleted_at IS NULL) AND (is_superseded = false) AND (next_due_time IS NOT NULL));


--
-- Name: idx_ads_aircraft_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_aircraft_live ON public.aft_airworthiness_directives USING btree (aircraft_id, next_due_date) WHERE ((deleted_at IS NULL) AND (is_superseded = false));


--
-- Name: idx_aft_squawks_access_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aft_squawks_access_token ON public.aft_squawks USING btree (access_token);


--
-- Name: idx_aircraft_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aircraft_live ON public.aft_aircraft USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_chunks_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chunks_document ON public.aft_document_chunks USING btree (document_id, chunk_index);


--
-- Name: idx_documents_aircraft; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_aircraft ON public.aft_documents USING btree (aircraft_id, created_at DESC);


--
-- Name: idx_documents_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_live ON public.aft_documents USING btree (aircraft_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_documents_sha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_sha ON public.aft_documents USING btree (aircraft_id, sha256) WHERE (deleted_at IS NULL);


--
-- Name: idx_equipment_aircraft_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipment_aircraft_live ON public.aft_aircraft_equipment USING btree (aircraft_id, category) WHERE ((deleted_at IS NULL) AND (removed_at IS NULL));


--
-- Name: idx_equipment_ifr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipment_ifr ON public.aft_aircraft_equipment USING btree (aircraft_id) WHERE ((deleted_at IS NULL) AND (removed_at IS NULL) AND (ifr_capable = true));


--
-- Name: idx_event_line_items_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_line_items_event ON public.aft_event_line_items USING btree (event_id);


--
-- Name: idx_event_messages_attachments; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_messages_attachments ON public.aft_event_messages USING btree (id) WHERE (attachments IS NOT NULL);


--
-- Name: idx_event_messages_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_messages_event ON public.aft_event_messages USING btree (event_id);


--
-- Name: idx_flight_logs_aircraft_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flight_logs_aircraft_id ON public.aft_flight_logs USING btree (aircraft_id);


--
-- Name: idx_flight_logs_aircraft_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flight_logs_aircraft_occurred ON public.aft_flight_logs USING btree (aircraft_id, occurred_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_flight_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flight_logs_created_at ON public.aft_flight_logs USING btree (created_at DESC);


--
-- Name: idx_flight_logs_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flight_logs_live ON public.aft_flight_logs USING btree (aircraft_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_howard_messages_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_howard_messages_thread ON public.aft_howard_messages USING btree (thread_id, created_at);


--
-- Name: idx_howard_rl_stale; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_howard_rl_stale ON public.aft_howard_rate_limit USING btree (updated_at);


--
-- Name: idx_howard_threads_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_howard_threads_user ON public.aft_howard_threads USING btree (user_id, updated_at DESC);


--
-- Name: idx_howard_web_search_daily_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_howard_web_search_daily_day ON public.aft_howard_web_search_daily USING btree (day);


--
-- Name: idx_mx_events_aircraft; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mx_events_aircraft ON public.aft_maintenance_events USING btree (aircraft_id);


--
-- Name: idx_mx_events_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mx_events_live ON public.aft_maintenance_events USING btree (aircraft_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_mx_events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mx_events_status ON public.aft_maintenance_events USING btree (status);


--
-- Name: idx_mx_events_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mx_events_token ON public.aft_maintenance_events USING btree (access_token);


--
-- Name: idx_mx_items_aircraft_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mx_items_aircraft_id ON public.aft_maintenance_items USING btree (aircraft_id);


--
-- Name: idx_mx_items_due_date_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mx_items_due_date_pending ON public.aft_maintenance_items USING btree (aircraft_id, due_date) WHERE (due_date IS NOT NULL);


--
-- Name: idx_mx_items_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mx_items_live ON public.aft_maintenance_items USING btree (aircraft_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_note_reads_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_note_reads_user_id ON public.aft_note_reads USING btree (user_id);


--
-- Name: idx_notes_aircraft_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_aircraft_id ON public.aft_notes USING btree (aircraft_id);


--
-- Name: idx_notes_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_live ON public.aft_notes USING btree (aircraft_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_notification_prefs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_prefs_user ON public.aft_notification_preferences USING btree (user_id);


--
-- Name: idx_oil_logs_aircraft; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oil_logs_aircraft ON public.aft_oil_logs USING btree (aircraft_id, created_at DESC);


--
-- Name: idx_oil_logs_aircraft_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oil_logs_aircraft_occurred ON public.aft_oil_logs USING btree (aircraft_id, occurred_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_proposed_actions_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proposed_actions_thread ON public.aft_proposed_actions USING btree (thread_id, created_at DESC);


--
-- Name: idx_proposed_actions_user_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proposed_actions_user_pending ON public.aft_proposed_actions USING btree (user_id, status) WHERE (status = 'pending'::text);


--
-- Name: idx_record_history_aircraft; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_record_history_aircraft ON public.aft_record_history USING btree (aircraft_id, changed_at DESC);


--
-- Name: idx_record_history_table_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_record_history_table_record ON public.aft_record_history USING btree (table_name, record_id, changed_at DESC);


--
-- Name: idx_record_history_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_record_history_user ON public.aft_record_history USING btree (user_id, changed_at DESC);


--
-- Name: idx_reservations_aircraft_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservations_aircraft_time ON public.aft_reservations USING btree (aircraft_id, start_time, end_time) WHERE (status = 'confirmed'::text);


--
-- Name: idx_reservations_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservations_user ON public.aft_reservations USING btree (user_id) WHERE (status = 'confirmed'::text);


--
-- Name: idx_squawks_aircraft_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_squawks_aircraft_id ON public.aft_squawks USING btree (aircraft_id);


--
-- Name: idx_squawks_aircraft_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_squawks_aircraft_occurred ON public.aft_squawks USING btree (aircraft_id, occurred_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_squawks_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_squawks_live ON public.aft_squawks USING btree (aircraft_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_squawks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_squawks_status ON public.aft_squawks USING btree (status);


--
-- Name: idx_submit_rl_stale; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submit_rl_stale ON public.aft_submit_rate_limit USING btree (updated_at);


--
-- Name: idx_tire_checks_aircraft; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tire_checks_aircraft ON public.aft_tire_checks USING btree (aircraft_id, created_at DESC);


--
-- Name: idx_tire_checks_aircraft_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tire_checks_aircraft_occurred ON public.aft_tire_checks USING btree (aircraft_id, occurred_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_user_prefs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_prefs_user ON public.aft_user_preferences USING btree (user_id);


--
-- Name: idx_vor_checks_aircraft; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vor_checks_aircraft ON public.aft_vor_checks USING btree (aircraft_id, created_at DESC);


--
-- Name: idx_vor_checks_aircraft_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vor_checks_aircraft_occurred ON public.aft_vor_checks USING btree (aircraft_id, occurred_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_vor_checks_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vor_checks_live ON public.aft_vor_checks USING btree (aircraft_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: aft_squawks aft_squawks_access_token_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER aft_squawks_access_token_trg BEFORE INSERT ON public.aft_squawks FOR EACH ROW EXECUTE FUNCTION public.aft_squawks_set_access_token();


--
-- Name: aft_squawks aft_squawks_rotate_token_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER aft_squawks_rotate_token_trg BEFORE UPDATE OF status ON public.aft_squawks FOR EACH ROW EXECUTE FUNCTION public.aft_squawks_rotate_token_on_resolve();


--
-- Name: aft_airworthiness_directives trg_ads_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ads_touch BEFORE UPDATE ON public.aft_airworthiness_directives FOR EACH ROW EXECUTE FUNCTION public.aft_ads_touch_updated_at();


--
-- Name: aft_event_line_items trg_block_locked_line_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_block_locked_line_items BEFORE UPDATE ON public.aft_event_line_items FOR EACH ROW EXECUTE FUNCTION public.aft_block_locked_line_item_updates();


--
-- Name: aft_aircraft_equipment trg_equipment_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_equipment_touch BEFORE UPDATE ON public.aft_aircraft_equipment FOR EACH ROW EXECUTE FUNCTION public.aft_equipment_touch_updated_at();


--
-- Name: aft_aircraft trg_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_history AFTER INSERT OR DELETE OR UPDATE ON public.aft_aircraft FOR EACH ROW EXECUTE FUNCTION public.log_record_history();


--
-- Name: aft_aircraft_equipment trg_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_history AFTER INSERT OR DELETE OR UPDATE ON public.aft_aircraft_equipment FOR EACH ROW EXECUTE FUNCTION public.log_record_history();


--
-- Name: aft_airworthiness_directives trg_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_history AFTER INSERT OR DELETE OR UPDATE ON public.aft_airworthiness_directives FOR EACH ROW EXECUTE FUNCTION public.log_record_history();


--
-- Name: aft_documents trg_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_history AFTER INSERT OR DELETE OR UPDATE ON public.aft_documents FOR EACH ROW EXECUTE FUNCTION public.log_record_history();


--
-- Name: aft_event_line_items trg_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_history AFTER INSERT OR DELETE OR UPDATE ON public.aft_event_line_items FOR EACH ROW EXECUTE FUNCTION public.log_record_history();


--
-- Name: aft_flight_logs trg_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_history AFTER INSERT OR DELETE OR UPDATE ON public.aft_flight_logs FOR EACH ROW EXECUTE FUNCTION public.log_record_history();


--
-- Name: aft_maintenance_events trg_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_history AFTER INSERT OR DELETE OR UPDATE ON public.aft_maintenance_events FOR EACH ROW EXECUTE FUNCTION public.log_record_history();


--
-- Name: aft_maintenance_items trg_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_history AFTER INSERT OR DELETE OR UPDATE ON public.aft_maintenance_items FOR EACH ROW EXECUTE FUNCTION public.log_record_history();


--
-- Name: aft_notes trg_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_history AFTER INSERT OR DELETE OR UPDATE ON public.aft_notes FOR EACH ROW EXECUTE FUNCTION public.log_record_history();


--
-- Name: aft_oil_logs trg_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_history AFTER INSERT OR DELETE OR UPDATE ON public.aft_oil_logs FOR EACH ROW EXECUTE FUNCTION public.log_record_history();


--
-- Name: aft_squawks trg_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_history AFTER INSERT OR DELETE OR UPDATE ON public.aft_squawks FOR EACH ROW EXECUTE FUNCTION public.log_record_history();


--
-- Name: aft_tire_checks trg_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_history AFTER INSERT OR DELETE OR UPDATE ON public.aft_tire_checks FOR EACH ROW EXECUTE FUNCTION public.log_record_history();


--
-- Name: aft_vor_checks trg_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_history AFTER INSERT OR DELETE OR UPDATE ON public.aft_vor_checks FOR EACH ROW EXECUTE FUNCTION public.log_record_history();


--
-- Name: aft_maintenance_events trg_lock_on_complete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lock_on_complete BEFORE UPDATE ON public.aft_maintenance_events FOR EACH ROW EXECUTE FUNCTION public.aft_lock_on_complete();


--
-- Name: aft_user_preferences trg_user_prefs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_prefs_updated_at BEFORE UPDATE ON public.aft_user_preferences FOR EACH ROW EXECUTE FUNCTION public.update_user_prefs_timestamp();


--
-- Name: aft_aircraft aft_aircraft_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_aircraft
    ADD CONSTRAINT aft_aircraft_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: aft_aircraft aft_aircraft_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_aircraft
    ADD CONSTRAINT aft_aircraft_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_aircraft_equipment aft_aircraft_equipment_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_aircraft_equipment
    ADD CONSTRAINT aft_aircraft_equipment_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aft_aircraft(id) ON DELETE CASCADE;


--
-- Name: aft_aircraft_equipment aft_aircraft_equipment_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_aircraft_equipment
    ADD CONSTRAINT aft_aircraft_equipment_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_aircraft_equipment aft_aircraft_equipment_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_aircraft_equipment
    ADD CONSTRAINT aft_aircraft_equipment_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_airworthiness_directives aft_airworthiness_directives_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_airworthiness_directives
    ADD CONSTRAINT aft_airworthiness_directives_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aft_aircraft(id) ON DELETE CASCADE;


--
-- Name: aft_airworthiness_directives aft_airworthiness_directives_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_airworthiness_directives
    ADD CONSTRAINT aft_airworthiness_directives_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_airworthiness_directives aft_airworthiness_directives_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_airworthiness_directives
    ADD CONSTRAINT aft_airworthiness_directives_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_howard_messages aft_chuck_messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_howard_messages
    ADD CONSTRAINT aft_chuck_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.aft_howard_threads(id) ON DELETE CASCADE;


--
-- Name: aft_howard_threads aft_chuck_threads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_howard_threads
    ADD CONSTRAINT aft_chuck_threads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: aft_document_chunks aft_document_chunks_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_document_chunks
    ADD CONSTRAINT aft_document_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.aft_documents(id) ON DELETE CASCADE;


--
-- Name: aft_documents aft_documents_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_documents
    ADD CONSTRAINT aft_documents_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aft_aircraft(id) ON DELETE CASCADE;


--
-- Name: aft_documents aft_documents_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_documents
    ADD CONSTRAINT aft_documents_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_documents aft_documents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_documents
    ADD CONSTRAINT aft_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_event_line_items aft_event_line_items_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_event_line_items
    ADD CONSTRAINT aft_event_line_items_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_event_line_items aft_event_line_items_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_event_line_items
    ADD CONSTRAINT aft_event_line_items_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.aft_maintenance_events(id) ON DELETE CASCADE;


--
-- Name: aft_event_line_items aft_event_line_items_locked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_event_line_items
    ADD CONSTRAINT aft_event_line_items_locked_by_fkey FOREIGN KEY (locked_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_event_line_items aft_event_line_items_maintenance_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_event_line_items
    ADD CONSTRAINT aft_event_line_items_maintenance_item_id_fkey FOREIGN KEY (maintenance_item_id) REFERENCES public.aft_maintenance_items(id) ON DELETE SET NULL;


--
-- Name: aft_event_line_items aft_event_line_items_squawk_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_event_line_items
    ADD CONSTRAINT aft_event_line_items_squawk_id_fkey FOREIGN KEY (squawk_id) REFERENCES public.aft_squawks(id) ON DELETE SET NULL;


--
-- Name: aft_event_messages aft_event_messages_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_event_messages
    ADD CONSTRAINT aft_event_messages_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.aft_maintenance_events(id) ON DELETE CASCADE;


--
-- Name: aft_flight_logs aft_flight_logs_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_flight_logs
    ADD CONSTRAINT aft_flight_logs_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aft_aircraft(id) ON DELETE CASCADE;


--
-- Name: aft_flight_logs aft_flight_logs_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_flight_logs
    ADD CONSTRAINT aft_flight_logs_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_flight_logs aft_flight_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_flight_logs
    ADD CONSTRAINT aft_flight_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_howard_rate_limit aft_howard_rate_limit_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_howard_rate_limit
    ADD CONSTRAINT aft_howard_rate_limit_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: aft_howard_web_search_daily aft_howard_web_search_daily_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_howard_web_search_daily
    ADD CONSTRAINT aft_howard_web_search_daily_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: aft_maintenance_events aft_maintenance_events_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_maintenance_events
    ADD CONSTRAINT aft_maintenance_events_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aft_aircraft(id) ON DELETE CASCADE;


--
-- Name: aft_maintenance_events aft_maintenance_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_maintenance_events
    ADD CONSTRAINT aft_maintenance_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_maintenance_events aft_maintenance_events_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_maintenance_events
    ADD CONSTRAINT aft_maintenance_events_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_maintenance_events aft_maintenance_events_locked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_maintenance_events
    ADD CONSTRAINT aft_maintenance_events_locked_by_fkey FOREIGN KEY (locked_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_maintenance_items aft_maintenance_items_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_maintenance_items
    ADD CONSTRAINT aft_maintenance_items_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aft_aircraft(id) ON DELETE CASCADE;


--
-- Name: aft_maintenance_items aft_maintenance_items_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_maintenance_items
    ADD CONSTRAINT aft_maintenance_items_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_note_reads aft_note_reads_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_note_reads
    ADD CONSTRAINT aft_note_reads_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.aft_notes(id) ON DELETE CASCADE;


--
-- Name: aft_note_reads aft_note_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_note_reads
    ADD CONSTRAINT aft_note_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: aft_notes aft_notes_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_notes
    ADD CONSTRAINT aft_notes_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aft_aircraft(id) ON DELETE CASCADE;


--
-- Name: aft_notes aft_notes_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_notes
    ADD CONSTRAINT aft_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_notes aft_notes_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_notes
    ADD CONSTRAINT aft_notes_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_notification_preferences aft_notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_notification_preferences
    ADD CONSTRAINT aft_notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: aft_oil_logs aft_oil_logs_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_oil_logs
    ADD CONSTRAINT aft_oil_logs_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aft_aircraft(id) ON DELETE CASCADE;


--
-- Name: aft_oil_logs aft_oil_logs_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_oil_logs
    ADD CONSTRAINT aft_oil_logs_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_oil_logs aft_oil_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_oil_logs
    ADD CONSTRAINT aft_oil_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_proposed_actions aft_proposed_actions_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_proposed_actions
    ADD CONSTRAINT aft_proposed_actions_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aft_aircraft(id) ON DELETE CASCADE;


--
-- Name: aft_proposed_actions aft_proposed_actions_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_proposed_actions
    ADD CONSTRAINT aft_proposed_actions_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_proposed_actions aft_proposed_actions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_proposed_actions
    ADD CONSTRAINT aft_proposed_actions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.aft_howard_messages(id) ON DELETE SET NULL;


--
-- Name: aft_proposed_actions aft_proposed_actions_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_proposed_actions
    ADD CONSTRAINT aft_proposed_actions_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.aft_howard_threads(id) ON DELETE CASCADE;


--
-- Name: aft_proposed_actions aft_proposed_actions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_proposed_actions
    ADD CONSTRAINT aft_proposed_actions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: aft_record_history aft_record_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_record_history
    ADD CONSTRAINT aft_record_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_reservations aft_reservations_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_reservations
    ADD CONSTRAINT aft_reservations_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aft_aircraft(id) ON DELETE CASCADE;


--
-- Name: aft_reservations aft_reservations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_reservations
    ADD CONSTRAINT aft_reservations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_squawks aft_squawks_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_squawks
    ADD CONSTRAINT aft_squawks_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aft_aircraft(id) ON DELETE CASCADE;


--
-- Name: aft_squawks aft_squawks_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_squawks
    ADD CONSTRAINT aft_squawks_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_squawks aft_squawks_reported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_squawks
    ADD CONSTRAINT aft_squawks_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_squawks aft_squawks_resolved_by_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_squawks
    ADD CONSTRAINT aft_squawks_resolved_by_event_id_fkey FOREIGN KEY (resolved_by_event_id) REFERENCES public.aft_maintenance_events(id) ON DELETE SET NULL;


--
-- Name: aft_submit_rate_limit aft_submit_rate_limit_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_submit_rate_limit
    ADD CONSTRAINT aft_submit_rate_limit_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: aft_tire_checks aft_tire_checks_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_tire_checks
    ADD CONSTRAINT aft_tire_checks_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aft_aircraft(id) ON DELETE CASCADE;


--
-- Name: aft_tire_checks aft_tire_checks_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_tire_checks
    ADD CONSTRAINT aft_tire_checks_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_tire_checks aft_tire_checks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_tire_checks
    ADD CONSTRAINT aft_tire_checks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_user_aircraft_access aft_user_aircraft_access_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_user_aircraft_access
    ADD CONSTRAINT aft_user_aircraft_access_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aft_aircraft(id) ON DELETE CASCADE;


--
-- Name: aft_user_aircraft_access aft_user_aircraft_access_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_user_aircraft_access
    ADD CONSTRAINT aft_user_aircraft_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: aft_user_preferences aft_user_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_user_preferences
    ADD CONSTRAINT aft_user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: aft_user_roles aft_user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_user_roles
    ADD CONSTRAINT aft_user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: aft_vor_checks aft_vor_checks_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_vor_checks
    ADD CONSTRAINT aft_vor_checks_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aft_aircraft(id) ON DELETE CASCADE;


--
-- Name: aft_vor_checks aft_vor_checks_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_vor_checks
    ADD CONSTRAINT aft_vor_checks_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_vor_checks aft_vor_checks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_vor_checks
    ADD CONSTRAINT aft_vor_checks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_aircraft fk_aircraft_auth_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_aircraft
    ADD CONSTRAINT fk_aircraft_auth_user FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_flight_logs fk_flight_logs_auth_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_flight_logs
    ADD CONSTRAINT fk_flight_logs_auth_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_maintenance_events fk_mx_events_auth_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_maintenance_events
    ADD CONSTRAINT fk_mx_events_auth_user FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_note_reads fk_note_reads_auth_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_note_reads
    ADD CONSTRAINT fk_note_reads_auth_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: aft_notes fk_notes_auth_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_notes
    ADD CONSTRAINT fk_notes_auth_user FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_notification_preferences fk_notification_prefs_auth_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_notification_preferences
    ADD CONSTRAINT fk_notification_prefs_auth_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: aft_reservations fk_reservations_auth_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_reservations
    ADD CONSTRAINT fk_reservations_auth_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_squawks fk_squawks_auth_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_squawks
    ADD CONSTRAINT fk_squawks_auth_user FOREIGN KEY (reported_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: aft_user_aircraft_access fk_user_aircraft_access_auth_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_user_aircraft_access
    ADD CONSTRAINT fk_user_aircraft_access_auth_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: aft_user_roles fk_user_roles_auth_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aft_user_roles
    ADD CONSTRAINT fk_user_roles_auth_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: itin_itineraries Allow public delete itineraries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public delete itineraries" ON public.itin_itineraries FOR DELETE USING (true);


--
-- Name: itin_aircraft Allow public insert aircraft; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public insert aircraft" ON public.itin_aircraft FOR INSERT WITH CHECK (true);


--
-- Name: itin_fbos Allow public insert fbos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public insert fbos" ON public.itin_fbos FOR INSERT WITH CHECK (true);


--
-- Name: itin_itineraries Allow public insert itineraries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public insert itineraries" ON public.itin_itineraries FOR INSERT WITH CHECK (true);


--
-- Name: itin_passengers Allow public insert passengers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public insert passengers" ON public.itin_passengers FOR INSERT WITH CHECK (true);


--
-- Name: itin_pilots Allow public insert pilots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public insert pilots" ON public.itin_pilots FOR INSERT WITH CHECK (true);


--
-- Name: itin_aircraft Allow public read aircraft; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read aircraft" ON public.itin_aircraft FOR SELECT USING (true);


--
-- Name: itin_fbos Allow public read fbos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read fbos" ON public.itin_fbos FOR SELECT USING (true);


--
-- Name: itin_itineraries Allow public read itineraries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read itineraries" ON public.itin_itineraries FOR SELECT USING (true);


--
-- Name: aft_system_settings Allow public read of settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read of settings" ON public.aft_system_settings FOR SELECT USING (true);


--
-- Name: itin_passengers Allow public read passengers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read passengers" ON public.itin_passengers FOR SELECT USING (true);


--
-- Name: itin_pilots Allow public read pilots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read pilots" ON public.itin_pilots FOR SELECT USING (true);


--
-- Name: itin_aircraft Allow public update aircraft; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public update aircraft" ON public.itin_aircraft FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: itin_fbos Allow public update fbos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public update fbos" ON public.itin_fbos FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: itin_itineraries Allow public update itineraries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public update itineraries" ON public.itin_itineraries FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: itin_passengers Allow public update passengers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public update passengers" ON public.itin_passengers FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: itin_pilots Allow public update pilots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public update pilots" ON public.itin_pilots FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: aft_reservations Users can create reservations for their aircraft; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create reservations for their aircraft" ON public.aft_reservations FOR INSERT TO authenticated WITH CHECK (((aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE (aft_user_aircraft_access.user_id = auth.uid()))) AND (user_id = auth.uid())));


--
-- Name: aft_reservations Users can delete own reservations or admin can delete any; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own reservations or admin can delete any" ON public.aft_reservations FOR DELETE TO authenticated USING (((user_id = auth.uid()) OR (aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE ((aft_user_aircraft_access.user_id = auth.uid()) AND (aft_user_aircraft_access.aircraft_role = 'admin'::text))))));


--
-- Name: aft_notification_preferences Users can manage their own notification preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage their own notification preferences" ON public.aft_notification_preferences TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: aft_reservations Users can update own reservations or admin can update any; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own reservations or admin can update any" ON public.aft_reservations FOR UPDATE TO authenticated USING (((user_id = auth.uid()) OR (aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE ((aft_user_aircraft_access.user_id = auth.uid()) AND (aft_user_aircraft_access.aircraft_role = 'admin'::text))))));


--
-- Name: aft_reservations Users can view reservations for their aircraft; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view reservations for their aircraft" ON public.aft_reservations FOR SELECT TO authenticated USING ((aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE (aft_user_aircraft_access.user_id = auth.uid()))));


--
-- Name: aft_user_preferences Users manage own preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own preferences" ON public.aft_user_preferences USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: aft_ad_applicability_cache ad_cache_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ad_cache_select ON public.aft_ad_applicability_cache FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: aft_system_settings admin_write_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_settings ON public.aft_system_settings TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))));


--
-- Name: aft_maintenance_events admins_full_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admins_full_events ON public.aft_maintenance_events USING ((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))));


--
-- Name: aft_event_line_items admins_full_line_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admins_full_line_items ON public.aft_event_line_items USING ((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))));


--
-- Name: aft_event_messages admins_full_messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admins_full_messages ON public.aft_event_messages USING ((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))));


--
-- Name: aft_airworthiness_directives ads_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ads_select ON public.aft_airworthiness_directives FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))) OR (aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE (aft_user_aircraft_access.user_id = auth.uid())))));


--
-- Name: aft_airworthiness_directives ads_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ads_write ON public.aft_airworthiness_directives USING (((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))) OR (aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE ((aft_user_aircraft_access.user_id = auth.uid()) AND (aft_user_aircraft_access.aircraft_role = 'admin'::text))))));


--
-- Name: aft_ad_applicability_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_ad_applicability_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_user_aircraft_access aft_admin_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_admin_access ON public.aft_user_aircraft_access TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))));


--
-- Name: aft_aircraft aft_admin_aircraft; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_admin_aircraft ON public.aft_aircraft TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))));


--
-- Name: aft_flight_logs aft_admin_delete_flight_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_admin_delete_flight_logs ON public.aft_flight_logs FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))));


--
-- Name: aft_notes aft_admin_delete_notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_admin_delete_notes ON public.aft_notes FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))));


--
-- Name: aft_squawks aft_admin_delete_squawks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_admin_delete_squawks ON public.aft_squawks FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))));


--
-- Name: aft_maintenance_items aft_admin_maint; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_admin_maint ON public.aft_maintenance_items TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))));


--
-- Name: aft_flight_logs aft_admin_update_flight_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_admin_update_flight_logs ON public.aft_flight_logs FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))));


--
-- Name: aft_aircraft; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_aircraft ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_aircraft_equipment; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_aircraft_equipment ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_airworthiness_directives; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_airworthiness_directives ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_aircraft aft_anon_view_aircraft; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_anon_view_aircraft ON public.aft_aircraft FOR SELECT TO anon USING (true);


--
-- Name: aft_squawks aft_anon_view_squawks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_anon_view_squawks ON public.aft_squawks FOR SELECT TO anon USING (true);


--
-- Name: aft_document_chunks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_document_chunks ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_event_line_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_event_line_items ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_event_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_event_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_flight_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_flight_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_howard_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_howard_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_howard_rate_limit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_howard_rate_limit ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_howard_threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_howard_threads ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_howard_web_search_daily; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_howard_web_search_daily ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_flight_logs aft_insert_flight_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_insert_flight_logs ON public.aft_flight_logs FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: aft_notes aft_insert_note; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_insert_note ON public.aft_notes FOR INSERT TO authenticated WITH CHECK ((auth.uid() = author_id));


--
-- Name: aft_note_reads aft_insert_note_reads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_insert_note_reads ON public.aft_note_reads FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: aft_squawks aft_insert_squawk; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_insert_squawk ON public.aft_squawks FOR INSERT TO authenticated WITH CHECK ((auth.uid() = reported_by));


--
-- Name: aft_maintenance_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_maintenance_events ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_maintenance_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_maintenance_items ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_note_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_note_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_notification_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_oil_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_oil_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_aircraft aft_pilot_update_aircraft; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_pilot_update_aircraft ON public.aft_aircraft FOR UPDATE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.aft_user_aircraft_access
  WHERE ((aft_user_aircraft_access.user_id = auth.uid()) AND (aft_user_aircraft_access.aircraft_id = aft_aircraft.id)))) OR (EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text))))));


--
-- Name: aft_proposed_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_proposed_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_user_aircraft_access aft_read_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_read_access ON public.aft_user_aircraft_access FOR SELECT TO authenticated USING (true);


--
-- Name: aft_aircraft aft_read_aircraft; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_read_aircraft ON public.aft_aircraft FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.aft_user_aircraft_access
  WHERE ((aft_user_aircraft_access.user_id = auth.uid()) AND (aft_user_aircraft_access.aircraft_id = aft_aircraft.id)))) OR (NOT (EXISTS ( SELECT 1
   FROM public.aft_user_aircraft_access)))));


--
-- Name: aft_flight_logs aft_read_flight_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_read_flight_logs ON public.aft_flight_logs FOR SELECT TO authenticated USING (true);


--
-- Name: aft_maintenance_items aft_read_maint; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_read_maint ON public.aft_maintenance_items FOR SELECT TO authenticated USING (true);


--
-- Name: aft_note_reads aft_read_note_reads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_read_note_reads ON public.aft_note_reads FOR SELECT TO authenticated USING (true);


--
-- Name: aft_notes aft_read_notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_read_notes ON public.aft_notes FOR SELECT TO authenticated USING (true);


--
-- Name: aft_user_roles aft_read_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_read_roles ON public.aft_user_roles FOR SELECT TO authenticated USING (true);


--
-- Name: aft_squawks aft_read_squawks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_read_squawks ON public.aft_squawks FOR SELECT TO authenticated USING (true);


--
-- Name: aft_record_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_record_history ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_reservations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_reservations ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_squawks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_squawks ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_submit_rate_limit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_submit_rate_limit ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_system_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_system_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_tire_checks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_tire_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_note_reads aft_update_note_reads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_update_note_reads ON public.aft_note_reads FOR UPDATE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: aft_notes aft_update_own_notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_update_own_notes ON public.aft_notes FOR UPDATE TO authenticated USING ((auth.uid() = author_id));


--
-- Name: aft_user_roles aft_update_own_profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_update_own_profile ON public.aft_user_roles FOR UPDATE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: aft_squawks aft_update_squawk; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aft_update_squawk ON public.aft_squawks FOR UPDATE TO authenticated USING (true);


--
-- Name: aft_user_aircraft_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_user_aircraft_access ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_user_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_user_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_vor_checks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aft_vor_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_maintenance_events anon_view_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_view_events ON public.aft_maintenance_events FOR SELECT TO anon USING (true);


--
-- Name: aft_event_line_items anon_view_line_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_view_line_items ON public.aft_event_line_items FOR SELECT TO anon USING (true);


--
-- Name: aft_event_messages anon_view_messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_view_messages ON public.aft_event_messages FOR SELECT TO anon USING (true);


--
-- Name: aft_document_chunks chunks_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chunks_insert ON public.aft_document_chunks FOR INSERT WITH CHECK ((document_id IN ( SELECT aft_documents.id
   FROM public.aft_documents
  WHERE (aft_documents.aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
           FROM public.aft_user_aircraft_access
          WHERE (aft_user_aircraft_access.user_id = auth.uid()))))));


--
-- Name: aft_document_chunks chunks_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chunks_select ON public.aft_document_chunks FOR SELECT USING ((document_id IN ( SELECT aft_documents.id
   FROM public.aft_documents
  WHERE (aft_documents.aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
           FROM public.aft_user_aircraft_access
          WHERE (aft_user_aircraft_access.user_id = auth.uid()))))));


--
-- Name: aft_documents documents_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_insert ON public.aft_documents FOR INSERT WITH CHECK ((aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE (aft_user_aircraft_access.user_id = auth.uid()))));


--
-- Name: aft_documents documents_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_select ON public.aft_documents FOR SELECT USING ((aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE (aft_user_aircraft_access.user_id = auth.uid()))));


--
-- Name: aft_aircraft_equipment equipment_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipment_select ON public.aft_aircraft_equipment FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))) OR (aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE (aft_user_aircraft_access.user_id = auth.uid())))));


--
-- Name: aft_aircraft_equipment equipment_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipment_write ON public.aft_aircraft_equipment USING (((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))) OR (aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE ((aft_user_aircraft_access.user_id = auth.uid()) AND (aft_user_aircraft_access.aircraft_role = 'admin'::text))))));


--
-- Name: aft_howard_messages howard_messages_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY howard_messages_insert ON public.aft_howard_messages FOR INSERT WITH CHECK ((thread_id IN ( SELECT aft_howard_threads.id
   FROM public.aft_howard_threads
  WHERE (aft_howard_threads.user_id = auth.uid()))));


--
-- Name: aft_howard_messages howard_messages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY howard_messages_select ON public.aft_howard_messages FOR SELECT USING ((thread_id IN ( SELECT aft_howard_threads.id
   FROM public.aft_howard_threads
  WHERE (aft_howard_threads.user_id = auth.uid()))));


--
-- Name: aft_howard_threads howard_threads_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY howard_threads_insert ON public.aft_howard_threads FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: aft_howard_threads howard_threads_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY howard_threads_select ON public.aft_howard_threads FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: itin_aircraft; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.itin_aircraft ENABLE ROW LEVEL SECURITY;

--
-- Name: itin_fbos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.itin_fbos ENABLE ROW LEVEL SECURITY;

--
-- Name: itin_itineraries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.itin_itineraries ENABLE ROW LEVEL SECURITY;

--
-- Name: itin_passengers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.itin_passengers ENABLE ROW LEVEL SECURITY;

--
-- Name: itin_pilots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.itin_pilots ENABLE ROW LEVEL SECURITY;

--
-- Name: aft_oil_logs oil_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY oil_insert ON public.aft_oil_logs FOR INSERT WITH CHECK ((aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE (aft_user_aircraft_access.user_id = auth.uid()))));


--
-- Name: aft_oil_logs oil_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY oil_select ON public.aft_oil_logs FOR SELECT USING ((aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE (aft_user_aircraft_access.user_id = auth.uid()))));


--
-- Name: aft_event_messages pilots_insert_messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pilots_insert_messages ON public.aft_event_messages FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.aft_maintenance_events e
     JOIN public.aft_user_aircraft_access a ON ((a.aircraft_id = e.aircraft_id)))
  WHERE ((e.id = aft_event_messages.event_id) AND (a.user_id = auth.uid())))));


--
-- Name: aft_maintenance_events pilots_view_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pilots_view_events ON public.aft_maintenance_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.aft_user_aircraft_access
  WHERE ((aft_user_aircraft_access.user_id = auth.uid()) AND (aft_user_aircraft_access.aircraft_id = aft_maintenance_events.aircraft_id)))));


--
-- Name: aft_event_line_items pilots_view_line_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pilots_view_line_items ON public.aft_event_line_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.aft_maintenance_events e
     JOIN public.aft_user_aircraft_access a ON ((a.aircraft_id = e.aircraft_id)))
  WHERE ((e.id = aft_event_line_items.event_id) AND (a.user_id = auth.uid())))));


--
-- Name: aft_event_messages pilots_view_messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pilots_view_messages ON public.aft_event_messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.aft_maintenance_events e
     JOIN public.aft_user_aircraft_access a ON ((a.aircraft_id = e.aircraft_id)))
  WHERE ((e.id = aft_event_messages.event_id) AND (a.user_id = auth.uid())))));


--
-- Name: aft_proposed_actions proposed_actions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY proposed_actions_select ON public.aft_proposed_actions FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: aft_proposed_actions proposed_actions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY proposed_actions_update ON public.aft_proposed_actions FOR UPDATE USING ((user_id = auth.uid()));


--
-- Name: aft_record_history record_history_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY record_history_select ON public.aft_record_history FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.aft_user_roles
  WHERE ((aft_user_roles.user_id = auth.uid()) AND (aft_user_roles.role = 'admin'::text)))) OR ((aircraft_id IS NOT NULL) AND (aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE ((aft_user_aircraft_access.user_id = auth.uid()) AND (aft_user_aircraft_access.aircraft_role = 'admin'::text)))))));


--
-- Name: aft_tire_checks tire_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tire_insert ON public.aft_tire_checks FOR INSERT WITH CHECK ((aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE (aft_user_aircraft_access.user_id = auth.uid()))));


--
-- Name: aft_tire_checks tire_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tire_select ON public.aft_tire_checks FOR SELECT USING ((aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE (aft_user_aircraft_access.user_id = auth.uid()))));


--
-- Name: aft_vor_checks vor_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vor_insert ON public.aft_vor_checks FOR INSERT WITH CHECK ((aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE (aft_user_aircraft_access.user_id = auth.uid()))));


--
-- Name: aft_vor_checks vor_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vor_select ON public.aft_vor_checks FOR SELECT USING ((aircraft_id IN ( SELECT aft_user_aircraft_access.aircraft_id
   FROM public.aft_user_aircraft_access
  WHERE (aft_user_aircraft_access.user_id = auth.uid()))));


--
-- PostgreSQL database dump complete
--

\unrestrict Apug02WIKWekzz9al7aZIKlRMGii1lvPNWZQeuidBXhUtQllAFg5zc2H7q2CYoV


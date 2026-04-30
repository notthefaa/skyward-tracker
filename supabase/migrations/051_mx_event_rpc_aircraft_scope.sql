-- =============================================================
-- Migration 051: tighten mx-event RPC aircraft scoping
-- =============================================================
-- Three related leaks in the existing atomic RPCs (037 + 049):
--
-- 1. create_mx_event_atomic pulled mx items + squawks by id with
--    no aircraft_id check. An admin of aircraft A who knew (or
--    guessed) ids belonging to aircraft B could attach B's rows
--    as A-event line items, and the later complete-event flow
--    would happily reset B's intervals / resolve B's squawks.
--    Fix: add `AND aircraft_id = p_aircraft_id` on both pulls.
--
-- 2. complete_mx_event_atomic looked up the linked mx item with
--    no `deleted_at IS NULL` filter, so a soft-deleted item
--    silently had its due_time/due_date and reminder flags
--    rewritten — and would come back with mangled state if
--    later restored. Fix: scope the SELECT to live rows.
--
-- 3. complete_mx_event_atomic resolved any squawk_id linked from
--    a line item without re-checking the squawk's aircraft. The
--    new aircraft scope on creation (#1) closes the door for
--    fresh writes, but legacy line_items written before this
--    migration could still carry a cross-aircraft squawk_id.
--    Defense in depth: scope the squawk UPDATE to the event's
--    aircraft so a stale id can't resolve someone else's squawk.
--
-- Both functions are recreated whole here. The signatures and
-- behaviour are otherwise unchanged from 049.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

-- ── create_mx_event_atomic ───────────────────────────────────

CREATE OR REPLACE FUNCTION create_mx_event_atomic(
  p_aircraft_id    uuid,
  p_user_id        uuid,
  p_proposed_date  date,
  p_addon_services text[],
  p_mx_item_ids    uuid[],
  p_squawk_ids     uuid[],
  p_initial_message text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION create_mx_event_atomic(uuid, uuid, date, text[], uuid[], uuid[], text)
  TO service_role;

-- ── complete_mx_event_atomic ─────────────────────────────────

CREATE OR REPLACE FUNCTION complete_mx_event_atomic(
  p_event_id    uuid,
  p_user_id     uuid,
  p_completions jsonb,
  p_partial     boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Pull the event's aircraft once so the per-line-item squawk
  -- resolve can scope its UPDATE without re-querying every loop.
  SELECT aircraft_id INTO v_event_aircraft_id
    FROM aft_maintenance_events
    WHERE id = p_event_id;
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
        AND aircraft_id = v_event_aircraft_id;
    END IF;
  END LOOP;

  SELECT bool_and(line_status IN ('complete', 'deferred'))
    INTO v_all_resolved
    FROM aft_event_line_items
    WHERE event_id = p_event_id AND deleted_at IS NULL;

  IF v_all_resolved AND NOT COALESCE(p_partial, false) THEN
    UPDATE aft_maintenance_events
      SET status = 'complete', completed_at = now()
      WHERE id = p_event_id;
    INSERT INTO aft_event_messages (event_id, sender, message_type, message)
      VALUES (
        p_event_id, 'system', 'status_update',
        'Maintenance event completed. All tracking items have been reset.'
      );
  ELSIF v_all_resolved THEN
    UPDATE aft_maintenance_events
      SET status = 'complete', completed_at = now()
      WHERE id = p_event_id;
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

GRANT EXECUTE ON FUNCTION complete_mx_event_atomic(uuid, uuid, jsonb, boolean)
  TO service_role;

COMMIT;

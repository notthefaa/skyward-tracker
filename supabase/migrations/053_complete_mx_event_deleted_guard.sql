-- =============================================================
-- Migration 053: complete_mx_event_atomic — soft-delete guard
-- =============================================================
-- The RPC from migration 049 (recreated in 051) reads the event:
--   SELECT aircraft_id INTO v_event_aircraft_id
--     FROM aft_maintenance_events
--     WHERE id = p_event_id;
-- and later writes:
--   UPDATE aft_maintenance_events
--     SET status = 'complete', completed_at = now()
--     WHERE id = p_event_id;
-- Neither query checks `deleted_at IS NULL`, so a concurrent
-- soft-delete (owner cancelling from another tab) landing between
-- the API's pre-check and the RPC fire still lets the side-effect
-- chain run: line items get marked complete, MX items get their
-- intervals reset, squawks get resolved — even though the event
-- itself stays soft-deleted. The visible event disappears but the
-- damage is silent.
--
-- Mirrors the fix the API-level routes got today (respond,
-- owner-action, send-workpackage all gained `.is('deleted_at',
-- null)` on their UPDATE chains). RPC needed its own guard since
-- it bypasses the API-level filter.
--
-- Fix: scope the SELECT to live rows and raise a clear error if
-- the event was soft-deleted. The transaction wrapping the RPC
-- means raising aborts every prior side effect, so a partial
-- complete can't leak through.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

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

GRANT EXECUTE ON FUNCTION complete_mx_event_atomic(uuid, uuid, jsonb, boolean)
  TO service_role;

COMMIT;

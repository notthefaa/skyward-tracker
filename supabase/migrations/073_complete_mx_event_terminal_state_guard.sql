-- 073_complete_mx_event_terminal_state_guard.sql
--
-- `complete_mx_event_atomic` looks up the event by `id AND deleted_at
-- IS NULL` and proceeds even if the event is already in a terminal
-- state (`cancelled` or `complete`). The mirror bug to the recently
-- patched respond.ts UPDATE filters: a race where the owner cancels
-- in the app while the mechanic concurrently submits logbook data
-- would let the cancelled event silently flip to `complete`,
-- advancing maintenance-item intervals + resolving squawks on a
-- service the owner walked away from.
--
-- Also: if a duplicate complete request races against an already-
-- complete event (e.g. retry on a 504 that actually succeeded), the
-- second call replays the maintenance-item due-time + due-date
-- advancement, double-rolling intervals.
--
-- Fix: add `AND status NOT IN ('cancelled', 'complete')` to the
-- gating SELECT so terminal states raise 'Event not found' (P0002),
-- mapped to a friendly 404 client-side. Function body otherwise
-- preserved verbatim from mig 061. Signature unchanged.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

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

  -- Terminal-state guard added in mig 073. The cancelled / complete
  -- check closes the race window where an owner cancel can be
  -- silently undone by a concurrent mechanic submit (cancelled event
  -- flips to 'complete' on top of cancellation, with maintenance
  -- intervals + squawk resolutions cascading) AND the duplicate-
  -- submit replay where a retry double-rolls maintenance intervals
  -- on an already-complete event.
  SELECT aircraft_id INTO v_event_aircraft_id
    FROM aft_maintenance_events
    WHERE id = p_event_id
      AND deleted_at IS NULL
      AND status NOT IN ('cancelled', 'complete');
  IF v_event_aircraft_id IS NULL THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'P0002';
  END IF;

  FOR v_completion IN SELECT * FROM jsonb_array_elements(p_completions) LOOP
    v_completion_dt := NULLIF(v_completion->>'completionDate', '')::date;
    v_completion_hr := NULLIF(v_completion->>'completionTime', '')::numeric;
    v_tach  := NULLIF(v_completion->>'tachAtCompletion',  '')::numeric;
    v_hobbs := NULLIF(v_completion->>'hobbsAtCompletion', '')::numeric;

    -- Reset the record before the UPDATE. PL/pgSQL does NOT null-out
    -- the record variable when RETURNING matches zero rows — the
    -- previous iteration's value persists, and `IF v_line_item.id IS NULL`
    -- silently re-processes the previous row's mx-item + squawk links.
    v_line_item := NULL;

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
      AND deleted_at IS NULL
    RETURNING * INTO v_line_item;

    -- FOUND is set by the previous SQL statement. It's the reliable
    -- "did the UPDATE match a row" check; reading back the record's
    -- id is not (see comment on v_line_item := NULL above).
    IF NOT FOUND THEN
      v_unmatched_ids := array_append(v_unmatched_ids, v_completion->>'lineItemId');
      CONTINUE;
    END IF;
    v_completed_names := array_append(v_completed_names, v_line_item.item_name);

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

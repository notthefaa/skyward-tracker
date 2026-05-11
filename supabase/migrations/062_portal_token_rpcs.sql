-- =============================================================
-- Migration 062: token-scoped portal RPCs
-- =============================================================
-- The mechanic-event portal (/service/[id]) and public-squawk
-- portal (/squawk/[id]) read aircraft, events, line items, squawks
-- and messages directly via the anon supabase client, filtered
-- client-side by access_token. That works because of these
-- `TO anon USING (true)` RLS policies:
--   - aft_anon_view_aircraft
--   - aft_anon_view_squawks
--   - anon_view_events
--   - anon_view_line_items
--   - anon_view_messages
-- which grant blanket anon SELECT on the entire row/column space.
-- Anyone with the project's anon key can dump every aircraft +
-- owner email + every squawk + every event + every line item +
-- every owner/mechanic message — no token required.
--
-- These RPCs replace the direct reads with a single SECURITY
-- DEFINER call that requires a valid access_token. After the
-- portal pages are migrated and verified, a follow-up migration
-- will drop the anon RLS policies (the RPC + service-role
-- mutations are then the only access path).
--
-- get_portal_event: returns event + aircraft + line_items + squawk
--   pictures (only for squawks referenced from the event's line
--   items) + messages. NULL if the token doesn't match a live
--   event row.
--
-- get_portal_squawk: returns squawk + aircraft (limited columns).
--   NULL if the token doesn't match a live squawk row.
--
-- Idempotent: CREATE OR REPLACE. GRANT is idempotent.
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION get_portal_event(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event       jsonb;
  v_aircraft    jsonb;
  v_line_items  jsonb;
  v_squawks     jsonb;
  v_messages    jsonb;
  v_event_id    uuid;
  v_aircraft_id uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(e.*) INTO v_event
    FROM aft_maintenance_events e
    WHERE e.access_token = p_token
      AND e.deleted_at IS NULL;

  IF v_event IS NULL THEN
    RETURN NULL;
  END IF;

  v_event_id    := (v_event->>'id')::uuid;
  v_aircraft_id := (v_event->>'aircraft_id')::uuid;

  SELECT to_jsonb(a.*) INTO v_aircraft
    FROM aft_aircraft a
    WHERE a.id = v_aircraft_id
      AND a.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(to_jsonb(li.*) ORDER BY li.created_at), '[]'::jsonb)
    INTO v_line_items
    FROM aft_event_line_items li
    WHERE li.event_id = v_event_id;

  -- Squawks referenced from this event's line items only. Returning
  -- just id + pictures matches what the portal UI uses to render the
  -- linked-squawk thumbnails.
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('id', s.id, 'pictures', s.pictures)),
    '[]'::jsonb
  )
    INTO v_squawks
    FROM aft_squawks s
    WHERE s.id IN (
      SELECT li.squawk_id FROM aft_event_line_items li
      WHERE li.event_id = v_event_id AND li.squawk_id IS NOT NULL
    );

  SELECT COALESCE(jsonb_agg(to_jsonb(m.*) ORDER BY m.created_at), '[]'::jsonb)
    INTO v_messages
    FROM aft_event_messages m
    WHERE m.event_id = v_event_id;

  RETURN jsonb_build_object(
    'event',      v_event,
    'aircraft',   v_aircraft,
    'line_items', v_line_items,
    'squawks',    v_squawks,
    'messages',   v_messages
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_portal_event(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_portal_squawk(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_squawk      jsonb;
  v_aircraft    jsonb;
  v_aircraft_id uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(s.*) INTO v_squawk
    FROM aft_squawks s
    WHERE s.access_token = p_token
      AND s.deleted_at IS NULL;

  IF v_squawk IS NULL THEN
    RETURN NULL;
  END IF;

  v_aircraft_id := (v_squawk->>'aircraft_id')::uuid;

  -- Limited column projection — public squawk page renders aircraft
  -- type + contacts only. Don't expose times / setup fields to anon
  -- callers via this path.
  SELECT jsonb_build_object(
    'tail_number',        a.tail_number,
    'aircraft_type',      a.aircraft_type,
    'serial_number',      a.serial_number,
    'mx_contact',         a.mx_contact,
    'mx_contact_email',   a.mx_contact_email,
    'main_contact',       a.main_contact,
    'main_contact_email', a.main_contact_email
  ) INTO v_aircraft
    FROM aft_aircraft a
    WHERE a.id = v_aircraft_id
      AND a.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'squawk',   v_squawk,
    'aircraft', v_aircraft
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_portal_squawk(text) TO anon, authenticated;

COMMIT;

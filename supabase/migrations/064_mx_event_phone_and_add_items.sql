-- =============================================================
-- Migration 064: phone snapshot + add-items email throttle
-- =============================================================
-- Two unrelated additions to aft_maintenance_events to support the
-- portal phone display + the "add items after send" workflow:
--
-- 1. mx_contact_phone + primary_contact_phone columns.
--    aft_aircraft already has main_contact_phone + mx_contact_phone
--    columns (captured in AircraftModal, used by the work-package
--    email) but the event row never snapshot them. Without a
--    snapshot the portal cannot render a tel: link without an
--    extra round-trip back to the aircraft row, which the
--    SECURITY DEFINER RPC can't easily do without leaking other
--    aircraft fields.
--
-- 2. last_add_items_email_at column.
--    Drives the leading-edge throttle on the add-items email so
--    an owner adding 3 squawks in 30 seconds doesn't blast the
--    mechanic with three notification emails. First add within
--    a 5-minute window emails; subsequent adds within that
--    window are silent. Owner sees every add live in the
--    in-app activity rail regardless.
--
-- The create_mx_event_atomic RPC is recreated whole here so the
-- snapshot extends to the two new phone fields. Behaviour is
-- otherwise unchanged from migration 051.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

-- ── columns ──────────────────────────────────────────────────

ALTER TABLE aft_maintenance_events
  ADD COLUMN IF NOT EXISTS mx_contact_phone text,
  ADD COLUMN IF NOT EXISTS primary_contact_phone text,
  ADD COLUMN IF NOT EXISTS last_add_items_email_at timestamptz;

-- ── create_mx_event_atomic ──────────────────────────────────

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
    mx_contact_name,  mx_contact_email,  mx_contact_phone,
    primary_contact_name, primary_contact_email, primary_contact_phone
  )
  VALUES (
    p_aircraft_id, p_user_id, 'draft',
    p_proposed_date,
    CASE WHEN p_proposed_date IS NOT NULL THEN 'owner' ELSE NULL END,
    COALESCE(p_addon_services, ARRAY[]::text[]),
    v_aircraft.mx_contact,    v_aircraft.mx_contact_email,    v_aircraft.mx_contact_phone,
    v_aircraft.main_contact,  v_aircraft.main_contact_email,  v_aircraft.main_contact_phone
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

COMMIT;

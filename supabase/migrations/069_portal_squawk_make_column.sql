-- =====================================================
-- Migration 069 — expose `make` to the public squawk
-- portal so the header reads "N12345 — Cessna 172N"
-- instead of "N12345 — 172N".
-- =====================================================
--
-- get_portal_squawk used an explicit jsonb_build_object
-- projection that omitted the `make` column. After the
-- aircraft_type=model shape alignment (Howard onboarding
-- now writes the same convention as the form), the public
-- squawk page lost the make context — it could only render
-- the model string. This migration adds `make` to the
-- projection so the page's formatAircraftType helper can
-- fold "Cessna" + "172N" back together.
--
-- The service portal RPC (get_portal_event) already returns
-- to_jsonb(a.*) so it picks up `make` automatically — only
-- the squawk RPC needed the explicit column add.
--
-- Safe to re-run: CREATE OR REPLACE keeps the function
-- definition idempotent.

BEGIN;

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
  -- callers via this path. `make` joined back in for the post-
  -- aircraft_type=model display fix.
  SELECT jsonb_build_object(
    'tail_number',        a.tail_number,
    'make',               a.make,
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

-- =============================================================
-- Migration 034: Atomic aircraft creation
-- =============================================================
-- /api/aircraft/create used to do three sequential writes:
--   1) INSERT aft_aircraft (with client-supplied payload)
--   2) INSERT aft_user_aircraft_access making the creator admin
--   3) UPDATE aft_user_roles.completed_onboarding = true
-- If step 2 or 3 failed, the aircraft existed with no admin — the
-- creator couldn't see or edit it, and nobody except global admins
-- could recover it. Funnel all three through one SQL function so
-- they commit (or roll back) together.
--
-- The function accepts a JSONB payload of aircraft columns. The
-- caller is expected to have already allow-listed the keys; the
-- function intentionally doesn't enforce column shape so it stays
-- forward-compatible with future columns.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION create_aircraft_atomic(
  p_user_id uuid,
  p_payload jsonb
)
RETURNS aft_aircraft
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- First-time onboarding — only flip the flag if it wasn't already
  -- set so a global admin creating a second aircraft doesn't trigger
  -- the "welcome" flow again.
  UPDATE aft_user_roles
    SET completed_onboarding = true
    WHERE user_id = p_user_id
      AND completed_onboarding = false;

  RETURN v_aircraft;
END;
$$;

COMMIT;

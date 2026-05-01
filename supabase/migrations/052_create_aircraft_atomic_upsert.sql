-- =============================================================
-- Migration 052: create_aircraft_atomic — upsert role row
-- =============================================================
-- The RPC from migration 034 ends with:
--   UPDATE aft_user_roles
--      SET completed_onboarding = true
--    WHERE user_id = p_user_id
--      AND completed_onboarding = false;
-- That's a silent no-op if no aft_user_roles row exists for the
-- caller — and we've seen at least one user hit exactly that path.
-- The aircraft + access rows are written successfully, but the
-- onboarding flag never flips, so the next render of AppShell
-- reads `completed_onboarding=null` from `.single() → PGRST116`,
-- coerces it to `false`, and bounces the user back to the
-- onboarding welcome screen with an empty form. From the user's
-- perspective: "I filled out the form, hit save, no error, no
-- aircraft, the form is empty again."
--
-- The fix is to UPSERT instead of UPDATE-only. Use user_id as the
-- conflict key (matches /api/invite + /api/pilot-invite which
-- already upsert into the same table on the same key). On insert,
-- default role to 'pilot' — anyone who reaches this RPC has a
-- valid auth.users row but no profile, which means they're a
-- direct sign-up; pilots is the safer default than admins.
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

COMMIT;

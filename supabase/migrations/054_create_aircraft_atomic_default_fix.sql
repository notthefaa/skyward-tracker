-- =============================================================
-- Migration 054: create_aircraft_atomic — restore default-column firing
-- =============================================================
-- Migration 052's RPC inserts via:
--   INSERT INTO aft_aircraft
--     SELECT * FROM jsonb_populate_record(NULL::aft_aircraft, p_payload | ...)
--
-- jsonb_populate_record(NULL::row_type, json) fills every field of
-- the row type — keys present in the JSON get their value, every
-- other field is NULL. The subsequent INSERT then inserts those
-- NULLs *explicitly*, which suppresses the column's DEFAULT
-- expression. (Per PostgreSQL: DEFAULT fires only when a column is
-- omitted from the INSERT or set to literal DEFAULT.)
--
-- Net effect: every aircraft created via this RPC since migration
-- 052 was applied 2026-05-01 hits
--    null value in column "id" of relation "aft_aircraft"
--    violates not-null constraint
-- and the form silently fails. Manual aircraft creation has been
-- broken for any user without a pre-existing aircraft. Howard-guided
-- onboarding still works because that path uses supabase-js
-- `.insert(row)`, which omits undefined fields.
--
-- The other defaulted-but-not-nullable column on aft_aircraft is
-- `time_zone` (DEFAULT 'UTC' NOT NULL); without this fix that
-- becomes the next blocker once `id` is set. Other defaulted columns
-- (created_at, engine_type, current_fuel_gallons, setup_*, total_*)
-- are nullable, so they only "lose their default" instead of erroring
-- — but the result is rows with NULL `created_at`, NULL fuel etc.,
-- which downstream UI treats as "missing data."
--
-- The fix is to seed the JSON object with the defaults the schema
-- would have provided, then merge the payload over it (so caller
-- values still win), and finally overlay server-controlled fields
-- (created_by) so they can't be spoofed.
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
  v_defaults jsonb;
BEGIN
  -- Recreate the column DEFAULTs in JSON so they fire even though
  -- jsonb_populate_record + INSERT SELECT * would otherwise pass
  -- explicit NULLs and bypass the schema-level DEFAULT clauses.
  v_defaults := jsonb_build_object(
    'id', gen_random_uuid(),
    'created_at', now(),
    'engine_type', 'Piston',
    'total_airframe_time', 0,
    'total_engine_time', 0,
    'current_fuel_gallons', 0,
    'setup_aftt', 0,
    'setup_ftt', 0,
    'setup_hobbs', 0,
    'setup_tach', 0,
    'time_zone', 'UTC'
  );

  -- Aircraft row. Order of merge:
  --   defaults (lowest)  → payload (user-supplied wins) →  server overrides (forced).
  -- `created_by` is force-set from the trusted server-side user id,
  -- not whatever the payload claims.
  INSERT INTO aft_aircraft
    SELECT * FROM jsonb_populate_record(
      NULL::aft_aircraft,
      v_defaults || p_payload || jsonb_build_object('created_by', p_user_id)
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

-- =============================================================
-- Migration 046: ON DELETE CASCADE on aircraft_id FKs that were
--                created without an explicit clause
-- =============================================================
-- Three tables reference aft_aircraft(id) without an ON DELETE
-- action and so default to NO ACTION:
--
--   * aft_airworthiness_directives  (012)
--   * aft_aircraft_equipment        (013)
--   * aft_proposed_actions          (015)
--
-- aft_aircraft is normally soft-deleted (deleted_at), and read
-- paths filter children through the user's accessible aircraft
-- set, so a stale soft-delete doesn't leak rows in normal use.
-- The risk is the rarer hard-delete path (admin manually purging
-- a test aircraft, dev resets, future GDPR-style erasure): under
-- NO ACTION the parent delete fails with a FK violation, blocking
-- the admin op and leaving the cleanup half-done.
--
-- Switching to ON DELETE CASCADE matches the convention already
-- used by every other aircraft-scoped table (aft_squawks,
-- aft_flight_logs, aft_oil_logs, aft_tire_checks, aft_vor_checks,
-- aft_notes, aft_maintenance_*, aft_reservations, etc.). The
-- soft-delete contract is unchanged — only the hard-delete path
-- becomes safe.
--
-- Idempotent: drops the existing constraint by name pattern via
-- pg_catalog before re-creating with the cascade clause.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

-- Helper that drops every FK on a given (table, column) referencing
-- aft_aircraft, regardless of the auto-generated constraint name,
-- then re-creates it with ON DELETE CASCADE. Avoids guessing at
-- constraint names which differ between dev/staging/prod.
CREATE OR REPLACE FUNCTION pg_temp.recreate_aircraft_fk_cascade(
  p_table   text,
  p_column  text
) RETURNS void AS $$
DECLARE
  v_conname text;
BEGIN
  SELECT con.conname INTO v_conname
    FROM pg_constraint con
    JOIN pg_class       rel ON rel.oid = con.conrelid
    JOIN pg_class       fre ON fre.oid = con.confrelid
    JOIN pg_attribute   att ON att.attrelid = con.conrelid
                            AND att.attnum = ANY (con.conkey)
   WHERE con.contype = 'f'
     AND rel.relname = p_table
     AND fre.relname = 'aft_aircraft'
     AND att.attname = p_column
   LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p_table, v_conname);
  END IF;

  EXECUTE format(
    'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES aft_aircraft(id) ON DELETE CASCADE',
    p_table, p_table || '_aircraft_id_fkey', p_column
  );
END;
$$ LANGUAGE plpgsql;

SELECT pg_temp.recreate_aircraft_fk_cascade('aft_airworthiness_directives', 'aircraft_id');
SELECT pg_temp.recreate_aircraft_fk_cascade('aft_aircraft_equipment',       'aircraft_id');
SELECT pg_temp.recreate_aircraft_fk_cascade('aft_proposed_actions',         'aircraft_id');

COMMIT;

-- =============================================================
-- Migration 059: drop dashboard-created duplicate FKs to auth.users
-- =============================================================
-- Several `aft_*` tables have TWO foreign-key constraints on the
-- same column referencing `auth.users(id)` — one auto-named by the
-- migration that created the table, and one named `fk_*_auth_user`
-- created via the Supabase dashboard. Both fire when a user is
-- deleted. Migration 055 dropped the duplicate on
-- `aft_aircraft.created_by`; this migration drops the rest.
--
-- Why now: the dashboard-created duplicates surface as "Database
-- error deleting user" from `auth.admin.deleteUser` when a victim
-- has created an aircraft (the cascade walks through both FKs on
-- aft_user_aircraft_access.user_id, and PostgreSQL's behavior with
-- two CASCADE constraints on the same column triggers the error).
-- Repro: create user → create aircraft (which inserts an
-- aft_user_aircraft_access admin row) → admin tries to delete the
-- user via /api/users DELETE → 500.
--
-- Effect: each `fk_*_auth_user` is a duplicate of the canonical
-- `aft_*_*_fkey` constraint with identical referential action
-- (CASCADE or SET NULL — confirmed against the captured prod
-- baseline `e2e/sql/01_public_schema.sql`). Dropping the
-- duplicate is purely a clean-up; the canonical FK enforces the
-- same contract.
--
-- Idempotent: every DROP uses IF EXISTS so re-running is a no-op
-- on environments where the duplicate has already been cleared.
--
-- Run in the Supabase SQL Editor on BOTH the prod project AND the
-- test project (per the e2e setup, the test schema is captured
-- from prod and inherits the same duplicate-FK shape).
-- =============================================================

BEGIN;

-- aft_user_aircraft_access.user_id — the original surfacing site
-- of the cascade-failure on delete-user-with-aircraft.
ALTER TABLE aft_user_aircraft_access
  DROP CONSTRAINT IF EXISTS fk_user_aircraft_access_auth_user;

-- aft_user_roles.user_id — same shape.
ALTER TABLE aft_user_roles
  DROP CONSTRAINT IF EXISTS fk_user_roles_auth_user;

-- The remaining `fk_*_auth_user` duplicates are SET-NULL
-- duplicates of SET-NULL canonical FKs. They're not actively
-- broken (both actions converge to the same result), but they're
-- still redundant — drop them so the cascade path is single-
-- sourced and future migrations don't need to remember them.
ALTER TABLE aft_flight_logs
  DROP CONSTRAINT IF EXISTS fk_flight_logs_auth_user;

ALTER TABLE aft_maintenance_events
  DROP CONSTRAINT IF EXISTS fk_mx_events_auth_user;

ALTER TABLE aft_note_reads
  DROP CONSTRAINT IF EXISTS fk_note_reads_auth_user;

ALTER TABLE aft_notes
  DROP CONSTRAINT IF EXISTS fk_notes_auth_user;

ALTER TABLE aft_notification_preferences
  DROP CONSTRAINT IF EXISTS fk_notification_prefs_auth_user;

ALTER TABLE aft_reservations
  DROP CONSTRAINT IF EXISTS fk_reservations_auth_user;

ALTER TABLE aft_squawks
  DROP CONSTRAINT IF EXISTS fk_squawks_auth_user;

COMMIT;

-- =============================================================
-- Migration 055: drop the duplicate aft_aircraft.created_by FK
-- =============================================================
-- aft_aircraft.created_by has TWO FK constraints referencing
-- auth.users(id) — one created via migration / dashboard with
-- ON DELETE CASCADE, the other (`fk_aircraft_auth_user`) created
-- via dashboard with ON DELETE SET NULL.
--
-- When a user is deleted via Supabase Auth, both constraints
-- fire. PostgreSQL says "the order of execution is undefined"
-- when conflicting referential actions reference the same
-- column. In practice CASCADE wins (row deleted before SET
-- NULL can act), but it's fragile and the SET NULL contradicts
-- the rest of the app's contract:
--   - account-delete impact preview (api/account/delete) counts
--     owned aircraft on the assumption the user-delete cascades;
--   - the sole-admin guard in /api/users DELETE expects deletion
--     to remove the aircraft + cascade access rows.
--
-- Drop the SET NULL duplicate so user-delete behavior is
-- single-sourced + matches what the impact preview tells the user.
-- The CASCADE FK is unchanged.
--
-- Idempotent: the IF EXISTS guard means re-running is safe; if the
-- duplicate has already been dropped (or never existed in this
-- environment) the statement is a no-op.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

ALTER TABLE aft_aircraft
  DROP CONSTRAINT IF EXISTS fk_aircraft_auth_user;

COMMIT;

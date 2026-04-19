-- =============================================================
-- Migration 027: DB-level reservation overlap prevention
-- =============================================================
-- Two pilots editing reservations at the same moment can both pass
-- the app-layer conflict check and create an overlap (classic
-- TOCTOU). The app-layer check stays for nicer error messages
-- (shows the conflicting pilot's name), but this exclusion
-- constraint is the real guarantee — it's atomic and can't race.
--
-- Requires the btree_gist extension for the GiST index on the
-- composite (uuid equality + timestamp range overlap) key.
--
-- On conflict, Postgres raises 23P01 (exclusion_violation).
-- friendlyPgError maps it to a user-safe sentence.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Only enforce on confirmed reservations. Cancelled reservations
-- (status = 'cancelled') can overlap freely — they're not competing
-- for the airplane. Reservations use status-based soft-delete, not
-- a deleted_at column (migration 009 didn't add one to this table).
--
-- Drop-then-add keeps re-runs idempotent (42710 otherwise).
ALTER TABLE aft_reservations
  DROP CONSTRAINT IF EXISTS aft_reservations_no_overlap;
ALTER TABLE aft_reservations
  ADD CONSTRAINT aft_reservations_no_overlap
  EXCLUDE USING gist (
    aircraft_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  ) WHERE (status = 'confirmed');

COMMIT;

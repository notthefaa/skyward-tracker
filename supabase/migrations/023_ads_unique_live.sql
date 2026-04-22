-- =============================================================
-- Migration 023: AD UNIQUE applies only to live rows
-- =============================================================
-- The table-level UNIQUE (aircraft_id, ad_number) on
-- aft_airworthiness_directives blocks resurrection: soft-delete an
-- AD, try to re-add the same AD number, and the INSERT fails with
-- 23505 even though the existing row is logically deleted. The
-- 409 feedback is confusing ("already tracked") for a pilot who
-- just deleted it.
--
-- Swap the table-level constraint for a partial UNIQUE INDEX
-- scoped to `deleted_at IS NULL`. Live ADs still can't collide by
-- number, but soft-deleted rows sit beside a fresh live entry.
--
-- Safe to run idempotently. Existing data is preserved; only the
-- uniqueness surface changes.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

-- The constraint was created implicitly by the UNIQUE clause in
-- migration 012 — Postgres named it aft_airworthiness_directives_
-- aircraft_id_ad_number_key. Drop only if it's still there so this
-- migration is safe to re-run.
ALTER TABLE aft_airworthiness_directives
  DROP CONSTRAINT IF EXISTS aft_airworthiness_directives_aircraft_id_ad_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ads_aircraft_adnum_live
  ON aft_airworthiness_directives (aircraft_id, ad_number)
  WHERE deleted_at IS NULL;

COMMIT;

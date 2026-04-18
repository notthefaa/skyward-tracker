-- =============================================================
-- Migration 030: Make tire-check PSI columns nullable
-- =============================================================
-- The tire-check form is shifting from "snapshot all 3 pressures
-- every time" to "log only the tires that needed adjustment, with
-- the PSI you set them to." Tires that weren't adjusted get NULL.
--
-- Existing rows already have non-null values for all 3 columns,
-- so dropping NOT NULL is non-destructive — the data simply
-- continues to be readable, and new rows can leave columns null.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

ALTER TABLE aft_tire_checks
  ALTER COLUMN nose_psi       DROP NOT NULL,
  ALTER COLUMN left_main_psi  DROP NOT NULL,
  ALTER COLUMN right_main_psi DROP NOT NULL;

COMMIT;

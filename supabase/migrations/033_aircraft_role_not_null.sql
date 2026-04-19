-- =============================================================
-- Migration 033: Make aft_user_aircraft_access.aircraft_role NOT NULL
-- =============================================================
-- The invite route (/api/invite/route.ts) used to insert access
-- rows without setting `aircraft_role`, leaving the column NULL.
-- Downstream authz compares the column against the string literals
-- 'admin' / 'pilot' — a NULL value was neither, so the invited
-- pilot silently had no effective role.
--
-- Going forward the app always writes a role (fixed in /api/invite);
-- this migration backfills any pre-existing NULL rows to 'pilot'
-- (safest default — they were already treated that way) and then
-- locks the column down so the shape can't regress.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

UPDATE aft_user_aircraft_access
SET aircraft_role = 'pilot'
WHERE aircraft_role IS NULL;

ALTER TABLE aft_user_aircraft_access
  ALTER COLUMN aircraft_role SET NOT NULL,
  ADD CONSTRAINT aft_user_aircraft_access_role_chk
    CHECK (aircraft_role IN ('admin', 'pilot'));

COMMIT;

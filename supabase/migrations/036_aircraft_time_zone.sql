-- =============================================================
-- Migration 036: aft_aircraft.time_zone
-- =============================================================
-- MX reminders (cron) and airworthiness checks run server-side on
-- Vercel's UTC runtime, but compare `due_date` to "today" using
-- local-TZ `new Date()` math. For a pilot in PDT at 23:59 on the
-- 19th, UTC is already the 20th — a MX item due "2026-04-20"
-- renders as "Due in 0 days" in a server-generated email when the
-- pilot still perceives it as "Due tomorrow".
--
-- Fix: carry the pilot's IANA time-zone identifier on the aircraft
-- row. Server-side date math reads `aircraft.time_zone` and computes
-- "today" in that zone instead of UTC. Default is UTC so existing
-- aircraft keep current behavior until someone sets the column.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

ALTER TABLE aft_aircraft
  ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'UTC';

COMMENT ON COLUMN aft_aircraft.time_zone IS
  'IANA timezone identifier (e.g. America/Los_Angeles). Used by server-side '
  'date-math (cron MX reminders, airworthiness status) so calendar-day '
  'calculations match the pilot''s local date instead of the UTC runtime.';

COMMIT;

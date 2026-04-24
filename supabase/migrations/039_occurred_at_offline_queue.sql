-- =============================================================
-- Migration 039: occurred_at on all companion-app-queued tables
-- =============================================================
-- The companion app buffers submissions offline with a local
-- timestamp and flushes them when connectivity returns. Until
-- now the server stamped `created_at = now()` on every row,
-- which meant a VOR check logged 29 days ago offline was
-- recorded as "today" on replay — silently inventing 30 more
-- days of FAR 91.171 validity that don't actually exist.
--
-- `occurred_at` captures when the event physically happened.
-- `created_at` stays as the server's write-time audit stamp.
-- Sort keys, compliance math, and the UI dials all move to
-- `occurred_at`; `created_at` only remains for audit trails.
--
-- Backward compatibility: default is `now()`, so a legacy
-- client that doesn't send `occurred_at` behaves exactly like
-- today. Backfill sets `occurred_at = created_at` on every
-- existing row so historical sort order is preserved.
--
-- Also adds (aircraft_id, occurred_at DESC) indexes on all
-- five tables — the hot query ("latest log for this aircraft")
-- now hits an index instead of scanning.
-- =============================================================

BEGIN;

-- ───── aft_flight_logs ─────
ALTER TABLE aft_flight_logs ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
UPDATE aft_flight_logs SET occurred_at = created_at WHERE occurred_at IS NULL;
ALTER TABLE aft_flight_logs ALTER COLUMN occurred_at SET NOT NULL;
ALTER TABLE aft_flight_logs ALTER COLUMN occurred_at SET DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_flight_logs_aircraft_occurred
  ON aft_flight_logs (aircraft_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

-- ───── aft_vor_checks ─────
ALTER TABLE aft_vor_checks ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
UPDATE aft_vor_checks SET occurred_at = created_at WHERE occurred_at IS NULL;
ALTER TABLE aft_vor_checks ALTER COLUMN occurred_at SET NOT NULL;
ALTER TABLE aft_vor_checks ALTER COLUMN occurred_at SET DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_vor_checks_aircraft_occurred
  ON aft_vor_checks (aircraft_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

-- ───── aft_oil_logs ─────
ALTER TABLE aft_oil_logs ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
UPDATE aft_oil_logs SET occurred_at = created_at WHERE occurred_at IS NULL;
ALTER TABLE aft_oil_logs ALTER COLUMN occurred_at SET NOT NULL;
ALTER TABLE aft_oil_logs ALTER COLUMN occurred_at SET DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_oil_logs_aircraft_occurred
  ON aft_oil_logs (aircraft_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

-- ───── aft_tire_checks ─────
ALTER TABLE aft_tire_checks ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
UPDATE aft_tire_checks SET occurred_at = created_at WHERE occurred_at IS NULL;
ALTER TABLE aft_tire_checks ALTER COLUMN occurred_at SET NOT NULL;
ALTER TABLE aft_tire_checks ALTER COLUMN occurred_at SET DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_tire_checks_aircraft_occurred
  ON aft_tire_checks (aircraft_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

-- ───── aft_squawks ─────
ALTER TABLE aft_squawks ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
UPDATE aft_squawks SET occurred_at = created_at WHERE occurred_at IS NULL;
ALTER TABLE aft_squawks ALTER COLUMN occurred_at SET NOT NULL;
ALTER TABLE aft_squawks ALTER COLUMN occurred_at SET DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_squawks_aircraft_occurred
  ON aft_squawks (aircraft_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

COMMIT;

-- =============================================================
-- Migration 013: Aircraft equipment inventory with capability flags
-- =============================================================
-- Tracks every installed/removed item of equipment on each aircraft.
-- Capability flags feed into airworthiness checks (91.205 IFR/for-hire,
-- 91.411 altimeter, 91.413 transponder, 91.207 ELT) and drive the FAA
-- DRS AD query (make/model/serial matching).
--
-- Removing equipment doesn't delete the row — set `removed_at` so the
-- retention audit trail stays intact.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

-- Broad category enum — expandable via ALTER TYPE later.
DO $$ BEGIN
  CREATE TYPE aft_equipment_category AS ENUM (
    'engine',
    'propeller',
    'avionics',
    'transponder',
    'altimeter',
    'pitot_static',
    'elt',
    'adsb',
    'autopilot',
    'gps',
    'radio',
    'intercom',
    'instrument',
    'landing_gear',
    'lighting',
    'accessory',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS aft_aircraft_equipment (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id            uuid NOT NULL REFERENCES aft_aircraft(id),

  -- Identity
  category               aft_equipment_category NOT NULL,
  name                   text NOT NULL,              -- "Primary Transponder"
  make                   text,                        -- "Garmin"
  model                  text,                        -- "GTX 345"
  serial                 text,
  part_number            text,

  -- Lifecycle
  installed_at           date,
  installed_by           text,                        -- A&P name/cert
  removed_at             date,                        -- NULL = currently installed
  removed_reason         text,

  -- Capability flags — drive airworthiness checks
  ifr_capable            boolean NOT NULL DEFAULT false,
  adsb_out              boolean NOT NULL DEFAULT false,
  adsb_in               boolean NOT NULL DEFAULT false,
  transponder_class     text,                        -- e.g. "Class 1A (Mode S/ES)"
  is_elt                boolean NOT NULL DEFAULT false,
  elt_battery_expires   date,
  elt_battery_cumulative_hours numeric,              -- 91.207(a)(1) 1-hour emergency-use trigger

  -- Periodic checks tied to this piece of equipment
  pitot_static_due_date date,                        -- 91.411 24-month
  transponder_due_date  date,                        -- 91.413 24-month
  altimeter_due_date    date,                        -- 91.411 24-month
  vor_due_date          date,                        -- 91.171 (if the equipment is a VOR)

  -- Misc
  notes                 text,

  -- Audit / soft-delete
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES auth.users(id),
  deleted_at            timestamptz,
  deleted_by            uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_equipment_aircraft_live
  ON aft_aircraft_equipment (aircraft_id, category)
  WHERE deleted_at IS NULL AND removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_equipment_ifr
  ON aft_aircraft_equipment (aircraft_id)
  WHERE deleted_at IS NULL AND removed_at IS NULL AND ifr_capable = true;

ALTER TABLE aft_aircraft_equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipment_select" ON aft_aircraft_equipment;
CREATE POLICY "equipment_select" ON aft_aircraft_equipment FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM aft_user_roles WHERE user_id = auth.uid() AND role = 'admin')
    OR aircraft_id IN (
      SELECT aircraft_id FROM aft_user_aircraft_access WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "equipment_write" ON aft_aircraft_equipment;
CREATE POLICY "equipment_write" ON aft_aircraft_equipment FOR ALL
  USING (
    EXISTS (SELECT 1 FROM aft_user_roles WHERE user_id = auth.uid() AND role = 'admin')
    OR aircraft_id IN (
      SELECT aircraft_id FROM aft_user_aircraft_access
      WHERE user_id = auth.uid() AND aircraft_role = 'admin'
    )
  );

-- History trigger
DROP TRIGGER IF EXISTS trg_history ON aft_aircraft_equipment;
CREATE TRIGGER trg_history
  AFTER INSERT OR UPDATE OR DELETE ON aft_aircraft_equipment
  FOR EACH ROW EXECUTE FUNCTION log_record_history();

CREATE OR REPLACE FUNCTION aft_equipment_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipment_touch ON aft_aircraft_equipment;
CREATE TRIGGER trg_equipment_touch
  BEFORE UPDATE ON aft_aircraft_equipment
  FOR EACH ROW EXECUTE FUNCTION aft_equipment_touch_updated_at();

-- Helpful aircraft-level flags we might want directly on aft_aircraft
-- (optional — UI can derive from the equipment table instead).
ALTER TABLE aft_aircraft ADD COLUMN IF NOT EXISTS is_ifr_equipped boolean;
ALTER TABLE aft_aircraft ADD COLUMN IF NOT EXISTS is_for_hire boolean;
ALTER TABLE aft_aircraft ADD COLUMN IF NOT EXISTS make text;
ALTER TABLE aft_aircraft ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE aft_aircraft ADD COLUMN IF NOT EXISTS year_mfg integer;

COMMIT;

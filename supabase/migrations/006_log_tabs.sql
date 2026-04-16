-- =============================================================
-- Migration 006: VOR Check, Tire Check, and Oil Log tables
-- =============================================================
-- Run in the Supabase SQL Editor.
-- =============================================================

-- 1. VOR Check Log (FAR 91.171)
CREATE TABLE IF NOT EXISTS aft_vor_checks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id   uuid NOT NULL REFERENCES aft_aircraft(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  check_type    text NOT NULL CHECK (check_type IN ('VOT', 'Ground Checkpoint', 'Airborne Checkpoint', 'Dual VOR')),
  station       text NOT NULL,
  bearing_error numeric(4,1) NOT NULL,
  tolerance     numeric(4,1) NOT NULL,
  passed        boolean NOT NULL,
  initials      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vor_checks_aircraft
  ON aft_vor_checks (aircraft_id, created_at DESC);

-- 2. Tire Pressure Log
CREATE TABLE IF NOT EXISTS aft_tire_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id     uuid NOT NULL REFERENCES aft_aircraft(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nose_psi        numeric(5,1) NOT NULL,
  left_main_psi   numeric(5,1) NOT NULL,
  right_main_psi  numeric(5,1) NOT NULL,
  initials        text NOT NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tire_checks_aircraft
  ON aft_tire_checks (aircraft_id, created_at DESC);

-- 3. Oil Log
CREATE TABLE IF NOT EXISTS aft_oil_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id   uuid NOT NULL REFERENCES aft_aircraft(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  oil_qty       numeric(4,1) NOT NULL,
  oil_added     numeric(4,1),
  engine_hours  numeric(8,1) NOT NULL,
  initials      text NOT NULL,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oil_logs_aircraft
  ON aft_oil_logs (aircraft_id, created_at DESC);

-- 4. Enable RLS on all tables
ALTER TABLE aft_vor_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE aft_tire_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE aft_oil_logs ENABLE ROW LEVEL SECURITY;

-- 5. SELECT policies (users with aircraft access)
CREATE POLICY "vor_select" ON aft_vor_checks FOR SELECT
  USING (aircraft_id IN (
    SELECT aircraft_id FROM aft_user_aircraft_access WHERE user_id = auth.uid()
  ));
CREATE POLICY "tire_select" ON aft_tire_checks FOR SELECT
  USING (aircraft_id IN (
    SELECT aircraft_id FROM aft_user_aircraft_access WHERE user_id = auth.uid()
  ));
CREATE POLICY "oil_select" ON aft_oil_logs FOR SELECT
  USING (aircraft_id IN (
    SELECT aircraft_id FROM aft_user_aircraft_access WHERE user_id = auth.uid()
  ));

-- 6. INSERT policies (users with aircraft access)
CREATE POLICY "vor_insert" ON aft_vor_checks FOR INSERT
  WITH CHECK (aircraft_id IN (
    SELECT aircraft_id FROM aft_user_aircraft_access WHERE user_id = auth.uid()
  ));
CREATE POLICY "tire_insert" ON aft_tire_checks FOR INSERT
  WITH CHECK (aircraft_id IN (
    SELECT aircraft_id FROM aft_user_aircraft_access WHERE user_id = auth.uid()
  ));
CREATE POLICY "oil_insert" ON aft_oil_logs FOR INSERT
  WITH CHECK (aircraft_id IN (
    SELECT aircraft_id FROM aft_user_aircraft_access WHERE user_id = auth.uid()
  ));

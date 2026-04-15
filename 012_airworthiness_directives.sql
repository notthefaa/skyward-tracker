-- =============================================================
-- Migration 012: First-class Airworthiness Directive tracking
-- =============================================================
-- Replaces the ad-hoc squawk/note approach with a dedicated
-- table so we can produce 14 CFR 91.417(b) compliance reports
-- and let Chuck answer "what ADs apply to my aircraft?".
--
-- Rows can come from three sources:
--   - 'drs_sync'  — populated by the nightly FAA DRS cron
--   - 'manual'    — added by an aircraft admin
--   - 'user_added' — added via the API (same as manual for now)
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS aft_airworthiness_directives (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id                 uuid NOT NULL REFERENCES aft_aircraft(id),

  -- Identity
  ad_number                   text NOT NULL,          -- "2020-12-04"
  amendment                   text,                    -- "39-XXXXX"
  subject                     text NOT NULL,
  applicability               text,                    -- e.g. "Cessna 172 Model S; Lycoming IO-360"
  source_url                  text,                    -- link to FAA PDF
  source                      text NOT NULL DEFAULT 'manual'
                              CHECK (source IN ('drs_sync', 'manual', 'user_added')),

  -- Status
  effective_date              date,
  is_superseded               boolean NOT NULL DEFAULT false,
  superseded_by               text,

  -- Compliance shape
  compliance_type             text NOT NULL DEFAULT 'one_time'
                              CHECK (compliance_type IN ('one_time', 'recurring')),
  initial_compliance_hours    numeric,
  initial_compliance_date     date,
  recurring_interval_hours    numeric,
  recurring_interval_months   integer,

  -- Tracking
  last_complied_date          date,
  last_complied_time          numeric,                 -- aircraft hours
  last_complied_by            text,                    -- mechanic name/cert
  next_due_date               date,
  next_due_time               numeric,
  compliance_method           text,                    -- "Inspection per AD, found serviceable"
  notes                       text,

  -- Airworthiness impact
  affects_airworthiness       boolean NOT NULL DEFAULT true,

  -- Audit / lifecycle
  synced_at                   timestamptz,             -- last DRS sync pull
  sync_hash                   text,                    -- change-detection hash from DRS
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES auth.users(id),
  deleted_at                  timestamptz,
  deleted_by                  uuid REFERENCES auth.users(id),

  UNIQUE (aircraft_id, ad_number)
);

CREATE INDEX IF NOT EXISTS idx_ads_aircraft_live
  ON aft_airworthiness_directives (aircraft_id, next_due_date)
  WHERE deleted_at IS NULL AND is_superseded = false;

CREATE INDEX IF NOT EXISTS idx_ads_aircraft_due_time
  ON aft_airworthiness_directives (aircraft_id, next_due_time)
  WHERE deleted_at IS NULL AND is_superseded = false AND next_due_time IS NOT NULL;

ALTER TABLE aft_airworthiness_directives ENABLE ROW LEVEL SECURITY;

-- Read: anyone with aircraft access
DROP POLICY IF EXISTS "ads_select" ON aft_airworthiness_directives;
CREATE POLICY "ads_select" ON aft_airworthiness_directives FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM aft_user_roles WHERE user_id = auth.uid() AND role = 'admin')
    OR aircraft_id IN (
      SELECT aircraft_id FROM aft_user_aircraft_access WHERE user_id = auth.uid()
    )
  );

-- Write: aircraft admins + global admins (service role bypasses anyway)
DROP POLICY IF EXISTS "ads_write" ON aft_airworthiness_directives;
CREATE POLICY "ads_write" ON aft_airworthiness_directives FOR ALL
  USING (
    EXISTS (SELECT 1 FROM aft_user_roles WHERE user_id = auth.uid() AND role = 'admin')
    OR aircraft_id IN (
      SELECT aircraft_id FROM aft_user_aircraft_access
      WHERE user_id = auth.uid() AND aircraft_role = 'admin'
    )
  );

-- Attach the generic history trigger from migration 009
DROP TRIGGER IF EXISTS trg_history ON aft_airworthiness_directives;
CREATE TRIGGER trg_history
  AFTER INSERT OR UPDATE OR DELETE ON aft_airworthiness_directives
  FOR EACH ROW EXECUTE FUNCTION log_record_history();

-- updated_at auto-bump
CREATE OR REPLACE FUNCTION aft_ads_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ads_touch ON aft_airworthiness_directives;
CREATE TRIGGER trg_ads_touch
  BEFORE UPDATE ON aft_airworthiness_directives
  FOR EACH ROW EXECUTE FUNCTION aft_ads_touch_updated_at();

COMMIT;

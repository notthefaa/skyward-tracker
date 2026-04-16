-- =============================================================
-- Migration 009: Soft-delete + generic audit log
-- =============================================================
-- Goals:
--   1. No more hard deletes on records governed by FAA retention
--      rules (14 CFR 91.417 etc.). Keep the row; mark it deleted.
--   2. Full change history across high-value tables via triggers.
--
-- Run in the Supabase SQL Editor in a single transaction.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. Soft-delete columns
-- -------------------------------------------------------------

ALTER TABLE aft_aircraft            ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE aft_aircraft            ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

ALTER TABLE aft_flight_logs         ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE aft_flight_logs         ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

ALTER TABLE aft_maintenance_items   ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE aft_maintenance_items   ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

ALTER TABLE aft_maintenance_events  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE aft_maintenance_events  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

ALTER TABLE aft_event_line_items    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE aft_event_line_items    ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

ALTER TABLE aft_squawks             ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE aft_squawks             ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

ALTER TABLE aft_vor_checks          ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE aft_vor_checks          ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

ALTER TABLE aft_tire_checks         ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE aft_tire_checks         ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

ALTER TABLE aft_oil_logs            ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE aft_oil_logs            ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

ALTER TABLE aft_notes               ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE aft_notes               ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

ALTER TABLE aft_documents           ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE aft_documents           ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

-- Document tamper-evidence (SHA-256 of the uploaded bytes)
ALTER TABLE aft_documents           ADD COLUMN IF NOT EXISTS sha256    text;
ALTER TABLE aft_documents           ADD COLUMN IF NOT EXISTS file_size bigint;
CREATE INDEX IF NOT EXISTS idx_documents_sha ON aft_documents (aircraft_id, sha256) WHERE deleted_at IS NULL;

-- Partial indexes so SELECT ... WHERE deleted_at IS NULL stays fast.
CREATE INDEX IF NOT EXISTS idx_flight_logs_live       ON aft_flight_logs (aircraft_id, created_at DESC)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mx_items_live          ON aft_maintenance_items (aircraft_id)                  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mx_events_live         ON aft_maintenance_events (aircraft_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_squawks_live           ON aft_squawks (aircraft_id, created_at DESC)           WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vor_checks_live        ON aft_vor_checks (aircraft_id, created_at DESC)        WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_aircraft_live          ON aft_aircraft (id)                                    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_live         ON aft_documents (aircraft_id, created_at DESC)         WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notes_live             ON aft_notes (aircraft_id, created_at DESC)             WHERE deleted_at IS NULL;

-- -------------------------------------------------------------
-- 2. Audit history table
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS aft_record_history (
  id           bigserial PRIMARY KEY,
  table_name   text        NOT NULL,
  record_id    uuid        NOT NULL,
  aircraft_id  uuid,       -- denormalized for fast per-aircraft history queries
  operation    text        NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  user_id      uuid        REFERENCES auth.users(id),
  changed_at   timestamptz NOT NULL DEFAULT now(),
  old_row      jsonb,
  new_row      jsonb
);

CREATE INDEX IF NOT EXISTS idx_record_history_table_record
  ON aft_record_history (table_name, record_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_record_history_aircraft
  ON aft_record_history (aircraft_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_record_history_user
  ON aft_record_history (user_id, changed_at DESC);

ALTER TABLE aft_record_history ENABLE ROW LEVEL SECURITY;

-- Aircraft admins (and global admins) can read their aircraft's history.
DROP POLICY IF EXISTS "record_history_select" ON aft_record_history;
CREATE POLICY "record_history_select" ON aft_record_history FOR SELECT
  USING (
    -- global admins
    EXISTS (SELECT 1 FROM aft_user_roles WHERE user_id = auth.uid() AND role = 'admin')
    OR
    -- aircraft admins on that aircraft
    (aircraft_id IS NOT NULL AND aircraft_id IN (
      SELECT aircraft_id FROM aft_user_aircraft_access
      WHERE user_id = auth.uid() AND aircraft_role = 'admin'
    ))
  );

-- Only service role can write — triggers use SECURITY DEFINER so this is OK.
-- (No INSERT policy; service role bypasses RLS.)

-- -------------------------------------------------------------
-- 3. Generic trigger: log every INSERT/UPDATE/DELETE
-- -------------------------------------------------------------

CREATE OR REPLACE FUNCTION log_record_history() RETURNS TRIGGER AS $$
DECLARE
  v_user_id uuid;
  v_aircraft_id uuid;
  v_record_id uuid;
BEGIN
  -- Prefer session-set user (API routes call set_config before writes);
  -- fall back to auth.uid() when the request came through PostgREST.
  BEGIN
    v_user_id := nullif(current_setting('app.current_user_id', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;
  IF v_user_id IS NULL THEN
    BEGIN
      v_user_id := auth.uid();
    EXCEPTION WHEN OTHERS THEN
      v_user_id := NULL;
    END;
  END IF;

  -- Derive aircraft_id: use aircraft_id column when present, else fall back
  -- to id (for the aft_aircraft table itself).
  IF TG_OP = 'DELETE' THEN
    v_record_id := (row_to_json(OLD)->>'id')::uuid;
    v_aircraft_id := coalesce(
      nullif(row_to_json(OLD)->>'aircraft_id', '')::uuid,
      CASE WHEN TG_TABLE_NAME = 'aft_aircraft' THEN v_record_id ELSE NULL END
    );
    INSERT INTO aft_record_history (table_name, record_id, aircraft_id, operation, user_id, old_row, new_row)
    VALUES (TG_TABLE_NAME, v_record_id, v_aircraft_id, 'DELETE', v_user_id, to_jsonb(OLD), NULL);
    RETURN OLD;
  ELSE
    v_record_id := (row_to_json(NEW)->>'id')::uuid;
    v_aircraft_id := coalesce(
      nullif(row_to_json(NEW)->>'aircraft_id', '')::uuid,
      CASE WHEN TG_TABLE_NAME = 'aft_aircraft' THEN v_record_id ELSE NULL END
    );
    IF TG_OP = 'INSERT' THEN
      INSERT INTO aft_record_history (table_name, record_id, aircraft_id, operation, user_id, old_row, new_row)
      VALUES (TG_TABLE_NAME, v_record_id, v_aircraft_id, 'INSERT', v_user_id, NULL, to_jsonb(NEW));
    ELSE
      -- UPDATE
      INSERT INTO aft_record_history (table_name, record_id, aircraft_id, operation, user_id, old_row, new_row)
      VALUES (TG_TABLE_NAME, v_record_id, v_aircraft_id, 'UPDATE', v_user_id, to_jsonb(OLD), to_jsonb(NEW));
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------------
-- 4. Attach trigger to the retention-critical tables
-- -------------------------------------------------------------

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'aft_aircraft',
    'aft_flight_logs',
    'aft_maintenance_items',
    'aft_maintenance_events',
    'aft_event_line_items',
    'aft_squawks',
    'aft_vor_checks',
    'aft_tire_checks',
    'aft_oil_logs',
    'aft_notes',
    'aft_documents'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_history ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_history AFTER INSERT OR UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION log_record_history()',
      t
    );
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- 5. Helper function: set the current user for this transaction
--    (called by the API layer before any write.)
-- -------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_app_user(p_user_id uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id::text, true);
END;
$$ LANGUAGE plpgsql;

-- Grant execute on the helper to authenticated role + service_role.
GRANT EXECUTE ON FUNCTION set_app_user(uuid) TO authenticated, service_role;

COMMIT;

-- =============================================================
-- NOTES FOR APPLICATION LAYER
-- =============================================================
-- 1. Every write path must first call `set_app_user(user_id)` so the
--    trigger records who made the change. See src/lib/audit.ts.
-- 2. All SELECT queries on the tables above should filter
--    `.is('deleted_at', null)` unless you specifically want deleted rows
--    (e.g. for admin recovery / compliance export).
-- 3. Hard DELETE should now be reserved for non-retention rows only
--    (aft_chuck_messages, aft_note_reads, aft_user_preferences, etc.).
--    All delete endpoints on tracked tables must UPDATE deleted_at instead.
-- =============================================================

-- =============================================================
-- Migration 005: Generic User Preferences
-- =============================================================
-- Run in the Supabase SQL Editor.
--
-- Creates a generic key-value preferences table for per-user
-- settings that need to sync across devices (e.g. nav tray order).
-- Uses a composite PK on (user_id, pref_key) with a jsonb value
-- column for flexibility.
-- =============================================================

-- 1. Create the table
CREATE TABLE IF NOT EXISTS aft_user_preferences (
  user_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pref_key  text        NOT NULL,
  value     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pref_key)
);

-- 2. Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_user_prefs_user
  ON aft_user_preferences (user_id);

-- 3. Auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_prefs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_prefs_updated_at
  BEFORE UPDATE ON aft_user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_prefs_timestamp();

-- 4. Enable RLS
ALTER TABLE aft_user_preferences ENABLE ROW LEVEL SECURITY;

-- 5. Users can only read/write their own preferences
CREATE POLICY "Users manage own preferences"
  ON aft_user_preferences
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =============================================================
-- Migration 058: aft_idempotency_keys hotfix
-- =============================================================
-- Migration 028 (and the follow-up 043 widening the unique constraint)
-- were marked applied in our records, but the live DB came back with
-- PGRST205 ("Could not find the table 'public.aft_idempotency_keys' in
-- the schema cache") on every POST that uses the idempotency wrapper —
-- ~20 routes including invite, squawks, notes, flight-logs, mx-events,
-- reservations, oil/tire/vor checks, documents, and batch-submit.
--
-- This file is the idempotent re-runnable version of 028 + 043
-- collapsed: a fresh table gets the per-route uniqueness from the
-- start (no need to drop+re-add a 2-column constraint), and every
-- statement is guarded so re-running on a partially-migrated DB is a
-- no-op rather than a duplicate-constraint error.
--
-- Includes a NOTIFY at the end so PostgREST reloads its schema cache
-- without a separate dashboard click.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS aft_idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key             text NOT NULL,
  route           text NOT NULL,
  response_status smallint NOT NULL,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- If the table existed already with the legacy 2-column unique
-- (user_id, key) from 028, drop it so the per-route widening from 043
-- can take its place. Find the constraint by column signature so the
-- pg-generated name doesn't matter.
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT c.conname INTO v_constraint_name
  FROM pg_constraint c
  WHERE c.conrelid = 'aft_idempotency_keys'::regclass
    AND c.contype = 'u'
    AND array_length(c.conkey, 1) = 2
    AND (
      SELECT array_agg(a.attname::text ORDER BY a.attname::text)
      FROM pg_attribute a
      WHERE a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    ) = ARRAY['key', 'user_id']
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE aft_idempotency_keys DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

-- Add the per-route uniqueness if it isn't already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'aft_idempotency_keys'::regclass
      AND conname = 'aft_idempotency_keys_user_id_key_route_key'
  ) THEN
    ALTER TABLE aft_idempotency_keys
      ADD CONSTRAINT aft_idempotency_keys_user_id_key_route_key
      UNIQUE (user_id, key, route);
  END IF;
END $$;

-- Cleanup index for the lazy-prune query
-- (DELETE ... WHERE created_at < now() - interval '1 hour').
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_cleanup
  ON aft_idempotency_keys (created_at);

COMMIT;

-- Tell PostgREST to reload its schema cache so the new table is
-- visible to API requests immediately. Without this, PGRST205 can
-- linger for a couple of minutes while the cache TTL elapses.
SELECT pg_notify('pgrst', 'reload schema');

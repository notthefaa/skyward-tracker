-- =============================================================
-- Migration 043: scope idempotency keys per-route
-- =============================================================
-- Migration 028 put a UNIQUE(user_id, key) constraint on
-- aft_idempotency_keys. That works fine for one route but
-- collides across entry points: the companion app could send
-- the same UUID via /api/oil-logs and /api/batch-submit (e.g.
-- if the queue tracks one key per submission regardless of
-- send path). The batch route writes with route='batch-submit/
-- oil' and the individual route writes with route='oil-logs/
-- POST'; under the old unique constraint, the second write
-- would upsert and overwrite the first's cached body. A
-- subsequent retry of the first route would then get the
-- wrong cached response.
--
-- Fix: widen the uniqueness to (user_id, key, route). Each
-- route caches its own response; retries to the same route
-- dedupe correctly. The idempotency.ts check() and save()
-- both already carry `route`, so the only thing that changed
-- is the constraint.
--
-- Existing rows keep working — the old (user_id, key) uniqueness
-- is a strict subset of (user_id, key, route), so any data that
-- satisfied the old one satisfies the new one too. Nothing to
-- backfill.
--
-- Idempotent on re-run: we introspect pg_constraint to find the
-- old 2-column unique by its column signature (not by assumed
-- name, which Postgres may have generated differently across
-- versions) and no-op if the new 3-column one already exists.
-- =============================================================

BEGIN;

-- Drop whatever 2-column UNIQUE constraint currently guards
-- (user_id, key). Find it by column signature so this works
-- regardless of what Postgres auto-named it on create.
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
      -- attname is pg's `name` type; cast to text so the equality
      -- compares against the text[] literal below.
      SELECT array_agg(a.attname::text ORDER BY a.attname::text)
      FROM pg_attribute a
      WHERE a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    ) = ARRAY['key', 'user_id']
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE aft_idempotency_keys DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

-- Add the new (user_id, key, route) uniqueness if it's not
-- already in place. Guarded by pg_constraint lookup so a re-run
-- after a partial success is a no-op instead of a duplicate-
-- constraint error.
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

COMMIT;

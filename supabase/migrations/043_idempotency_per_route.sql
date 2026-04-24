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
-- Existing rows keep working — we drop the old constraint
-- and add the new one. Nothing to backfill.
-- =============================================================

BEGIN;

-- Drop the old (user_id, key) unique constraint.
ALTER TABLE aft_idempotency_keys
  DROP CONSTRAINT IF EXISTS aft_idempotency_keys_user_id_key_key;

-- Add the new (user_id, key, route) uniqueness.
ALTER TABLE aft_idempotency_keys
  ADD CONSTRAINT aft_idempotency_keys_user_id_key_route_key
  UNIQUE (user_id, key, route);

COMMIT;

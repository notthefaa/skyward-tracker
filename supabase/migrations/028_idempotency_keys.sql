-- =============================================================
-- Migration 028: Idempotency keys for POST routes
-- =============================================================
-- Client sends an X-Idempotency-Key header (UUID v4) on creates.
-- If the same (user, key) pair is seen again within the retention
-- window, the server returns the cached response instead of
-- inserting a duplicate row. Protects against slow-network
-- double-tap, browser back + resubmit, and concurrent-tab races.
--
-- Retention: rows older than 1 hour are pruned on read (lazy) or
-- by an optional cron. The 1-hour window covers any realistic
-- network retry scenario without accumulating garbage.
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
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, key)
);

-- Plain btree on created_at supports the cleanup query
-- (DELETE ... WHERE created_at < now() - interval '1 hour').
-- A partial-index predicate using now() is rejected by Postgres
-- because index predicates must be IMMUTABLE, and now() is STABLE.
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_cleanup
  ON aft_idempotency_keys (created_at);

COMMIT;

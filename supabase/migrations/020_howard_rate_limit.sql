-- Migration 020: Howard rate limit moves from in-process Map to Postgres.
--
-- Why: the prior checkRateLimit (src/lib/howard/rateLimit.ts) kept a
-- per-user Map<userId, timestamp[]> in serverless-function memory.
-- Vercel can cold-start multiple instances, so a user round-robining
-- across them got 20 × N requests per minute instead of 20 total. The
-- Map also grew unbounded with unique users.
--
-- This migration:
--   1. Creates aft_howard_rate_limit (user_id PK, timestamp array,
--      updated_at). Prunable by a vacuum job / retention cron.
--   2. Adds howard_rate_limit_check(user_id, window_ms, max_requests)
--      — a SECURITY DEFINER RPC that atomically checks + records in
--      one transaction using SELECT … FOR UPDATE so concurrent calls
--      serialize per-user.

BEGIN;

CREATE TABLE IF NOT EXISTS aft_howard_rate_limit (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- epoch-millisecond timestamps of recent requests, oldest first.
  timestamps  bigint[] NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Sweep away stale rows (no requests in the last day). Prevents
-- unbounded growth from transient users.
CREATE INDEX IF NOT EXISTS idx_howard_rl_stale ON aft_howard_rate_limit (updated_at);

ALTER TABLE aft_howard_rate_limit ENABLE ROW LEVEL SECURITY;

-- No self-service policy needed — the RPC is SECURITY DEFINER and
-- the only path into the table. Service role bypasses RLS anyway;
-- clients never touch this table directly.

CREATE OR REPLACE FUNCTION howard_rate_limit_check(
  p_user_id       uuid,
  p_window_ms     bigint,
  p_max_requests  int
) RETURNS TABLE(allowed boolean, retry_after_ms bigint) AS $$
DECLARE
  v_now      bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_cutoff   bigint := v_now - p_window_ms;
  v_existing bigint[];
  v_kept     bigint[];
  v_oldest   bigint;
BEGIN
  -- Lock the per-user row so concurrent callers serialize.
  SELECT timestamps INTO v_existing
  FROM aft_howard_rate_limit
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_existing IS NULL THEN
    -- First request ever: insert + allow.
    INSERT INTO aft_howard_rate_limit (user_id, timestamps, updated_at)
    VALUES (p_user_id, ARRAY[v_now], now())
    ON CONFLICT (user_id) DO UPDATE
      SET timestamps = EXCLUDED.timestamps, updated_at = now();
    RETURN QUERY SELECT true, 0::bigint;
    RETURN;
  END IF;

  -- Drop timestamps older than the window.
  SELECT coalesce(array_agg(t ORDER BY t), '{}'::bigint[]) INTO v_kept
  FROM unnest(v_existing) AS t
  WHERE t > v_cutoff;

  IF array_length(v_kept, 1) IS NOT NULL AND array_length(v_kept, 1) >= p_max_requests THEN
    -- Over budget — caller should retry after the oldest kept
    -- timestamp falls out of the window.
    v_oldest := v_kept[1];
    UPDATE aft_howard_rate_limit
    SET timestamps = v_kept, updated_at = now()
    WHERE user_id = p_user_id;
    RETURN QUERY SELECT false, (v_oldest + p_window_ms - v_now)::bigint;
    RETURN;
  END IF;

  -- Allowed: record this timestamp.
  v_kept := v_kept || v_now;
  UPDATE aft_howard_rate_limit
  SET timestamps = v_kept, updated_at = now()
  WHERE user_id = p_user_id;
  RETURN QUERY SELECT true, 0::bigint;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION howard_rate_limit_check(uuid, bigint, int) TO authenticated, service_role;

COMMIT;

-- =============================================================
-- Migration 048: Cross-instance daily cap for Howard web_search
-- =============================================================
-- The Tavily web_search tool currently uses an in-memory bucket
-- (lib/howard/toolHandlers.ts) to enforce a per-user daily call
-- cap. Vercel runs multiple regional instances, so the practical
-- cap is `cap × instance_count` — a determined user can blow
-- through the budget by round-robining requests. Tavily is paid
-- per call, so this is a real cost-bypass.
--
-- This migration moves the bucket into Postgres. One row per user
-- per UTC day, atomic check-and-increment behind SELECT FOR UPDATE
-- so concurrent calls serialize. Old day-rows are pruned by the
-- existing data-retention sweep (see retention cron), or can be
-- swept ad-hoc with `DELETE FROM aft_howard_web_search_daily
-- WHERE day < current_date - 30`.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS aft_howard_web_search_daily (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day        date NOT NULL,
  call_count int  NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_howard_web_search_daily_day
  ON aft_howard_web_search_daily (day);

ALTER TABLE aft_howard_web_search_daily ENABLE ROW LEVEL SECURITY;

-- No self-service policy — the RPC below is SECURITY DEFINER and
-- the only path. Service role bypasses RLS; clients never touch
-- this table directly.

CREATE OR REPLACE FUNCTION howard_web_search_check(
  p_user_id uuid,
  p_max     int
) RETURNS TABLE(allowed boolean, count_after int) AS $$
DECLARE
  v_today date := (now() at time zone 'UTC')::date;
  v_count int;
BEGIN
  -- Lock the per-user-per-day row so concurrent callers serialize.
  SELECT call_count INTO v_count
    FROM aft_howard_web_search_daily
    WHERE user_id = p_user_id AND day = v_today
    FOR UPDATE;

  IF v_count IS NULL THEN
    INSERT INTO aft_howard_web_search_daily (user_id, day, call_count, updated_at)
    VALUES (p_user_id, v_today, 1, now())
    ON CONFLICT (user_id, day) DO UPDATE
      SET call_count = aft_howard_web_search_daily.call_count + 1,
          updated_at = now()
    RETURNING call_count INTO v_count;
    RETURN QUERY SELECT true, v_count;
    RETURN;
  END IF;

  IF v_count >= p_max THEN
    RETURN QUERY SELECT false, v_count;
    RETURN;
  END IF;

  UPDATE aft_howard_web_search_daily
    SET call_count = call_count + 1, updated_at = now()
    WHERE user_id = p_user_id AND day = v_today
    RETURNING call_count INTO v_count;
  RETURN QUERY SELECT true, v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION howard_web_search_check(uuid, int)
  TO authenticated, service_role;

COMMIT;

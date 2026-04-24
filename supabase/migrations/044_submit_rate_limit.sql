-- =============================================================
-- Migration 044: submission rate limiter
-- =============================================================
-- Mirrors the Howard rate limiter (migration 020) but with a
-- separate bucket so queue-flush traffic doesn't starve Howard
-- traffic (or vice versa). Budget is higher here because:
--
--   * Batch endpoint already caps 100 submissions per call, so
--     the real per-minute write rate is bounded at the batch
--     level, not per individual submission.
--   * A legit queue flush after a long offline period can
--     legitimately burst many calls in a short window.
--
-- 60 submission calls per rolling minute per user is generous
-- for any real usage pattern and still stops runaway clients.
-- Tune in submitRateLimit.ts if needed.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS aft_submit_rate_limit (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  timestamps  bigint[] NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_submit_rl_stale ON aft_submit_rate_limit (updated_at);

ALTER TABLE aft_submit_rate_limit ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION submit_rate_limit_check(
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
  SELECT timestamps INTO v_existing
  FROM aft_submit_rate_limit
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_existing IS NULL THEN
    INSERT INTO aft_submit_rate_limit (user_id, timestamps, updated_at)
    VALUES (p_user_id, ARRAY[v_now], now())
    ON CONFLICT (user_id) DO UPDATE
      SET timestamps = EXCLUDED.timestamps, updated_at = now();
    RETURN QUERY SELECT true, 0::bigint;
    RETURN;
  END IF;

  SELECT coalesce(array_agg(t ORDER BY t), '{}'::bigint[]) INTO v_kept
  FROM unnest(v_existing) AS t
  WHERE t > v_cutoff;

  IF array_length(v_kept, 1) IS NOT NULL AND array_length(v_kept, 1) >= p_max_requests THEN
    v_oldest := v_kept[1];
    UPDATE aft_submit_rate_limit
    SET timestamps = v_kept, updated_at = now()
    WHERE user_id = p_user_id;
    RETURN QUERY SELECT false, (v_oldest + p_window_ms - v_now)::bigint;
    RETURN;
  END IF;

  v_kept := v_kept || v_now;
  UPDATE aft_submit_rate_limit
  SET timestamps = v_kept, updated_at = now()
  WHERE user_id = p_user_id;
  RETURN QUERY SELECT true, 0::bigint;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION submit_rate_limit_check(uuid, bigint, int)
  TO authenticated, service_role;

COMMIT;

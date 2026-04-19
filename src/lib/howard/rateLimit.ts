import type { SupabaseClient } from '@supabase/supabase-js';

// Howard rate limit — 20 requests per rolling minute per user.
// Persisted in aft_howard_rate_limit (migration 020) so the budget
// is consistent across Vercel instances. The `howard_rate_limit_check`
// RPC does check + record atomically behind SELECT FOR UPDATE.

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export async function checkRateLimit(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<RateLimitResult> {
  const { data, error } = await supabaseAdmin.rpc('howard_rate_limit_check', {
    p_user_id: userId,
    p_window_ms: WINDOW_MS,
    p_max_requests: MAX_REQUESTS,
  });

  // Fail open on an infrastructure hiccup — a broken rate-limit check
  // should not hard-stop the user from getting a reply. Logged for
  // observability.
  if (error || !data || data.length === 0) {
    if (error) console.warn('[rateLimit] RPC failed, allowing request:', error.message);
    return { allowed: true, retryAfterMs: 0 };
  }

  const row = data[0] as { allowed: boolean; retry_after_ms: number | string };
  // RPC contract is deterministic today, but guard anyway — if
  // retry_after_ms ever returns NaN / Infinity / a garbage string,
  // the `|| 0` fallback would silently tell the client to retry
  // immediately, defeating the back-off. isFinite rejects both NaN
  // and ±Infinity.
  const raw = Number(row.retry_after_ms);
  return {
    allowed: row.allowed,
    retryAfterMs: Number.isFinite(raw) && raw >= 0 ? raw : 0,
  };
}

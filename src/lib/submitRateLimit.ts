// =============================================================
// Rate limiter for companion-app submission endpoints.
// Backed by aft_submit_rate_limit + submit_rate_limit_check RPC
// (migration 044). Separate bucket from Howard so queue-flush
// traffic and Howard conversation traffic have independent
// budgets.
//
// 60 calls / rolling minute / user. Batch endpoint already caps
// 100 submissions per call, so this is primarily a defense
// against runaway clients (buggy retry loop, hostile script),
// not a rate-shaping mechanism for legitimate flushes.
// =============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export async function checkSubmitRateLimit(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<RateLimitResult> {
  const { data, error } = await supabaseAdmin.rpc('submit_rate_limit_check', {
    p_user_id: userId,
    p_window_ms: WINDOW_MS,
    p_max_requests: MAX_REQUESTS,
  });

  // Fail open on infrastructure hiccup — blocking a legitimate flush
  // because the rate-limit check itself broke would be worse than
  // letting the traffic through. Logged for observability.
  if (error || !data || data.length === 0) {
    if (error) console.warn('[submitRateLimit] RPC failed, allowing request:', error.message);
    return { allowed: true, retryAfterMs: 0 };
  }

  const row = data[0] as { allowed: boolean; retry_after_ms: number | string };
  const raw = Number(row.retry_after_ms);
  return {
    allowed: row.allowed,
    retryAfterMs: Number.isFinite(raw) && raw >= 0 ? raw : 0,
  };
}

// Email-sending budget — much tighter than data submission. A pilot
// scheduling MX or notifying squawks generates <5 emails/min in normal
// use, so 10/minute leaves headroom and still caps abuse at ~600/hour
// per account before Resend bills us. Reuses the same RPC bucket as
// `checkSubmitRateLimit` (different limit, same key) which is
// intentional: a user spamming submissions also burns email budget.
export async function checkEmailRateLimit(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<RateLimitResult> {
  const { data, error } = await supabaseAdmin.rpc('submit_rate_limit_check', {
    p_user_id: userId,
    p_window_ms: 60_000,
    p_max_requests: 10,
  });

  // Fail closed on the email path — a misbehaving caller paired with
  // a transient RPC failure becomes a Resend bill in minutes. The
  // submission path can fail open because batch capping limits worst
  // case; email has no per-call cap, so we err on the side of "no
  // emails sent" if the limiter itself can't speak.
  if (error || !data || data.length === 0) {
    if (error) console.warn('[emailRateLimit] RPC failed, blocking send:', error.message);
    return { allowed: false, retryAfterMs: 60_000 };
  }

  const row = data[0] as { allowed: boolean; retry_after_ms: number | string };
  const raw = Number(row.retry_after_ms);
  return {
    allowed: row.allowed,
    retryAfterMs: Number.isFinite(raw) && raw >= 0 ? raw : 0,
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';

// Howard rate limit — 20 requests per rolling minute per user.
// Persisted in aft_howard_rate_limit (migration 020) so the budget
// is consistent across Vercel instances. The `howard_rate_limit_check`
// RPC does check + record atomically behind SELECT FOR UPDATE.

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

// Circuit breaker for the rate-limit RPC. Default behaviour is
// fail-closed (Howard turns are paid LLM + tool calls; a broken
// rate-limit check is exactly when a bad actor can rack up a bill).
// But a sustained DB outage shouldn't lock every legitimate user out
// of Howard for the duration of the incident, so once we see a burst
// of consecutive RPC failures we open the breaker and start serving
// fail-open for a short cool-down window. We re-probe on the next
// request after the window — a single success closes the breaker.
const CB_FAILURE_THRESHOLD = 5;
const CB_FAILURE_WINDOW_MS = 30_000;
const CB_OPEN_DURATION_MS = 60_000;

const breakerState: {
  recentFailures: number[];
  openedAt: number | null;
} = { recentFailures: [], openedAt: null };

function recordFailure(now: number): void {
  breakerState.recentFailures.push(now);
  const cutoff = now - CB_FAILURE_WINDOW_MS;
  breakerState.recentFailures = breakerState.recentFailures.filter(t => t >= cutoff);
  if (
    breakerState.openedAt === null &&
    breakerState.recentFailures.length >= CB_FAILURE_THRESHOLD
  ) {
    breakerState.openedAt = now;
    console.error(
      `[rateLimit] circuit OPEN — ${breakerState.recentFailures.length} RPC failures in ${CB_FAILURE_WINDOW_MS}ms; failing-open for ${CB_OPEN_DURATION_MS}ms`,
    );
  }
}

function recordSuccess(): void {
  if (breakerState.openedAt !== null) {
    console.warn('[rateLimit] circuit CLOSED — RPC recovered');
  }
  breakerState.recentFailures = [];
  breakerState.openedAt = null;
}

function breakerIsOpen(now: number): boolean {
  if (breakerState.openedAt === null) return false;
  if (now - breakerState.openedAt >= CB_OPEN_DURATION_MS) {
    // Cool-down elapsed — let the next request probe the RPC.
    breakerState.openedAt = null;
    breakerState.recentFailures = [];
    return false;
  }
  return true;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export async function checkRateLimit(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<RateLimitResult> {
  const now = Date.now();
  if (breakerIsOpen(now)) {
    // Sustained outage — fail-open with logging so post-incident
    // audit can see Howard ran unmetered for this window.
    console.warn(`[rateLimit] UNMETERED user=${userId} (circuit open)`);
    return { allowed: true, retryAfterMs: 0 };
  }

  const { data, error } = await supabaseAdmin.rpc('howard_rate_limit_check', {
    p_user_id: userId,
    p_window_ms: WINDOW_MS,
    p_max_requests: MAX_REQUESTS,
  });

  // Fail CLOSED on a single infrastructure hiccup. Howard turns are
  // paid LLM calls (Anthropic Sonnet/Haiku) plus tool-call cost
  // (Tavily web search etc.) — a broken rate-limit check is exactly
  // the moment a misbehaving client can rack up real money in
  // seconds. We'd rather tell a legitimate user "try in a moment"
  // than absorb a runaway bill, so a transient RPC failure looks
  // like "limit exceeded". Sustained failure flips the circuit
  // breaker above and we fail-open instead.
  if (error || !data || data.length === 0) {
    if (error) console.warn('[rateLimit] RPC failed, blocking request:', error.message);
    recordFailure(now);
    return { allowed: false, retryAfterMs: 30_000 };
  }

  recordSuccess();

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

// Test-only: reset the module-level breaker state between tests.
export function __resetCircuitBreakerForTests(): void {
  breakerState.recentFailures = [];
  breakerState.openedAt = null;
}

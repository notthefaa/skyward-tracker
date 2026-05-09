import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';

/**
 * Howard rate-limit budget — 20 requests per rolling 60s per user.
 *
 * Exercises both surfaces:
 *   1. The `howard_rate_limit_check` RPC directly (SECURITY DEFINER,
 *      atomic via SELECT … FOR UPDATE — the only path that mutates
 *      aft_howard_rate_limit). Tested against the test project so any
 *      drift in the SQL function lands here, not as a paid Howard turn
 *      that gets rejected at runtime.
 *   2. The `/api/howard` POST 429 path — preload the budget so the
 *      check fails the request BEFORE any Anthropic call. Locks in the
 *      friendly error copy + status code.
 *
 * The circuit-breaker layer is module-local in-process state and is
 * exercised in `src/lib/howard/__tests__/rateLimit.test.ts`.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

async function clearBudget(userId: string) {
  await adminClient().from('aft_howard_rate_limit').delete().eq('user_id', userId);
}

async function preloadBudget(userId: string, count: number, ageMs: number = 1_000) {
  // count timestamps spaced `ageMs` apart, oldest first, all within
  // the rolling window so the RPC sees them as in-budget on the next call.
  const now = Date.now();
  const stride = Math.min(ageMs, Math.floor(WINDOW_MS / Math.max(count, 1)) - 100);
  const timestamps = Array.from({ length: count }, (_, i) => now - (count - i) * stride);
  const admin = adminClient();
  // Upsert so a residual row from a previous test doesn't 23505.
  const { error } = await admin
    .from('aft_howard_rate_limit')
    .upsert(
      { user_id: userId, timestamps, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) throw new Error(`preloadBudget: ${error.message}`);
}

test.describe('howard rate limit — RPC enforcement', () => {
  test('first call ever inserts a row and returns allowed=true', async ({ seededUser }) => {
    const admin = adminClient();
    await clearBudget(seededUser.userId);

    const { data, error } = await admin.rpc('howard_rate_limit_check', {
      p_user_id: seededUser.userId,
      p_window_ms: WINDOW_MS,
      p_max_requests: MAX_REQUESTS,
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data[0].allowed).toBe(true);
    expect(Number(data[0].retry_after_ms)).toBe(0);

    const { data: row } = await admin
      .from('aft_howard_rate_limit')
      .select('timestamps')
      .eq('user_id', seededUser.userId)
      .single();
    expect((row?.timestamps || []).length).toBe(1);

    await clearBudget(seededUser.userId);
  });

  test('19 timestamps in budget → 20th call still allowed', async ({ seededUser }) => {
    await clearBudget(seededUser.userId);
    await preloadBudget(seededUser.userId, 19);

    const admin = adminClient();
    const { data, error } = await admin.rpc('howard_rate_limit_check', {
      p_user_id: seededUser.userId,
      p_window_ms: WINDOW_MS,
      p_max_requests: MAX_REQUESTS,
    });
    expect(error).toBeNull();
    expect(data[0].allowed).toBe(true);
    expect(Number(data[0].retry_after_ms)).toBe(0);

    await clearBudget(seededUser.userId);
  });

  test('20 timestamps in budget → 21st call rejected with retry_after > 0', async ({ seededUser }) => {
    await clearBudget(seededUser.userId);
    await preloadBudget(seededUser.userId, MAX_REQUESTS, 1_000);

    const admin = adminClient();
    const { data, error } = await admin.rpc('howard_rate_limit_check', {
      p_user_id: seededUser.userId,
      p_window_ms: WINDOW_MS,
      p_max_requests: MAX_REQUESTS,
    });
    expect(error).toBeNull();
    expect(data[0].allowed).toBe(false);
    const retryAfter = Number(data[0].retry_after_ms);
    expect(retryAfter).toBeGreaterThan(0);
    // The oldest preloaded timestamp is ~MAX_REQUESTS seconds ago, so
    // retry_after_ms is roughly (60s - 20s) = ~40s. Generous bounds so
    // clock drift doesn't cause flakes.
    expect(retryAfter).toBeLessThanOrEqual(WINDOW_MS);

    await clearBudget(seededUser.userId);
  });

  test('stale timestamps outside the window get pruned and free up budget', async ({ seededUser }) => {
    await clearBudget(seededUser.userId);

    // 20 timestamps from 2 minutes ago — all stale, all should be pruned.
    const now = Date.now();
    const stale = Array.from({ length: 20 }, (_, i) => now - 120_000 - i * 100);
    const admin = adminClient();
    await admin
      .from('aft_howard_rate_limit')
      .upsert(
        { user_id: seededUser.userId, timestamps: stale, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );

    const { data, error } = await admin.rpc('howard_rate_limit_check', {
      p_user_id: seededUser.userId,
      p_window_ms: WINDOW_MS,
      p_max_requests: MAX_REQUESTS,
    });
    expect(error).toBeNull();
    expect(data[0].allowed).toBe(true);

    // Post-call, only the freshly-recorded timestamp survives — the
    // 20 stale ones were pruned before the count check.
    const { data: row } = await admin
      .from('aft_howard_rate_limit')
      .select('timestamps')
      .eq('user_id', seededUser.userId)
      .single();
    expect((row?.timestamps || []).length).toBe(1);

    await clearBudget(seededUser.userId);
  });

  test('concurrent calls serialize — exactly 20 land, 21st+ are rejected', async ({ seededUser }) => {
    // Fan out 25 RPC calls in parallel against an empty budget. The
    // FOR UPDATE lock should serialize them; the first 20 land, the
    // last 5 see allowed=false. Without the lock, two callers could
    // both read 19 timestamps and both insert a 20th — which the test
    // would catch as 21+ allowed=true responses.
    await clearBudget(seededUser.userId);

    const admin = adminClient();
    const calls = Array.from({ length: 25 }, () =>
      admin.rpc('howard_rate_limit_check', {
        p_user_id: seededUser.userId,
        p_window_ms: WINDOW_MS,
        p_max_requests: MAX_REQUESTS,
      })
    );
    const results = await Promise.all(calls);
    const allowed = results.filter(r => r.data?.[0]?.allowed === true).length;
    const rejected = results.filter(r => r.data?.[0]?.allowed === false).length;
    expect(allowed).toBe(MAX_REQUESTS);
    expect(rejected).toBe(25 - MAX_REQUESTS);

    await clearBudget(seededUser.userId);
  });
});

test.describe('howard rate limit — /api/howard 429 path', () => {
  test('over-budget user gets 429 + friendly retry copy without burning a Claude turn', async ({ seededUser, baseURL }) => {
    // Preload 20 fresh timestamps so the RPC at the top of /api/howard
    // POST returns allowed=false. The route MUST short-circuit with a
    // 429 BEFORE any Anthropic call — that's the whole point of the
    // gate (paid LLM + Tavily cost protection).
    await clearBudget(seededUser.userId);
    await preloadBudget(seededUser.userId, MAX_REQUESTS, 1_000);

    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/howard', {
      method: 'POST',
      body: JSON.stringify({
        message: 'This should never reach Claude.',
        currentTail: seededUser.tailNumber,
        timeZone: 'America/Los_Angeles',
      }),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/rate limit/i);
    expect(body.error).toMatch(/try again in \d+s/i);

    // No assistant message landed — the route exits before saving the
    // user's prompt or streaming a reply.
    const admin = adminClient();
    const { data: thread } = await admin
      .from('aft_howard_threads')
      .select('id')
      .eq('user_id', seededUser.userId)
      .maybeSingle();
    if (thread) {
      const { data: messages } = await admin
        .from('aft_howard_messages')
        .select('role, content')
        .eq('thread_id', thread.id);
      const fromThisAttempt = (messages || []).filter(m => m.content?.includes('This should never reach Claude'));
      expect(fromThisAttempt.length).toBe(0);
    }

    await clearBudget(seededUser.userId);
  });

  test('under-budget user is NOT 429 (sanity check on the gate)', async ({ seededUser, baseURL }) => {
    // Make sure the previous test's preload pattern isn't accidentally
    // turning the suite green — clear the budget and confirm the route
    // does NOT 429 a fresh user. We don't care what the actual reply
    // is (might stream OK, might error if the Anthropic key is absent
    // — that's a different story); just that it isn't 429.
    await clearBudget(seededUser.userId);

    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/howard', {
      method: 'POST',
      body: JSON.stringify({
        message: 'Just respond with the single word "ack".',
        currentTail: seededUser.tailNumber,
        timeZone: 'America/Los_Angeles',
      }),
    });
    expect(res.status).not.toBe(429);

    // Drain the SSE body if any so we don't leak the connection.
    try { await res.body?.cancel(); } catch { /* ignore */ }

    await clearBudget(seededUser.userId);
  });
});

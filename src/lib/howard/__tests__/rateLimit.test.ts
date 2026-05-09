import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit, __resetCircuitBreakerForTests } from '../rateLimit';

/**
 * Circuit-breaker behaviour for the Howard rate-limit RPC.
 *
 * The breaker state is module-scoped, so we reset it before each test.
 * The RPC itself is mocked via a minimal supabase-shaped object — we
 * only care about `.rpc(name, args)` here.
 *
 * The assertions match the constants in `rateLimit.ts`:
 *   - CB_FAILURE_THRESHOLD = 5
 *   - CB_FAILURE_WINDOW_MS = 30_000
 *   - CB_OPEN_DURATION_MS = 60_000
 * If those tune up/down later, this file is the canonical place to
 * update — the tuned values are observable via this test.
 */

type RpcResult = { data: any; error: any };

function makeSupabaseStub(rpcImpl: () => Promise<RpcResult>) {
  return {
    rpc: vi.fn().mockImplementation((..._args: any[]) => rpcImpl()),
  } as any;
}

const FAIL: RpcResult = { data: null, error: { message: 'simulated db outage' } };
const OK_ALLOWED: RpcResult = {
  data: [{ allowed: true, retry_after_ms: 0 }],
  error: null,
};
const OK_OVER: RpcResult = {
  data: [{ allowed: false, retry_after_ms: 12_000 }],
  error: null,
};

describe('checkRateLimit — circuit breaker', () => {
  beforeEach(() => {
    __resetCircuitBreakerForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('happy path: RPC returns allowed=true and breaker stays closed', async () => {
    const sb = makeSupabaseStub(() => Promise.resolve(OK_ALLOWED));
    const result = await checkRateLimit(sb, 'user-1');
    expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(sb.rpc).toHaveBeenCalledTimes(1);
  });

  it('happy path: RPC returns allowed=false → propagates retry_after_ms', async () => {
    const sb = makeSupabaseStub(() => Promise.resolve(OK_OVER));
    const result = await checkRateLimit(sb, 'user-1');
    expect(result).toEqual({ allowed: false, retryAfterMs: 12_000 });
  });

  it('single RPC failure fails CLOSED — under threshold, breaker stays closed', async () => {
    const sb = makeSupabaseStub(() => Promise.resolve(FAIL));
    const r1 = await checkRateLimit(sb, 'user-1');
    // Fail-closed default: when the budget check itself is broken, we
    // refuse the request rather than let an attacker rack up Anthropic
    // bills behind a malfunctioning gate.
    expect(r1.allowed).toBe(false);
    expect(r1.retryAfterMs).toBe(30_000);

    // Second call also fails closed (still under threshold of 5).
    const r2 = await checkRateLimit(sb, 'user-1');
    expect(r2.allowed).toBe(false);
    expect(sb.rpc).toHaveBeenCalledTimes(2);
  });

  it('5 consecutive failures → breaker opens; subsequent calls fail OPEN unmetered', async () => {
    const sb = makeSupabaseStub(() => Promise.resolve(FAIL));

    // First 5 failures fail-CLOSED (consume the threshold).
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit(sb, 'user-1');
      expect(r.allowed).toBe(false);
    }

    // 6th call: breaker is now open, should fail-OPEN (allowed=true)
    // WITHOUT calling the RPC — sustained outage shouldn't lock every
    // legitimate user out of Howard for the duration of the incident.
    const r6 = await checkRateLimit(sb, 'user-1');
    expect(r6.allowed).toBe(true);
    expect(r6.retryAfterMs).toBe(0);
    expect(sb.rpc).toHaveBeenCalledTimes(5);

    // Same for the next call — still in cool-down, breaker still open.
    const r7 = await checkRateLimit(sb, 'user-1');
    expect(r7.allowed).toBe(true);
    expect(sb.rpc).toHaveBeenCalledTimes(5);
  });

  it('after cool-down elapses, breaker probes the RPC; a single success closes it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T00:00:00.000Z'));

    let mode: 'fail' | 'ok' = 'fail';
    const sb = makeSupabaseStub(() =>
      Promise.resolve(mode === 'fail' ? FAIL : OK_ALLOWED),
    );

    // Trip the breaker.
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(sb, 'user-1');
    }
    expect(sb.rpc).toHaveBeenCalledTimes(5);

    // While breaker is open, RPC is bypassed.
    await checkRateLimit(sb, 'user-1');
    expect(sb.rpc).toHaveBeenCalledTimes(5);

    // Advance past CB_OPEN_DURATION_MS (60s).
    vi.advanceTimersByTime(60_001);

    // Next call probes the RPC. Underlying service has recovered.
    mode = 'ok';
    const probe = await checkRateLimit(sb, 'user-1');
    expect(probe.allowed).toBe(true);
    expect(sb.rpc).toHaveBeenCalledTimes(6);

    // Subsequent calls keep going through the (now-healthy) RPC.
    const next = await checkRateLimit(sb, 'user-1');
    expect(next.allowed).toBe(true);
    expect(sb.rpc).toHaveBeenCalledTimes(7);

    vi.useRealTimers();
  });

  it('failures spread across > 30s rolling window do NOT trip the breaker', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T00:00:00.000Z'));

    const sb = makeSupabaseStub(() => Promise.resolve(FAIL));

    // 4 failures, then advance 31s (past CB_FAILURE_WINDOW_MS), then
    // 4 more. Each window only sees 4 failures — under the 5 threshold.
    for (let i = 0; i < 4; i++) {
      await checkRateLimit(sb, 'user-1');
    }
    vi.advanceTimersByTime(31_000);
    for (let i = 0; i < 4; i++) {
      await checkRateLimit(sb, 'user-1');
    }

    // Breaker still closed → next failure call keeps fail-closed
    // (not the unmetered fail-open path).
    const after = await checkRateLimit(sb, 'user-1');
    expect(after.allowed).toBe(false);
    expect(after.retryAfterMs).toBe(30_000);
    expect(sb.rpc).toHaveBeenCalledTimes(9);

    vi.useRealTimers();
  });

  it('a successful RPC mid-streak resets the failure counter', async () => {
    let mode: 'fail' | 'ok' = 'fail';
    const sb = makeSupabaseStub(() =>
      Promise.resolve(mode === 'fail' ? FAIL : OK_ALLOWED),
    );

    // Soak up 4 failures.
    for (let i = 0; i < 4; i++) {
      await checkRateLimit(sb, 'user-1');
    }

    // One success — counter resets.
    mode = 'ok';
    await checkRateLimit(sb, 'user-1');

    // Now 4 more failures. Since the previous run was reset, this is
    // only 4 in the new streak — breaker stays closed.
    mode = 'fail';
    for (let i = 0; i < 4; i++) {
      const r = await checkRateLimit(sb, 'user-1');
      expect(r.allowed).toBe(false);
      expect(r.retryAfterMs).toBe(30_000);
    }
  });

  it('garbage retry_after_ms (NaN / Infinity) is clamped to 0 instead of breaking back-off', async () => {
    // The RPC contract is deterministic in practice, but the route
    // path uses Number-coercion + isFinite to defend against a future
    // schema or RPC change leaking NaN — without that, retryAfterMs
    // would be NaN and the client would retry immediately.
    const sb = makeSupabaseStub(() => Promise.resolve({
      data: [{ allowed: false, retry_after_ms: 'not-a-number' }],
      error: null,
    }));
    const r = await checkRateLimit(sb, 'user-1');
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBe(0);
  });
});

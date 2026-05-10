import { describe, it, expect } from 'vitest';
import { classifyRefreshOutcome } from '../refreshOutcome';

/**
 * `classifyRefreshOutcome` is the heart of the "Your session expired"
 * regression: a deadline-raced supabase.auth.refreshSession() used to
 * collapse "supabase couldn't answer in 15s" with "supabase says no
 * session", and the latter triggered a forced logout. The wrong
 * collapse logged users out spuriously after iOS resume / WKWebView
 * pool wedge / network blip.
 *
 * The helper now returns a discriminated union — the wrong-direction
 * risk is asymmetric:
 *   - false `timed_out` (when really resolved with no session) → we
 *     skip the unauthorized signal and the user keeps a dead session
 *     until the next refresh. Mild.
 *   - false `resolved+null` (when really timed out) → user gets
 *     spuriously logged out mid-session. Bad. Tests lock this
 *     direction hardest.
 */
describe('classifyRefreshOutcome', () => {
  it('resolved with a session → kind=resolved with session', async () => {
    const session = { access_token: 'tok', user: { id: 'u1' } };
    const out = await classifyRefreshOutcome(async () => session, 1000);
    expect(out).toEqual({ kind: 'resolved', session });
  });

  it('resolved with null → kind=resolved + session=null (truly expired)', async () => {
    const out = await classifyRefreshOutcome(async () => null, 1000);
    expect(out).toEqual({ kind: 'resolved', session: null });
  });

  it('refresh throws → kind=resolved + session=null (treat error as dead session)', async () => {
    const out = await classifyRefreshOutcome(async () => {
      throw new Error('supabase boom');
    }, 1000);
    expect(out).toEqual({ kind: 'resolved', session: null });
  });

  it('refresh hangs past timeoutMs → kind=timed_out (NOT treated as dead session)', async () => {
    // The hung refresh is the iOS-resume / WKWebView wedge case. The
    // helper must surface `timed_out` so the caller can throw a
    // transient error instead of logging the user out.
    const out = await classifyRefreshOutcome(
      () => new Promise<any>(() => { /* never */ }),
      50,
    );
    expect(out.kind).toBe('timed_out');
  });

  it('timed_out outcome is distinguishable from resolved+null at the type-discriminator level', async () => {
    // Lock the discriminator shape — if a future refactor collapses
    // them back, every consumer that branches on `kind` would
    // silently route to the wrong arm.
    const timedOut = await classifyRefreshOutcome(
      () => new Promise(() => {}),
      30,
    );
    const resolved = await classifyRefreshOutcome(async () => null, 30);
    expect(timedOut.kind).toBe('timed_out');
    expect(resolved.kind).toBe('resolved');
    // 'session' field exists on resolved, not on timed_out.
    expect('session' in resolved).toBe(true);
    expect('session' in timedOut).toBe(false);
  });

  it('timeoutMs <= 0 disables the race (await refresh directly)', async () => {
    const session = { access_token: 'tok' };
    const out = await classifyRefreshOutcome(async () => session, 0);
    expect(out).toEqual({ kind: 'resolved', session });
  });

  it('timeoutMs <= 0 + refresh throws → kind=resolved+null', async () => {
    const out = await classifyRefreshOutcome(async () => {
      throw new Error('boom');
    }, 0);
    expect(out).toEqual({ kind: 'resolved', session: null });
  });

  it('timeoutMs <= 0 + refresh hangs → really hangs (no race; documented behavior)', async () => {
    // Race a 100ms test-timeout against the hung refresh. If the
    // helper accidentally adds a deadline when timeoutMs<=0, this
    // would resolve early and fail the assertion.
    let didResolve = false;
    const racingPromise = classifyRefreshOutcome(
      () => new Promise(() => {}),
      0,
    ).then(() => { didResolve = true; });
    await new Promise(r => setTimeout(r, 100));
    expect(didResolve).toBe(false);
    void racingPromise;
  });

  it('refresh returns undefined → coerced to session=null', async () => {
    const out = await classifyRefreshOutcome(async () => undefined, 1000);
    expect(out).toEqual({ kind: 'resolved', session: null });
  });

  it('refresh resolves AFTER deadline → still returns timed_out', async () => {
    // The deadline winning is what matters for the user-facing
    // outcome; even if the refresh eventually resolves, we must have
    // already classified as timed_out so the caller can recover.
    let resolvedLate = false;
    const out = await classifyRefreshOutcome(
      () => new Promise(resolve => {
        setTimeout(() => {
          resolvedLate = true;
          resolve({ access_token: 'late-token' });
        }, 200);
      }),
      30,
    );
    expect(out.kind).toBe('timed_out');
    void resolvedLate; // silence unused
  });
});

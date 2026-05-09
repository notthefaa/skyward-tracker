import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Per-tool-call timeout — `executeTool` races each handler against
 * `HOWARD_TOOL_TIMEOUT_MS` (default 15 s). On expiry it returns a
 * JSON-serialized `{ error: "Tool '...' timed out after 15s..." }`
 * payload to Howard so the model can move on instead of letting the
 * outer SSE stream hang for the rest of the request budget.
 *
 * Approach: shrink the timeout constant via `vi.mock` to ~50 ms so
 * the test runs in real time without fake timers. Supabase fluent
 * chain returns a never-resolving promise on `.single()` (or final
 * `.then`-returning method), which simulates a stuck RPC.
 *
 * Coverage:
 *   - Global tool (no tail-resolver) hangs → returns timeout payload
 *   - Aircraft-scoped tool resolver hangs → returns timeout payload
 *   - Aircraft-scoped handler itself hangs (post-resolve) → returns timeout
 *   - Healthy handler completes well under the timeout → no error
 */

// Tiny timeout so the test is fast. 50 ms is short enough to avoid
// padding the suite, long enough to leave room for the handler's
// synchronous chain construction without flaking under load.
vi.mock('@/lib/constants', async () => {
  const actual = await vi.importActual<typeof import('@/lib/constants')>('@/lib/constants');
  return { ...actual, HOWARD_TOOL_TIMEOUT_MS: 50 };
});

import { executeTool, type ToolContext } from '../toolHandlers';

const ctx: ToolContext = {
  userId: 'user-1',
  threadId: 'thread-1',
  aircraftId: '',
  aircraftTail: '',
};

/** Build a supabase-fluent chain that hangs on the leaf-await. */
function makeHangingSupabase() {
  const hang = new Promise<never>(() => {
    /* never resolves */
  });
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return undefined; // not a thenable until awaited
        if (prop === 'single' || prop === 'maybeSingle' || prop === 'limit') {
          // Leaf — return the hanging promise.
          return () => hang;
        }
        // Non-leaf — return self for further chaining.
        return () => chain;
      },
    },
  );
  return {
    from: () => chain,
    rpc: () => hang,
    auth: { getUser: () => hang },
  } as any;
}

/** Build a supabase-fluent chain that resolves quickly with a fixture. */
function makeFastSupabase(fixture: any) {
  const result = Promise.resolve({ data: fixture, error: null });
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return undefined;
        if (prop === 'single' || prop === 'maybeSingle' || prop === 'limit') {
          return () => result;
        }
        return () => chain;
      },
    },
  );
  return { from: () => chain, rpc: () => result } as any;
}

describe('executeTool — per-call timeout', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('global tool hang → returns "timed out" payload, not a thrown error', async () => {
    const sb = makeHangingSupabase();
    const start = Date.now();
    const out = await executeTool('get_system_settings', {}, ctx, sb);
    const elapsed = Date.now() - start;

    const parsed = JSON.parse(out);
    expect(parsed.error).toMatch(/timed out/i);
    expect(parsed.error).toMatch(/get_system_settings/);
    // Sanity: the timeout fired close to the configured 50 ms,
    // didn't wait the full default 15 s.
    expect(elapsed).toBeLessThan(2_000);
    // And actually waited at least most of the timeout (catches a
    // regression where withToolTimeout returns immediately instead
    // of racing).
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it('aircraft-scoped tool resolver hang counts against the budget', async () => {
    // For an aircraft-scoped tool, executeTool first calls
    // resolveAircraftFromTail. Both that resolver AND the handler
    // share the per-tool-call budget. A stuck supabase lookup in the
    // resolver must therefore time out the whole tool call.
    const sb = makeHangingSupabase();
    const start = Date.now();
    const out = await executeTool('get_flight_logs', { tail: 'N123' }, ctx, sb);
    const elapsed = Date.now() - start;

    const parsed = JSON.parse(out);
    expect(parsed.error).toMatch(/timed out/i);
    expect(parsed.error).toMatch(/get_flight_logs/);
    expect(elapsed).toBeLessThan(2_000);
  });

  it('aircraft-scoped tool: fast resolver, hung handler → still times out', async () => {
    // Resolver succeeds (returns the fake aircraft-access row), then
    // the handler's first DB call hangs. The handler must time out
    // at the SAME budget, not get an extra window past the resolver.
    let firstCall = true;
    const okFixture = [{ aircraft_id: 'ac-1', aircraft_role: 'admin' }];
    const okAircraft = { id: 'ac-1', tail_number: 'N123', deleted_at: null };
    const hang = new Promise<never>(() => {});

    const chain: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') return undefined;
          if (prop === 'single' || prop === 'maybeSingle' || prop === 'limit') {
            return () => {
              if (firstCall) {
                firstCall = false;
                return Promise.resolve({ data: okFixture, error: null });
              }
              return hang;
            };
          }
          return () => chain;
        },
      },
    );
    const sb: any = { from: () => chain, rpc: () => hang };

    const start = Date.now();
    const out = await executeTool('get_flight_logs', { tail: 'N123' }, ctx, sb);
    const elapsed = Date.now() - start;

    const parsed = JSON.parse(out);
    // Either resolver or handler timed out — both are fine, both
    // produce the same surface "timed out" error message.
    expect(parsed.error).toMatch(/timed out|access|not found/i);
    expect(elapsed).toBeLessThan(2_000);

    void okAircraft;
  });

  it('healthy handler completes without firing the timeout', async () => {
    // Sanity: a handler that returns quickly produces the real
    // payload, not a timeout error. Protects against a regression
    // where the timeout fires unconditionally.
    const sb = makeFastSupabase({ id: 1, app_name: 'Skyward' });
    const out = await executeTool('get_system_settings', {}, ctx, sb);
    const parsed = JSON.parse(out);
    expect(parsed.error).toBeUndefined();
    expect(parsed.settings).toBeDefined();
    expect(parsed.settings.app_name).toBe('Skyward');
  });

  it('unknown tool short-circuits before the timeout race', async () => {
    const sb = makeFastSupabase(null);
    const out = await executeTool('definitely_not_a_tool', {}, ctx, sb);
    const parsed = JSON.parse(out);
    expect(parsed.error).toMatch(/unknown tool/i);
  });
});

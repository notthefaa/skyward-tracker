// =============================================================
// Pure helper for the deadline-raced session-refresh classifier.
//
// Lives in its own file (not authFetch.ts) so the unit suite can
// import it without dragging in `lib/supabase` — which requires
// runtime env vars and won't construct in vitest's environment.
//
// Bug history: collapsing "supabase couldn't refresh in 15s" with
// "supabase says no session" used to spuriously sign users out
// after iOS resume / WKWebView pool wedge. The discriminated
// union here is the contract that prevents that collapse — see
// `src/lib/__tests__/authFetchRefresh.test.ts`.
// =============================================================

/**
 * Result of a deadline-raced session refresh. The discriminator
 * matters: a `timed_out` outcome must NOT be treated as "session
 * expired" — we just couldn't ask supabase in time.
 */
export type RefreshOutcome =
  | { kind: 'resolved'; session: any | null }
  | { kind: 'timed_out' };

/**
 * Race a session-refresh attempt against `timeoutMs`. Pure shape so
 * the unit suite can validate the discriminator without spinning up
 * the supabase client. `refresh()` is invoked exactly once; thrown
 * errors map to `{kind:'resolved', session:null}` (treated as
 * "session is dead" — same as the supabase contract for
 * refresh-with-no-session).
 *
 *   - timeoutMs > 0: race against a deadline; on miss returns
 *     `{kind:'timed_out'}`. Caller should treat as transient.
 *   - timeoutMs <= 0: no race; await the promise directly.
 */
export async function classifyRefreshOutcome(
  refresh: () => Promise<any | null>,
  timeoutMs: number,
): Promise<RefreshOutcome> {
  if (timeoutMs <= 0) {
    try {
      const session = await refresh();
      return { kind: 'resolved', session: session ?? null };
    } catch {
      return { kind: 'resolved', session: null };
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<RefreshOutcome>(resolve => {
    timer = setTimeout(() => resolve({ kind: 'timed_out' }), timeoutMs);
  });
  const refreshPromise: Promise<RefreshOutcome> = refresh()
    .then(session => ({ kind: 'resolved' as const, session: session ?? null }))
    .catch(() => ({ kind: 'resolved' as const, session: null }));
  try {
    return await Promise.race([refreshPromise, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

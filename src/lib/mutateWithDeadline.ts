// =============================================================
// mutateWithDeadline — bounded SWR revalidation
// =============================================================
// `await mutate()` after a write usually completes in <500ms, but
// on iOS the underlying revalidation fetch can be suspended mid-
// flight when the PWA backgrounds. The SWR FETCH[key] map keeps
// the dead promise pinned (see feedback_swr_filter_mutate_gotcha),
// so a fresh `await mutate()` re-attaches to it and never resolves.
//
// Pre-fix symptom: a user clicks "Confirm Resolve" on a squawk, the
// PUT lands, but `await mutate()` hangs and the function never
// reaches its `finally` block. `isSubmitting` stays true, the
// "Resolving..." button stays disabled, and the modal never closes.
// "Get hung on resolving" — a real field report.
//
// Post-fix: bound the wait at 5s. If mutate completes in time the
// caller observes fresh data. If it doesn't, we stop blocking and
// let SWR finish in the background; the cache settles whenever the
// dead fetch resolves (or gets cleared on next visibility change /
// pull-refresh / version probe).
//
// Pass any thenable that resolves on revalidation success — typical
// usage is `await mutateWithDeadline(mutate())`.

const DEFAULT_DEADLINE_MS = 5_000;

export async function mutateWithDeadline<T>(
  mutatePromise: Promise<T> | T,
  deadlineMs: number = DEFAULT_DEADLINE_MS,
): Promise<void> {
  // Wrap so a sync return doesn't crash Promise.race.
  const p = Promise.resolve(mutatePromise);
  await Promise.race([
    p.catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, deadlineMs)),
  ]);
}

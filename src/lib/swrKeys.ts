// =============================================================
// SWR key factory — one place to construct every aircraft-scoped
// SWR cache key. Every aircraft-scoped fetch should use a key from
// here so the refresh-matcher in useFleetData.refreshForAircraft
// has a predictable shape to match against.
//
// String keys (not tuple keys) — that's the existing convention
// across the codebase, and switching to tuples would require
// updating ~30 useSWR call sites. This factory enforces the format
// without a breaking refactor.
//
// All per-aircraft keys follow: `<domain>-<aircraftId>[-<extra>]`.
// The aircraftId is always a UUID, which means refreshForAircraft
// can match "aircraftId appearing between delimiters" safely —
// UUIDs don't overlap in practice.
// =============================================================

export const swrKeys = {
  // Summary tab sub-cards
  summaryMx:             (id: string) => `summary-mx-${id}`,
  summarySquawks:        (id: string) => `summary-squawks-${id}`,
  summaryNote:           (id: string) => `summary-note-${id}`,
  summaryFlight:         (id: string) => `summary-flight-${id}`,
  summaryReservations:   (id: string) => `summary-reservations-${id}`,
  summaryCurrentStatus:  (id: string) => `summary-current-status-${id}`,
  summaryCrew:           (id: string) => `summary-crew-${id}`,

  // Per-aircraft tabs
  ads:                   (id: string) => `ads-${id}`,
  equipment:             (id: string, includeRemoved: boolean) => `equipment-${id}-${includeRemoved}`,
  notes:                 (id: string) => `notes-${id}`,
  mxItems:               (id: string) => `mx-${id}`,
  mxEvents:              (id: string) => `mx-events-${id}`,
  squawks:               (id: string) => `squawks-${id}`,
  times:                 (id: string, page: number) => `times-${id}-${page}`,
  vor:                   (id: string, page: number) => `vor-${id}-${page}`,
  vorLatest:             (id: string) => `vor-latest-${id}`,
  tire:                  (id: string, page: number) => `tire-${id}-${page}`,
  oil:                   (id: string, page: number) => `oil-${id}-${page}`,
  oilChart:              (id: string) => `oil-chart-${id}`,
  // Latest oil log where oil_added > 0. Feeds the Checks-tab oil dial
  // ("hours since last add"). OilTab invalidates this on every write.
  oilLastAdded:          (id: string) => `oil-last-added-${id}`,
  docs:                  (id: string) => `docs-${id}`,
  crew:                  (id: string) => `crew-${id}`,

  // Calendar
  calendar:              (id: string, year: number, month: number) => `calendar-${id}-${year}-${month}`,
  calDash:               (id: string) => `cal-dash-${id}`,
  calHours:              (id: string, fromMs: number, toMs: number) => `cal-hours-${id}-${fromMs}-${toMs}`,

  // Fleet-wide (not per-aircraft)
  fleet:                 (count: number, idsCsv: string) => `fleet-${count}-${idsCsv}`,
  fleetSchedule:         (idsCsv: string, year: number, month: number) => `fleet-schedule-${idsCsv}-${year}-${month}`,

  // User / thread-scoped (not aircraft-scoped)
  howardUser:            (userId: string) => `howard-user-${userId}`,
  howardActions:         (threadId: string) => `howard-actions-${threadId}`,
} as const;

/**
 * Build the matcher SWR's global `mutate` needs for invalidating
 * every cached entry that belongs to a specific aircraft.
 *
 * The regex anchors the aircraftId between word-boundary delimiters
 * (`-`, `_`, `/`, string end) so an unrelated string that merely
 * contains the UUID substring can't get swept up. UUIDs don't share
 * substrings in practice, so this is defense-in-depth rather than
 * a real-world bug fix — but it makes the invalidation contract
 * precise instead of just probably-correct.
 */
export function matchesAircraft(aircraftId: string) {
  const pattern = new RegExp(`(^|[-_/])${aircraftId}(?=[-_/]|$)`);
  return (key: unknown) => typeof key === 'string' && pattern.test(key);
}

/**
 * Canonical list of every aircraft-scoped SWR key the app uses, with
 * default values for keys that take pagination / month / boolean args.
 *
 * AppShell's tail-switch + resume + pull-refresh handlers run a walk
 * of the SWR cache provider's `keys()` and `globalMutate()` each match
 * to clear pinned-but-dead `FETCH[key]` / `PRELOAD[key]` entries (the
 * iOS-suspended-promise trap). That walk only sees keys SWR has
 * already initialized state for. A key whose hook mounted in this
 * session and whose first fetch suspended *before* SWR's initial
 * cache.set landed survives the walk — and dedupes any future fetch
 * against a zombie promise. Walking this canonical list in addition
 * to `cache.keys()` clears the FETCH map for those keys too.
 *
 * If you add a new aircraft-scoped key to `swrKeys`, add it here too.
 * The unit test in `__tests__/swrKeys.test.ts` will fail if the list
 * size doesn't match the canonical-key count, catching the omission.
 */
export function allForAircraft(aircraftId: string): string[] {
  const id = aircraftId;
  const now = new Date();
  return [
    // Summary sub-cards
    swrKeys.summaryMx(id),
    swrKeys.summarySquawks(id),
    swrKeys.summaryNote(id),
    swrKeys.summaryFlight(id),
    swrKeys.summaryReservations(id),
    swrKeys.summaryCurrentStatus(id),
    swrKeys.summaryCrew(id),
    // Per-aircraft tabs
    swrKeys.ads(id),
    swrKeys.notes(id),
    swrKeys.mxItems(id),
    swrKeys.mxEvents(id),
    swrKeys.squawks(id),
    swrKeys.vorLatest(id),
    swrKeys.oilChart(id),
    swrKeys.oilLastAdded(id),
    swrKeys.docs(id),
    swrKeys.crew(id),
    swrKeys.calDash(id),
    // Equipment has a boolean variant — both states get a tab visit.
    swrKeys.equipment(id, false),
    swrKeys.equipment(id, true),
    // Pagination variants — page 1 is the only state mounted on a
    // fresh tail switch / resume. Subsequent pages live in the cache
    // walk if the user paginated last time on this aircraft.
    swrKeys.times(id, 1),
    swrKeys.vor(id, 1),
    swrKeys.tire(id, 1),
    swrKeys.oil(id, 1),
    // Calendar key folds in year + month. Clear the *current* month
    // canonically; the cache walk handles any other months the pilot
    // already opened in this session.
    swrKeys.calendar(id, now.getFullYear(), now.getMonth()),
  ];
}

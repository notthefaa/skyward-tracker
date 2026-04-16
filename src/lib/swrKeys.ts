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

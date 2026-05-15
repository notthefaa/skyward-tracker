/**
 * Normalize the airframe + engine "setup" meter readings collected
 * during aircraft create/edit, with one semantic coerce:
 *
 *   When the pilot has only one meter (piston tach-only — the
 *   most common case) they sometimes type "0" in the airframe
 *   field instead of leaving it blank — "no Hobbs meter, so 0
 *   Hobbs hours" reads as a reasonable interpretation of the
 *   label. The same can happen when a pilot describes their setup
 *   to Howard ("no hobbs, tach is 1231.3") and Claude lowers that
 *   into `setup_hobbs: 0` / `setup_tach: 1231.3`.
 *
 *   parseFloat("0") lands as numeric 0 though, and downstream
 *   log_flight_atomic's first-flight sanity fallback reads
 *   setup_hobbs=0 as a real baseline. coalesce then anchors
 *   the 24hr delta check against 0 instead of the meter the
 *   aircraft actually has (setup_tach), and the pilot's first
 *   flight log gets rejected as "implausible delta".
 *
 *   Migration 074 added a `nullif(setup_*, 0)` defense at the
 *   read side. This helper covers the write side: a solo
 *   airframe-0 with a non-zero engine reading gets coerced to
 *   null, so the data layer reflects "no meter" rather than
 *   "meter reads 0".
 *
 *   Genuine brand-new aircraft (both meters legitimately at 0)
 *   keep their 0 — the engine value isn't positive, so the
 *   coerce doesn't fire.
 *
 * Two entry points:
 *   - parseSetupMeters: form-side; takes raw string inputs from
 *     AircraftForm (PilotOnboarding, AircraftModal create+edit).
 *   - normalizeSetupMeters: tool-side; takes already-parsed numbers
 *     (Howard's propose_onboarding_setup executor).
 */

export function normalizeSetupMeters(
  setupAirframe: number | null,
  setupEngine: number | null,
): { setupAirframe: number | null; setupEngine: number | null } {
  if (setupAirframe === 0 && setupEngine != null && setupEngine > 0) {
    return { setupAirframe: null, setupEngine };
  }
  return { setupAirframe, setupEngine };
}

export function parseSetupMeters(
  airframeTimeRaw: string,
  engineTimeRaw: string,
): { setupAirframe: number | null; setupEngine: number | null } {
  const setupEngine = engineTimeRaw !== '' ? parseFloat(engineTimeRaw) : null;
  const setupAirframe = airframeTimeRaw !== '' ? parseFloat(airframeTimeRaw) : null;
  return normalizeSetupMeters(setupAirframe, setupEngine);
}

/**
 * Display formatting for aircraft make + model.
 *
 * Why this exists: the schema overloads `aircraft_type` with the
 * model string (legacy column, NOT NULL, predates the make/model
 * split). AircraftForm / AircraftModal / PilotOnboarding all write
 * `aircraft_type = model` (just the model name); Howard's onboarding
 * executor follows the same convention. The `make` lives in a
 * separate column.
 *
 * Display sites previously rendered only `aircraft_type` ("172N")
 * and dropped the make ("Cessna"). This helper folds them back
 * together so FleetSummary / AppHeader / SummaryTab / emails / PDFs
 * all read "Cessna 172N" the way a pilot expects.
 *
 * Handles three flavors of input row:
 *   1. Modern (make + model + aircraft_type all set, common)
 *   2. Form-saved (make + aircraft_type, model column null)
 *   3. Legacy (aircraft_type only — make column null pre-split)
 *
 * All three produce the same visible string when possible.
 */
export function formatAircraftType(
  aircraft: { make?: string | null; aircraft_type?: string | null; model?: string | null } | null | undefined,
): string {
  if (!aircraft) return '';
  const make = (aircraft.make || '').trim();
  // Prefer `model` when present (Howard writes it); fall back to
  // `aircraft_type` (which the form writes). Legacy rows may have
  // a make-prefixed aircraft_type like "Cessna 172N" — don't
  // double-prefix in that case.
  const model = (aircraft.model || aircraft.aircraft_type || '').trim();
  if (!make) return model;
  if (!model) return make;
  // Already prefixed (legacy row where aircraft_type == "make model")
  // — render the original string verbatim so we don't end up with
  // "Cessna Cessna 172N".
  if (model.toLowerCase().startsWith(make.toLowerCase() + ' ')) return model;
  return `${make} ${model}`;
}

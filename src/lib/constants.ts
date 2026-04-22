// =============================================================
// SHARED CONSTANTS — App-wide configuration values
// =============================================================

// ─── File Upload Limits ───

/** Maximum file upload size in bytes (10MB) */
export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

/** Maximum file upload size for display purposes */
export const MAX_UPLOAD_SIZE_LABEL = '10MB';

/** Validate a file against the upload size limit. Returns an error message or null. */
export function validateFileSize(file: File): string | null {
  if (file.size > MAX_UPLOAD_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return `"${file.name}" is ${sizeMB}MB — that's over the ${MAX_UPLOAD_SIZE_LABEL} limit. Use a smaller file.`;
  }
  return null;
}

/** Validate an array of files. Returns the first error message or null. */
export function validateFileSizes(files: File[]): string | null {
  for (const file of files) {
    const error = validateFileSize(file);
    if (error) return error;
  }
  return null;
}

// ─── Time Windows ───

/** Days of flight data used for burn rate / predictive calculations */
export const FLIGHT_DATA_LOOKBACK_DAYS = 180;

/** Days before a completed service portal link expires */
export const PORTAL_EXPIRY_DAYS = 7;

/** Aggregation window for bundling MX items into a single draft */
export const MX_AGGREGATION_WINDOW_DAYS = 30;

/** Days of old read receipts to keep before purging */
export const READ_RECEIPT_RETENTION_DAYS = 30;

/** Months of old notes to keep before purging */
export const NOTE_RETENTION_MONTHS = 6;

/** Years of old flight logs to keep before purging */
export const FLIGHT_LOG_RETENTION_YEARS = 5;

/** Months of completed MX events to keep before purging */
export const MX_COMPLETE_RETENTION_MONTHS = 12;

/** Months of cancelled MX events to keep before purging */
export const MX_CANCELLED_RETENTION_MONTHS = 3;

// ─── Rate Limiting ───

/** Minimum minutes between re-invite requests for the same email */
export const RESEND_INVITE_COOLDOWN_MINUTES = 5;

// ─── Realtime / UX ───

/** Debounce time (ms) for realtime aircraft-scoped refreshes */
export const REALTIME_DEBOUNCE_MS = 1500;

/** Network timeout (ms) before showing the connection error screen */
export const NETWORK_TIMEOUT_MS = 12000;

// ─── Fuel Conversion ───

/** Weight per gallon for Jet-A fuel (lbs) */
export const JET_A_WEIGHT_PER_GALLON = 6.7;

/** Weight per gallon for AvGas fuel (lbs) */
export const AVGAS_WEIGHT_PER_GALLON = 6.0;

/** Returns the fuel weight per gallon based on engine type */
export function getFuelWeightPerGallon(engineType: 'Piston' | 'Turbine' | string): number {
  return engineType === 'Turbine' ? JET_A_WEIGHT_PER_GALLON : AVGAS_WEIGHT_PER_GALLON;
}

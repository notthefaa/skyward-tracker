// =============================================================
// SHARED CONSTANTS — App-wide configuration values
// =============================================================

/** Maximum file upload size in bytes (10MB) */
export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

/** Maximum file upload size for display purposes */
export const MAX_UPLOAD_SIZE_LABEL = '10MB';

/** Validate a file against the upload size limit. Returns an error message or null. */
export function validateFileSize(file: File): string | null {
  if (file.size > MAX_UPLOAD_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return `"${file.name}" is ${sizeMB}MB which exceeds the ${MAX_UPLOAD_SIZE_LABEL} limit. Please use a smaller file.`;
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

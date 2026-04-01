// =============================================================
// HTML SANITIZATION — Escape user-provided strings before
// inserting them into HTML email templates or any HTML context.
//
// Usage:
//   import { escapeHtml } from '@/lib/sanitize';
//   const safe = escapeHtml(userInput);
// =============================================================

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const ESCAPE_REGEX = /[&<>"']/g;

/**
 * Escapes HTML special characters in a string to prevent HTML injection.
 * Safe to use in email templates, HTML attributes, and text content.
 *
 * Returns an empty string if the input is null/undefined.
 */
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str.replace(ESCAPE_REGEX, (char) => ESCAPE_MAP[char] || char);
}

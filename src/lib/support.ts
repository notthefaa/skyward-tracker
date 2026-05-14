// =============================================================
// Support email helper.
//
// One place defines the recipient, subject, and the prefilled body
// shape so every "Email Support" entry point (error boundary, global
// error boundary, Settings) stays in sync.
//
// For error contexts we ALSO copy the full diagnostic to the user's
// clipboard before opening the mailto — some mail clients silently
// truncate long mailto bodies and we don't want to lose the stack.
// =============================================================

export const SUPPORT_EMAIL = 'alex@skywardsociety.com';
export const SUPPORT_SUBJECT = 'Skyward Tracker: A User Has Experienced An Issue';

export interface SupportEmailContext {
  error?: { message?: string; stack?: string; digest?: string };
}

// Mailto URLs round-trip through OS handlers that historically cap
// around 2000 chars. Truncate the long fields so the link still opens
// reliably — the clipboard fallback below preserves the full payload.
const STACK_LIMIT = 1500;
const MESSAGE_LIMIT = 500;

function truncate(value: string | undefined, limit: number): string {
  if (!value) return 'N/A';
  return value.length > limit ? `${value.slice(0, limit)}\n…(truncated)` : value;
}

export function buildSupportEmailBody(ctx: SupportEmailContext = {}): string {
  const ts = new Date().toISOString();
  const url = typeof window !== 'undefined' ? window.location.href : 'N/A';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A';

  if (ctx.error) {
    return [
      'Hi Alex,',
      '',
      'I ran into an issue using Skyward Tracker. Details below.',
      '',
      'What I was trying to do:',
      '[describe what you were doing when this happened]',
      '',
      '---',
      'Diagnostic info (auto-filled — please leave for support):',
      '',
      `Time: ${ts}`,
      `URL: ${url}`,
      `User-Agent: ${ua}`,
      `Error digest: ${ctx.error.digest || 'N/A'}`,
      '',
      'Error message:',
      truncate(ctx.error.message, MESSAGE_LIMIT),
      '',
      'Stack:',
      truncate(ctx.error.stack, STACK_LIMIT),
    ].join('\n');
  }

  return [
    'Hi Alex,',
    '',
    'I have a question or feedback about Skyward Tracker.',
    '',
    "What I'd like to share:",
    '[your message here]',
    '',
    '---',
    'Diagnostic info (auto-filled):',
    '',
    `Time: ${ts}`,
    `URL: ${url}`,
    `User-Agent: ${ua}`,
  ].join('\n');
}

export function buildSupportMailto(ctx: SupportEmailContext = {}): string {
  const subject = encodeURIComponent(SUPPORT_SUBJECT);
  const body = encodeURIComponent(buildSupportEmailBody(ctx));
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}

/**
 * Trigger the user's mail client. For error contexts, also tries to
 * copy the full body to the clipboard first so the user can paste it
 * back in if the mail client truncated the mailto body.
 *
 * Returns `copiedToClipboard` so the caller can show a small inline
 * confirmation. Never throws — clipboard + navigation failures are
 * non-fatal because the user can always email manually.
 */
export async function openSupportEmail(
  ctx: SupportEmailContext = {},
): Promise<{ copiedToClipboard: boolean }> {
  let copiedToClipboard = false;

  if (
    ctx.error
    && typeof navigator !== 'undefined'
    && navigator.clipboard
    && typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(buildSupportEmailBody(ctx));
      copiedToClipboard = true;
    } catch {
      // Clipboard API fails inside iframes, on http (non-https), and
      // when the document lacks focus. The mailto link below still
      // ships whatever fits, so the failure is recoverable.
    }
  }

  if (typeof window !== 'undefined') {
    window.location.href = buildSupportMailto(ctx);
  }

  return { copiedToClipboard };
}

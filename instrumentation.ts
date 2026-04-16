// Next.js instrumentation hook — loads the right Sentry config per runtime.
// Runs exactly once per process, before any route code.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Forwards App Router render errors to Sentry. No-op when DSN is absent.
export async function onRequestError(
  err: unknown,
  request: Parameters<typeof import('@sentry/nextjs').captureRequestError>[1],
  context: Parameters<typeof import('@sentry/nextjs').captureRequestError>[2],
) {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(err, request, context);
}

// Request-ID + structured error logging.
//
// Every API route extracts a request ID at the start of the request
// (either from an upstream `x-request-id` header — Vercel sets one
// automatically on every invocation — or freshly generated). That ID
// threads through console.error output, the response body on failure,
// and Sentry tags so a user-reported error can be traced back to the
// specific invocation without grep-guessing by timestamp.

export function getRequestId(req: Request): string {
  return req.headers.get('x-request-id')
    || req.headers.get('x-vercel-id')
    || crypto.randomUUID();
}

interface ErrorContext {
  requestId?: string;
  route?: string;
  userId?: string;
  // Free-form tags for extra breadcrumbs — kept small; not for full payloads.
  extra?: Record<string, string | number | boolean>;
}

/**
 * Log an error with a request-scoped correlation ID. Forwards to Sentry
 * when SENTRY_DSN is set; otherwise just console.error with a parseable
 * prefix.
 */
export function logError(message: string, error: unknown, ctx?: ErrorContext): void {
  const tag = ctx?.requestId ? `[${ctx.requestId}]` : '';
  const route = ctx?.route ? ` ${ctx.route}` : '';
  console.error(`${tag}${route} ${message}`, error);

  if (!process.env.SENTRY_DSN) return;
  // Dynamic import so the Sentry SDK isn't pulled into runtime graphs
  // that don't need it (and so we don't fail at import in environments
  // without the package). Fire-and-forget is fine — we never want a
  // logger error to mask the original.
  import('@sentry/nextjs').then(Sentry => {
    Sentry.withScope(scope => {
      if (ctx?.requestId) scope.setTag('request_id', ctx.requestId);
      if (ctx?.route) scope.setTag('route', ctx.route);
      if (ctx?.userId) scope.setUser({ id: ctx.userId });
      if (ctx?.extra) {
        for (const [k, v] of Object.entries(ctx.extra)) scope.setExtra(k, v);
      }
      if (error instanceof Error) Sentry.captureException(error);
      else Sentry.captureMessage(`${message}: ${String(error)}`, 'error');
    });
  }).catch(() => { /* Sentry offline — already logged via console.error */ });
}

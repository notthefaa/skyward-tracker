import * as Sentry from '@sentry/nextjs';

// Server-side Sentry init. Gracefully no-ops when SENTRY_DSN is absent
// — no init call means Sentry.captureException etc. do nothing.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0.1,
  });
}

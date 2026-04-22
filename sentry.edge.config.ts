import * as Sentry from '@sentry/nextjs';

// Edge-runtime Sentry init (middleware, edge routes). Gracefully no-ops
// when SENTRY_DSN is absent.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0.1,
  });
}

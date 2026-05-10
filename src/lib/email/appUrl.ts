/**
 * Resolve the user-facing app URL for email CTAs.
 *
 * Why this exists: cron + Vercel route handlers see `req.url` as the
 * raw deployment URL (e.g. `skyward-tracker-xyz.vercel.app`) rather
 * than the production domain `track.skywardsociety.com`, because the
 * production domain is a 301 redirect, not a proxy. Email recipients
 * who tap a CTA on the deployment URL land on the wrong host (and
 * see a stale preview build, or — for hard-coded routes — a 404).
 *
 * Squawk-notify and note-notify always preferred `NEXT_PUBLIC_MAIN_APP_URL`
 * over `req.url.origin`. This helper applies that same precedence
 * everywhere CTAs are composed (cron, mx-events, reservations).
 *
 * Set `NEXT_PUBLIC_MAIN_APP_URL=https://track.skywardsociety.com` in
 * Vercel env to enable. Falls back to `req.url.origin` when unset so
 * preview deployments / local dev don't have to set it.
 */
export function getAppUrl(req?: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_MAIN_APP_URL?.replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  if (req) return new URL(req.url).origin;
  return '';
}

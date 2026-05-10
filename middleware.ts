// =============================================================
// Next.js middleware — keeps the Supabase auth cookie fresh on
// every request that reaches the app.
//
// Without this middleware, the access_token cookie expires after
// ~1 hour and the next API call returns 401 even though the user
// "looks" signed in. The middleware reads the cookie, lets
// @supabase/ssr decide whether to refresh, and writes any rotated
// tokens onto the response so the browser stores them.
//
// Cost: one supabase.auth.getUser() call per matched request — but
// that's the same cost we already paid in `requireAuth` per API
// hit, just centralized. The big win is that the BROWSER never
// has to call getSession() to attach a Bearer (cookies ride along
// automatically), so the iOS GoTrue-lock pressure that produced
// spurious "Session expired" toasts is gone.
//
// Matcher excludes:
//   - static assets (Next.js internals, images, fonts)
//   - public asset routes that don't need auth
//   - paths handled by their own auth (cron has CRON_SECRET, mechanic
//     portal uses access_token query param, etc.)
//
// Anything not excluded gets the cookie-refresh treatment, which is
// fine — unauthenticated routes just see no cookie and proceed
// normally. The middleware doesn't enforce auth, it just keeps
// the cookie warm.
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createMiddlewareSupabase } from './src/lib/supabase/server';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next({
    request: { headers: req.headers },
  });

  const supabase = createMiddlewareSupabase(req, res);

  // Touching getSession() reads the cookie locally and triggers
  // @supabase/ssr's refresh-if-needed logic when the access_token
  // is close to expiry. We deliberately use getSession() (local +
  // refresh-if-needed) rather than getUser() (always network round-
  // trip to supabase auth) — getUser() added 100-500 ms to every
  // request even when the cookie was perfectly fresh, which surfaced
  // as "Network's slow" toasts during normal use. Route handlers
  // call requireAuth() which does its own getUser() validation, so
  // the security guarantee isn't relaxed.
  await supabase.auth.getSession().catch(() => {
    // Network blip mid-refresh → leave cookie as-is; route handler
    // will surface the 401 if needed.
  });

  return res;
}

export const config = {
  matcher: [
    /*
     * Match request paths that benefit from cookie-refresh:
     *   - all page routes (SSR may render auth-aware UI)
     *   - /api routes that use requireAuth
     *
     * Exclude:
     *   - _next/static, _next/image (build assets)
     *   - favicon, manifest, sw, robots, sitemap (static)
     *   - /api/cron/* (CRON_SECRET-gated, no user auth)
     *   - /api/version (public health-check)
     *   - /api/storage/sign (mixed: auth users send Bearer, mechanic
     *     portal sends access_token in body — neither needs cookie)
     *   - /service/* + /squawk/* (mechanic / public portals — use
     *     access_token query/path param, not user cookie)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|sw\\.js|robots\\.txt|sitemap\\.xml|api/cron/|api/version|api/storage/|service/|squawk/).*)',
  ],
};

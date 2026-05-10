// =============================================================
// SERVER-SIDE Supabase client (cookie-based auth)
//
// Reads/writes the Supabase auth cookie via Next.js cookies(). Used
// by API routes + server components to authenticate the caller
// without needing a Bearer header.
//
// Why this exists: prior to the cookie migration, every API route
// did `requireAuth(req)` which extracted a Bearer from the
// Authorization header and called `supabaseAdmin.auth.getUser(token)`
// over the network. That round-tripped to GoTrue on every call. With
// cookies, the access_token rides on the request automatically and
// we let supabase-js validate it via the normal session machinery.
// More importantly: the BROWSER client no longer needs to attach a
// Bearer header — cookies travel with same-origin fetches by
// default — which eliminates the iOS GoTrue-lock pressure that was
// causing spurious "Session expired" logouts.
//
// Two factories:
//   - `createServerSupabase(cookieStore)` — reads cookie from the
//     RequestCookies passed in; for use inside route handlers and
//     server components (call `cookies()` to get the store)
//   - `createMiddlewareSupabase(req, res)` — for the Next.js
//     middleware path; reads from req cookies, writes refresh-cookies
//     onto res so the browser gets the rotated token without us
//     needing a separate setCookie roundtrip
// =============================================================

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Server-component / route-handler factory. Pass the `cookies()` store. */
export function createServerSupabase(cookieStore: {
  get(name: string): { value: string } | undefined;
  set?(name: string, value: string, options: CookieOptions): void;
}): SupabaseClient<any, any, any> {
  return createServerClient(URL, ANON, {
    cookies: {
      get(name) {
        return cookieStore.get(name)?.value;
      },
      set(name, value, options) {
        // Route handlers in app router can't always set cookies (the
        // `cookies()` API is read-only there). Suppress the error;
        // middleware handles the actual cookie rotation.
        try {
          cookieStore.set?.(name, value, options);
        } catch { /* read-only cookies in this context */ }
      },
      remove(name, options) {
        try {
          cookieStore.set?.(name, '', { ...options, maxAge: 0 });
        } catch { /* read-only */ }
      },
    },
  });
}

/** Middleware factory. Reads from request cookies, writes onto the response. */
export function createMiddlewareSupabase(req: NextRequest, res: NextResponse): SupabaseClient<any, any, any> {
  return createServerClient(URL, ANON, {
    cookies: {
      get(name) {
        return req.cookies.get(name)?.value;
      },
      set(name, value, options) {
        // Mirror the cookie onto the request (so subsequent reads in
        // this middleware tick see the new value) AND the response
        // (so the browser stores the rotated token).
        req.cookies.set({ name, value, ...options });
        res.cookies.set({ name, value, ...options });
      },
      remove(name, options) {
        req.cookies.set({ name, value: '', ...options });
        res.cookies.set({ name, value: '', ...options });
      },
    },
  });
}

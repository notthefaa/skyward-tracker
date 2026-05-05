import { createClient } from '@supabase/supabase-js';

/**
 * Sign the given e2e user in via the public anon endpoint and return
 * a fresh access-token. Use this when an integration test needs to
 * call an API route as that specific user — the route's `requireAuth`
 * helper validates the bearer.
 *
 * Service-role wouldn't fit: it bypasses RLS and the auth helpers
 * read `auth.uid()` from the JWT.
 */
export async function getAccessToken(email: string, password: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('NEXT_PUBLIC_SUPABASE_URL / ANON_KEY must be set');
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`signInWithPassword: ${error?.message ?? 'no session'}`);
  }
  return data.session.access_token;
}

/**
 * Fetch wrapper that injects an Authorization bearer + JSON content
 * type. Same shape as a route call from the app, minus the
 * idempotency-key header (callers can spread `init.headers` for that).
 */
export async function fetchAs(
  token: string,
  baseURL: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${baseURL}${path}`, { ...init, headers });
}

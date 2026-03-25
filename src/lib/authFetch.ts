// =============================================================
// AUTHENTICATED FETCH — Client-side helper
// Wraps fetch() to automatically attach the Supabase access token
// as a Bearer token in the Authorization header.
//
// Usage:
//   import { authFetch } from '@/lib/authFetch';
//   const res = await authFetch('/api/invite', {
//     method: 'POST',
//     body: JSON.stringify({ email, role, aircraftIds })
//   });
// =============================================================

import { supabase } from './supabase';

/**
 * Performs a fetch request with the current user's Supabase access token
 * automatically attached as `Authorization: Bearer <token>`.
 *
 * Accepts the same arguments as the native fetch() function.
 * Content-Type defaults to application/json if not specified.
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();

  const headers = new Headers(options.headers);

  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }

  // Default to JSON content type for POST/PUT/PATCH/DELETE
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(url, { ...options, headers });
}

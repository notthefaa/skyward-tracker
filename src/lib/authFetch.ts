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
//
// 401 handling
// ------------
// If the server returns 401 (token expired or invalid) we try a
// single token refresh + retry before bubbling the response up.
// On a second 401 we dispatch the `authfetch:unauthorized` window
// event so AppShell can route the user back to sign-in instead of
// every caller having to invent its own re-auth UX.
// =============================================================

import { supabase } from './supabase';

const UNAUTHORIZED_EVENT = 'authfetch:unauthorized';

async function buildHeaders(options: RequestInit): Promise<Headers> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(options.headers);
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = await buildHeaders(options);
  const res = await fetch(url, { ...options, headers });

  if (res.status !== 401) return res;

  // First 401: try to refresh the session, then retry once. A live
  // session whose access token just expired is the most common cause
  // and refreshing usually succeeds without user interaction.
  const { data: refreshed } = await supabase.auth.refreshSession();
  if (!refreshed?.session) {
    notifyUnauthorized();
    return res;
  }

  const retryHeaders = await buildHeaders(options);
  const retried = await fetch(url, { ...options, headers: retryHeaders });
  if (retried.status === 401) notifyUnauthorized();
  return retried;
}

function notifyUnauthorized() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
}

/** Subscribe to 401-after-refresh events (typically AppShell). */
export function onAuthFetchUnauthorized(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(UNAUTHORIZED_EVENT, handler);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
}

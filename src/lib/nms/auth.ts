/**
 * OAuth2 client-credentials helper for the FAA NMS (NOTAM Management
 * Service) API. Bearer tokens live ~30 min on staging; we cache one
 * in a module-level slot and refresh ~60s before expiry so warm
 * function instances reuse a single token across many NOTAM calls.
 *
 * Auth endpoint:  POST {BASE_URL}/v1/auth/token
 * NOTAM API:      GET  {BASE_URL}/nmsapi/v1/notams?location={icao}
 *
 * Env vars:
 *   FAA_NMS_CLIENT_ID      — KEY from the NMS onboarding spreadsheet
 *   FAA_NMS_CLIENT_SECRET  — SECRET from the same spreadsheet
 *   FAA_NMS_BASE_URL       — host (default: staging). Set to
 *                            https://api-nms.aim.faa.gov for prod
 *                            after prod onboarding completes.
 */

import { NETWORK_TIMEOUT_MS } from '@/lib/constants';

const REFRESH_BUFFER_MS = 60_000;
const DEFAULT_BASE_URL = 'https://api-staging.cgifederal-aim.com';

let cached: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;

export function getNmsBaseUrl(): string {
  return (process.env.FAA_NMS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export function hasNmsCredentials(): boolean {
  return Boolean(process.env.FAA_NMS_CLIENT_ID && process.env.FAA_NMS_CLIENT_SECRET);
}

/**
 * Returns a valid bearer token, refreshing if needed. Concurrent
 * callers during a refresh await the same in-flight promise so we
 * don't hammer the auth endpoint with a thundering-herd of token
 * requests on cold start.
 */
export async function getNmsToken(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    return cached.token;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const clientId = process.env.FAA_NMS_CLIENT_ID;
      const clientSecret = process.env.FAA_NMS_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        throw new Error('FAA NMS credentials not configured (set FAA_NMS_CLIENT_ID + FAA_NMS_CLIENT_SECRET).');
      }
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const res = await fetch(`${getNmsBaseUrl()}/v1/auth/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        // FAA returns x-request-id on every response — this is the
        // correlation ID NAIMES will ask for when reporting issues to
        // 7-AWA-NAIMES@faa.gov. Surface it in the error so it ends up
        // in logs / Sentry / chat transcripts.
        const reqId = res.headers.get('x-request-id') || 'none';
        throw new Error(`FAA NMS auth returned ${res.status} (faa_request_id: ${reqId})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
      }
      const data = await res.json() as { access_token?: string; expires_in?: string | number };
      if (!data?.access_token) {
        throw new Error('FAA NMS auth response missing access_token.');
      }
      // FAA returns expires_in as a string ("1799"). Default to 30 min
      // if the field is missing so we still set a sane expiry.
      const expiresInSec =
        typeof data.expires_in === 'string' ? parseInt(data.expires_in, 10) :
        typeof data.expires_in === 'number' ? data.expires_in : 1800;
      const safeExpiry = Number.isFinite(expiresInSec) && expiresInSec > 0 ? expiresInSec : 1800;
      cached = {
        token: data.access_token,
        expiresAt: Date.now() + (safeExpiry * 1000),
      };
      return data.access_token;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Drop the cached token so the next getNmsToken() call hits the auth
 * endpoint. Used after a 401 on a NOTAM request — the cached token
 * might have been revoked or rotated server-side.
 */
export function invalidateNmsToken(): void {
  cached = null;
}

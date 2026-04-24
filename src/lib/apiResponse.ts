// =============================================================
// API response helpers — opt-in standard shape for new routes.
//
// Existing routes use one of three shapes inconsistently:
//   - { success: true, ...domainData }
//   - { data: [...] }
//   - raw object
// Migrating all of them mid-stride would break every client that
// reads a specific field. So: new routes and refactors SHOULD
// emit the shape below; existing ones keep their shape until
// touched.
//
// Shape:
//   success → { ok: true, data: T }
//   failure → { ok: false, code?: string, error: string, requestId?: string }
//
// Clients can narrow on `ok` as a discriminated union, or keep
// checking `res.ok` (HTTP status) and reading `error` from the
// body — both still work.
//
// The `code` field is a stable machine-readable identifier the
// companion app (offline queue) switches on to decide retry vs.
// drop vs. surface-to-user. Human-readable `error` is still the
// user-facing copy.
// =============================================================

import { NextResponse } from 'next/server';
import { getRequestId, logError } from './requestId';

/**
 * Stable error codes emitted by submission routes. Companion app
 * treats these as the contract: the set may grow, but meanings
 * don't change.
 *
 *   VALIDATION_ERROR       — payload failed server-side validation
 *   AIRCRAFT_ID_REQUIRED   — payload missing aircraftId
 *   AIRCRAFT_NOT_FOUND     — aircraftId doesn't match a live row
 *   SQUAWK_NOT_FOUND       — squawkId doesn't exist or is soft-deleted
 *                            (companion app: queue the resolve, retry
 *                             after create lands)
 *   LOG_NOT_FOUND          — logId doesn't exist or is soft-deleted
 *   NO_AIRCRAFT_ACCESS     — user's access was revoked between
 *                            queueing and replay — drop entry, warn user
 *   NO_ADMIN_ACCESS        — admin required for edit/delete
 *   UNAUTHENTICATED        — session expired
 *   IMPLAUSIBLE_DELTA      — >24hr single-leg flight (typo guard)
 *   STALE_REPLAY           — submission is older than the server is
 *                            willing to backdate (future use)
 *   DUPLICATE              — unique-constraint violation the companion
 *                            app should treat as already-accepted
 *   RATE_LIMITED           — too many requests; back off
 *   INTERNAL_ERROR         — unexpected server error; retry with backoff
 */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'AIRCRAFT_ID_REQUIRED'
  | 'AIRCRAFT_NOT_FOUND'
  | 'SQUAWK_NOT_FOUND'
  | 'LOG_NOT_FOUND'
  | 'NO_AIRCRAFT_ACCESS'
  | 'NO_ADMIN_ACCESS'
  | 'UNAUTHENTICATED'
  | 'IMPLAUSIBLE_DELTA'
  | 'STALE_REPLAY'
  | 'DUPLICATE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; code?: ApiErrorCode; error: string; requestId?: string };

/** Success response with typed data. */
export function apiOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data } satisfies ApiResponse<T>, { status });
}

/**
 * Error response. Pass `req` to stamp the request ID into the body
 * and the `x-request-id` header — users can quote it in bug reports
 * and it correlates with Sentry.
 */
export function apiError(
  message: string,
  status = 400,
  req?: Request,
): NextResponse {
  const requestId = req ? getRequestId(req) : undefined;
  const body: ApiResponse<never> = requestId
    ? { ok: false, error: message, requestId }
    : { ok: false, error: message };
  return NextResponse.json(body, {
    status,
    headers: requestId ? { 'x-request-id': requestId } : undefined,
  });
}

/**
 * Error response with a stable machine-readable code. Companion-app
 * routes should emit these instead of the un-coded `apiError` so the
 * offline queue can reliably distinguish drop-vs-retry-vs-surface.
 */
export function apiErrorCoded(
  code: ApiErrorCode,
  message: string,
  status = 400,
  req?: Request,
): NextResponse {
  const requestId = req ? getRequestId(req) : undefined;
  const body = requestId
    ? { ok: false, code, error: message, requestId }
    : { ok: false, code, error: message };
  return NextResponse.json(body, {
    status,
    headers: requestId ? { 'x-request-id': requestId } : undefined,
  });
}

/**
 * Throwable carrying a structured error code. Internal handlers can
 * raise this and the top-level catch translates it to an
 * apiErrorCoded response.
 *
 *   throw new CodedError('SQUAWK_NOT_FOUND', 'Squawk not found.', 404);
 */
export class CodedError extends Error {
  code: ApiErrorCode;
  status: number;
  constructor(code: ApiErrorCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Standard catch-block shim for submission routes. Distinguishes:
 *   * CodedError       → apiErrorCoded with its fields
 *   * { status, message } auth errors from requireAuth → map 401 to
 *     UNAUTHENTICATED, 403 to NO_AIRCRAFT_ACCESS/NO_ADMIN_ACCESS
 *   * anything else    → 500 INTERNAL_ERROR, logged
 */
export function handleCodedError(error: unknown, req?: Request): NextResponse {
  if (error instanceof CodedError) {
    return apiErrorCoded(error.code, error.message, error.status, req);
  }
  if (typeof error === 'object' && error !== null && 'status' in error && 'message' in error) {
    const authError = error as { status: number; message: string };
    const code: ApiErrorCode =
      authError.status === 401 ? 'UNAUTHENTICATED'
      : authError.status === 403 && authError.message.toLowerCase().includes('admin') ? 'NO_ADMIN_ACCESS'
      : authError.status === 403 ? 'NO_AIRCRAFT_ACCESS'
      : 'INTERNAL_ERROR';
    return apiErrorCoded(code, authError.message, authError.status, req);
  }
  logError('[API Error]', error, { route: req?.url });
  return apiErrorCoded('INTERNAL_ERROR', 'Something unexpected happened. Try again.', 500, req);
}

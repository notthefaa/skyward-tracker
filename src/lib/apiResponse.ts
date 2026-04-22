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
//   failure → { ok: false, error: string, requestId?: string }
//
// Clients can narrow on `ok` as a discriminated union, or keep
// checking `res.ok` (HTTP status) and reading `error` from the
// body — both still work.
// =============================================================

import { NextResponse } from 'next/server';
import { getRequestId } from './requestId';

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; requestId?: string };

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

// =============================================================
// SERVER-SIDE AUTH MIDDLEWARE
// Verifies the caller's Supabase session from cookies/headers
// and optionally enforces an admin role check.
//
// Usage in any API route:
//   const { user, supabaseAdmin } = await requireAuth(req);
//   const { user, supabaseAdmin } = await requireAuth(req, 'admin');
// =============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { env } from './env';
import { getRequestId, logError } from './requestId';
import type { AppRole } from './types';

// Use a permissive generic so all .from() calls work without a generated schema
type AdminClient = SupabaseClient<any, any, any>;

interface AuthResult {
  user: { id: string; email?: string };
  supabaseAdmin: AdminClient;
  requestId: string;
}

/**
 * Extracts the bearer token from the request's Authorization header.
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

/**
 * Creates a Supabase admin client (service role) for privileged operations.
 */
export function createAdminClient(): AdminClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Verifies the caller's authentication and optionally checks their role.
 * Throws an object with { status, message } if auth fails.
 *
 * @param req - The incoming Request
 * @param requiredRole - If provided, the user must have this role in aft_user_roles
 */
export async function requireAuth(req: Request, requiredRole?: AppRole): Promise<AuthResult> {
  const requestId = getRequestId(req);
  const token = extractToken(req);

  if (!token) {
    throw { status: 401, message: 'Authentication required. No token provided.', requestId };
  }

  const supabaseAdmin = createAdminClient();

  // Verify the access token by retrieving the user from Supabase Auth
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    throw { status: 401, message: 'Session expired. Log in again.', requestId };
  }

  // If a specific role is required, check aft_user_roles
  if (requiredRole) {
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('aft_user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (roleError || !roleData) {
      throw { status: 403, message: 'User role not found.', requestId };
    }

    if (roleData.role !== requiredRole) {
      throw { status: 403, message: `This action requires ${requiredRole} privileges.`, requestId };
    }
  }

  return { user: { id: user.id, email: user.email }, supabaseAdmin, requestId };
}

/**
 * Verifies that a user has access to a specific aircraft.
 * Returns true if the user is a global admin OR has a row in aft_user_aircraft_access.
 * Throws { status: 403 } if no access.
 *
 * Usage:
 *   const { user, supabaseAdmin } = await requireAuth(req);
 *   await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);
 */
export async function requireAircraftAccess(
  supabaseAdmin: AdminClient,
  userId: string,
  aircraftId: string
): Promise<void> {
  // Global admins bypass aircraft-level checks
  const { data: roleData } = await supabaseAdmin
    .from('aft_user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();

  if (roleData?.role === 'admin') return;

  // Check aircraft-level access
  const { data: access } = await supabaseAdmin
    .from('aft_user_aircraft_access')
    .select('aircraft_role')
    .eq('user_id', userId)
    .eq('aircraft_id', aircraftId)
    .single();

  if (!access) {
    throw { status: 403, message: 'You do not have access to this aircraft.' };
  }
}

/**
 * Verifies that a user is an admin for a specific aircraft.
 * Returns true if the user is a global admin OR has aircraft_role='admin'.
 * Throws { status: 403 } if not an admin.
 */
export async function requireAircraftAdmin(
  supabaseAdmin: AdminClient,
  userId: string,
  aircraftId: string
): Promise<void> {
  // Global admins bypass aircraft-level checks
  const { data: roleData } = await supabaseAdmin
    .from('aft_user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();

  if (roleData?.role === 'admin') return;

  // Check aircraft-level admin role
  const { data: access } = await supabaseAdmin
    .from('aft_user_aircraft_access')
    .select('aircraft_role')
    .eq('user_id', userId)
    .eq('aircraft_id', aircraftId)
    .single();

  if (!access || access.aircraft_role !== 'admin') {
    throw { status: 403, message: 'This action requires aircraft admin privileges.' };
  }
}

/**
 * Returns true if any user on this aircraft's access list (optionally
 * excluding one user) is a global admin (`aft_user_roles.role = 'admin'`).
 *
 * Used to relax the sole-aircraft-admin guard on user delete + aircraft-
 * access demote/remove. A global admin who has access to the aircraft can
 * recover it (promote a pilot, take admin actions) even if the operation
 * leaves zero aircraft-level admins, so the guard becomes overly strict
 * in fleets that have a global admin on the access list.
 *
 * Note: a global admin without a row in `aft_user_aircraft_access` for
 * this aircraft is NOT counted — the access row is what surfaces the
 * aircraft in their UI by default. Without it, recovery requires direct
 * DB access or admin tooling, which is exactly the unrecoverable state
 * the original guard exists to prevent.
 */
export async function aircraftHasGlobalAdminWithAccess(
  supabaseAdmin: AdminClient,
  aircraftId: string,
  excludeUserId?: string,
): Promise<boolean> {
  let accessQuery = supabaseAdmin
    .from('aft_user_aircraft_access')
    .select('user_id')
    .eq('aircraft_id', aircraftId);
  if (excludeUserId) {
    accessQuery = accessQuery.neq('user_id', excludeUserId);
  }
  const { data: accessRows, error: accessErr } = await accessQuery;
  if (accessErr) throw accessErr;
  const userIds = (accessRows || []).map(r => (r as { user_id: string }).user_id);
  if (userIds.length === 0) return false;

  const { data: admins, error: adminErr } = await supabaseAdmin
    .from('aft_user_roles')
    .select('user_id')
    .in('user_id', userIds)
    .eq('role', 'admin')
    .limit(1);
  if (adminErr) throw adminErr;
  return (admins?.length ?? 0) > 0;
}

/**
 * Standard error response builder for API routes.
 * Handles both auth errors (thrown by requireAuth) and generic errors.
 *
 * Pass `req` when available — it lets the response body include a
 * requestId the user can quote in a support report, and routes the
 * error to Sentry with matching correlation tags. Backward-compatible
 * when omitted (older call sites keep working).
 */
export function handleApiError(error: unknown, req?: Request): NextResponse {
  const requestId = (
    typeof error === 'object' && error !== null && 'requestId' in error
      ? (error as { requestId?: string }).requestId
      : undefined
  ) || (req ? getRequestId(req) : undefined);

  // Auth errors thrown by requireAuth — these are expected, don't log.
  if (typeof error === 'object' && error !== null && 'status' in error && 'message' in error) {
    const authError = error as { status: number; message: string };
    return NextResponse.json(
      // `ok: false` is the new discriminator (src/lib/apiResponse.ts);
      // `error` is kept for existing clients that read that field.
      { ok: false, error: authError.message, ...(requestId ? { requestId } : {}) },
      { status: authError.status, headers: requestId ? { 'x-request-id': requestId } : undefined }
    );
  }

  // Unexpected errors — log structured and forward to Sentry when wired.
  logError('[API Error]', error, { requestId, route: req?.url });
  // Include a short request-ID hint in the user-visible error so a
  // pilot reporting a 500 can hand us something greppable in Vercel
  // logs. Without this every "Something unexpected" toast was a
  // dead-end that required a developer to dig through timestamps.
  // The full requestId stays in the body for programmatic callers.
  const refHint = requestId ? ` (ref: ${requestId.slice(0, 8)})` : '';
  return NextResponse.json(
    {
      ok: false,
      error: `Something unexpected happened. Try again.${refHint}`,
      ...(requestId ? { requestId } : {}),
    },
    { status: 500, headers: requestId ? { 'x-request-id': requestId } : undefined }
  );
}

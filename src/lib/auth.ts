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
import type { AppRole } from './types';

// Use a permissive generic so all .from() calls work without a generated schema
type AdminClient = SupabaseClient<any, any, any>;

interface AuthResult {
  user: { id: string; email?: string };
  supabaseAdmin: AdminClient;
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
  const token = extractToken(req);

  if (!token) {
    throw { status: 401, message: 'Authentication required. No token provided.' };
  }

  const supabaseAdmin = createAdminClient();

  // Verify the access token by retrieving the user from Supabase Auth
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    throw { status: 401, message: 'Invalid or expired session. Please log in again.' };
  }

  // If a specific role is required, check aft_user_roles
  if (requiredRole) {
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('aft_user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (roleError || !roleData) {
      throw { status: 403, message: 'User role not found.' };
    }

    if (roleData.role !== requiredRole) {
      throw { status: 403, message: `This action requires ${requiredRole} privileges.` };
    }
  }

  return { user: { id: user.id, email: user.email }, supabaseAdmin };
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
 * Standard error response builder for API routes.
 * Handles both auth errors (thrown by requireAuth) and generic errors.
 */
export function handleApiError(error: unknown): NextResponse {
  // Auth errors thrown by requireAuth
  if (typeof error === 'object' && error !== null && 'status' in error && 'message' in error) {
    const authError = error as { status: number; message: string };
    return NextResponse.json(
      { error: authError.message },
      { status: authError.status }
    );
  }

  // Generic errors — don't leak internals to the client
  console.error('[API Error]', error);
  return NextResponse.json(
    { error: 'An unexpected error occurred. Please try again.' },
    { status: 500 }
  );
}

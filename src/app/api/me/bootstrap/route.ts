import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/me/bootstrap
 *
 * Consolidated read endpoint for the data `useFleetData.fetchAircraftData`
 * needs to render the shell and the active-tail summary. Replaces three
 * direct `supabase.from()` calls + one aircraft fetch (4 round trips with
 * 4 client-side getSession() calls each) with a single authenticated
 * fetch that rides the auth cookie.
 *
 * Why a consolidated route: we used to fire these in `Promise.all` from
 * the browser, which hit four separate network round trips AND four
 * trips through supabase-js's GoTrue mutex. With cookie auth + this
 * endpoint, it's ONE cookie-bearing fetch and the server does the
 * parallel reads with the service-role key — no per-call mutex,
 * no per-call getSession.
 *
 * Returns:
 *   - sysSettings: aft_system_settings row (id=1)
 *   - role: aft_user_roles.role (default 'pilot')
 *   - userInitials, completedOnboarding, tourCompleted from aft_user_roles
 *   - access: aft_user_aircraft_access rows for this user
 *   - aircraft: full aft_aircraft rows for assigned ids (deleted_at IS NULL)
 *
 * Does NOT include flight-log enrichment / metrics — those are computed
 * client-side and refresh on tail switch via separate calls. This route
 * is just the bootstrap surface.
 */
export async function GET(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    // Phase 1: identity + access reads in parallel.
    const [settingsR, roleR, accessR] = await Promise.all([
      supabaseAdmin.from('aft_system_settings').select('*').eq('id', 1).single(),
      supabaseAdmin
        .from('aft_user_roles')
        .select('role, initials, completed_onboarding, tour_completed')
        .eq('user_id', user.id)
        .single(),
      supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('aircraft_id, aircraft_role, user_id')
        .eq('user_id', user.id),
    ]);

    // PGRST116 = "no rows" on .single() — first-run users have no role/
    // settings yet; tolerate. Hard errors throw.
    if (settingsR.error && settingsR.error.code !== 'PGRST116') throw settingsR.error;
    if (roleR.error && roleR.error.code !== 'PGRST116') throw roleR.error;
    if (accessR.error) throw accessR.error;

    const sysSettings = settingsR.data ?? null;
    const profile = (roleR.data ?? {}) as {
      role?: string;
      initials?: string;
      completed_onboarding?: boolean;
      tour_completed?: boolean;
    };
    const access = accessR.data ?? [];
    const assignedIds = access.map((a: any) => a.aircraft_id);

    // Phase 2: pull full rows for the user's assigned aircraft. Skip the
    // round trip when the user has no aircraft yet (first-run pilot).
    let aircraft: any[] = [];
    if (assignedIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('aft_aircraft')
        .select('*')
        .in('id', assignedIds)
        .is('deleted_at', null)
        .order('tail_number');
      if (error) throw error;
      aircraft = data ?? [];
    }

    return NextResponse.json({
      sysSettings,
      role: (profile.role ?? 'pilot'),
      userInitials: profile.initials ?? '',
      completedOnboarding: !!profile.completed_onboarding,
      tourCompleted: !!profile.tour_completed,
      access,
      aircraft,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}

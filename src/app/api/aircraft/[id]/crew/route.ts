import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/aircraft/[id]/crew
 *
 * Returns the access list for an aircraft joined with user_roles for
 * display (email/initials/full_name). Used by SummaryTab (read-only
 * display) and CalendarTab (admin booking-on-behalf-of).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { user, supabaseAdmin } = await requireAuth(req);
    await requireAircraftAccess(supabaseAdmin, user.id, id);

    const { data: access, error: accessErr } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('user_id, aircraft_role')
      .eq('aircraft_id', id);
    if (accessErr) throw accessErr;
    if (!access || access.length === 0) {
      return NextResponse.json({ crew: [] });
    }

    const userIds = access.map(a => (a as any).user_id);
    const { data: usersData, error: usersErr } = await supabaseAdmin
      .from('aft_user_roles')
      .select('user_id, email, initials, full_name')
      .in('user_id', userIds);
    if (usersErr) throw usersErr;

    const crew = access.map(a => {
      const u = (usersData ?? []).find((x: any) => x.user_id === (a as any).user_id);
      return {
        user_id: (a as any).user_id,
        aircraft_role: (a as any).aircraft_role,
        email: u?.email ?? '',
        initials: u?.initials ?? '',
        full_name: u?.full_name ?? '',
      };
    }).sort((a, b) =>
      (a.full_name || a.email || a.initials).localeCompare(b.full_name || b.email || b.initials)
    );

    return NextResponse.json({ crew });
  } catch (error) {
    return handleApiError(error, req);
  }
}

import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** List all users with their aircraft assignments */
export async function GET(req: Request) {
  try {
    const { supabaseAdmin } = await requireAuth(req, 'admin');

    const [
      { data: users, error: usersErr },
      { data: access, error: accessErr },
      { data: aircraft, error: aircraftErr },
    ] = await Promise.all([
      supabaseAdmin.from('aft_user_roles').select('user_id, role, email, initials, full_name').order('role').order('email'),
      supabaseAdmin.from('aft_user_aircraft_access').select('user_id, aircraft_id, aircraft_role'),
      supabaseAdmin.from('aft_aircraft').select('id, tail_number'),
    ]);
    // Throw on any read failure so the admin UI never renders a partial
    // user list (e.g. all users with empty aircraft assignments because
    // the access read silently failed).
    if (usersErr) throw usersErr;
    if (accessErr) throw accessErr;
    if (aircraftErr) throw aircraftErr;

    const aircraftMap: Record<string, string> = {};
    for (const ac of aircraft || []) aircraftMap[ac.id] = ac.tail_number;

    const result = (users || []).map((u: any) => ({
      ...u,
      aircraft: (access || [])
        .filter((a: any) => a.user_id === u.user_id)
        .map((a: any) => ({ aircraft_id: a.aircraft_id, tail_number: aircraftMap[a.aircraft_id] || 'Unknown', aircraft_role: a.aircraft_role })),
    }));

    return NextResponse.json({ users: result });
  } catch (error) {
    return handleApiError(error, req);
  }
}

/** Update a user's global role */
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req, 'admin');
    const { targetUserId, newRole } = await req.json();

    if (!targetUserId || !newRole) {
      return NextResponse.json({ error: 'User ID and new role are required.' }, { status: 400 });
    }
    if (!['admin', 'pilot'].includes(newRole)) {
      return NextResponse.json({ error: 'Role must be "admin" or "pilot".' }, { status: 400 });
    }

    // Prevent self-demotion
    if (targetUserId === user.id && newRole !== 'admin') {
      return NextResponse.json({ error: 'You cannot demote your own account.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('aft_user_roles')
      .update({ role: newRole })
      .eq('user_id', targetUserId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, req);
  }
}

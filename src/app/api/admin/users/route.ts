import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

/** List all users with their aircraft assignments */
export async function GET(req: Request) {
  try {
    const { supabaseAdmin } = await requireAuth(req, 'admin');

    const [{ data: users }, { data: access }, { data: aircraft }] = await Promise.all([
      supabaseAdmin.from('aft_user_roles').select('user_id, role, email, initials, full_name').order('role').order('email'),
      supabaseAdmin.from('aft_user_aircraft_access').select('user_id, aircraft_id, aircraft_role'),
      supabaseAdmin.from('aft_aircraft').select('id, tail_number'),
    ]);

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
    return handleApiError(error);
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
    return handleApiError(error);
  }
}

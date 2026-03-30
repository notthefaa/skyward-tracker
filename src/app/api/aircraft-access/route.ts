import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

/** Update a user's aircraft role */
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { targetUserId, aircraftId, newRole } = await req.json();

    if (!targetUserId || !aircraftId || !newRole) {
      return NextResponse.json({ error: 'User ID, aircraft ID, and new role are required.' }, { status: 400 });
    }

    if (!['admin', 'pilot'].includes(newRole)) {
      return NextResponse.json({ error: 'Role must be "admin" or "pilot".' }, { status: 400 });
    }

    // Verify caller has permission (global admin or tailnumber admin)
    const { data: callerRole } = await supabaseAdmin
      .from('aft_user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    const isGlobalAdmin = callerRole?.role === 'admin';

    if (!isGlobalAdmin) {
      const { data: callerAccess } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('aircraft_role')
        .eq('user_id', user.id)
        .eq('aircraft_id', aircraftId)
        .single();

      if (!callerAccess || callerAccess.aircraft_role !== 'admin') {
        return NextResponse.json({ error: 'You do not have admin privileges for this aircraft.' }, { status: 403 });
      }
    }

    // Prevent self-demotion if last admin
    if (targetUserId === user.id && newRole === 'pilot') {
      const { data: admins } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('user_id')
        .eq('aircraft_id', aircraftId)
        .eq('aircraft_role', 'admin');

      if (admins && admins.length <= 1) {
        return NextResponse.json({ error: 'Cannot demote yourself — you are the only admin for this aircraft.' }, { status: 400 });
      }
    }

    await supabaseAdmin
      .from('aft_user_aircraft_access')
      .update({ aircraft_role: newRole })
      .eq('user_id', targetUserId)
      .eq('aircraft_id', aircraftId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Remove a user from an aircraft */
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { targetUserId, aircraftId } = await req.json();

    if (!targetUserId || !aircraftId) {
      return NextResponse.json({ error: 'User ID and aircraft ID are required.' }, { status: 400 });
    }

    // Verify caller has permission
    const { data: callerRole } = await supabaseAdmin
      .from('aft_user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    const isGlobalAdmin = callerRole?.role === 'admin';

    if (!isGlobalAdmin) {
      const { data: callerAccess } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('aircraft_role')
        .eq('user_id', user.id)
        .eq('aircraft_id', aircraftId)
        .single();

      if (!callerAccess || callerAccess.aircraft_role !== 'admin') {
        return NextResponse.json({ error: 'You do not have admin privileges for this aircraft.' }, { status: 403 });
      }
    }

    // Prevent removing self if last admin
    if (targetUserId === user.id) {
      const { data: admins } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('user_id')
        .eq('aircraft_id', aircraftId)
        .eq('aircraft_role', 'admin');

      if (admins && admins.length <= 1) {
        return NextResponse.json({ error: 'Cannot remove yourself — you are the only admin for this aircraft.' }, { status: 400 });
      }
    }

    // Cancel all future reservations for this user on this aircraft
    await supabaseAdmin
      .from('aft_reservations')
      .update({ status: 'cancelled' })
      .eq('aircraft_id', aircraftId)
      .eq('user_id', targetUserId)
      .eq('status', 'confirmed')
      .gt('start_time', new Date().toISOString());

    // Remove access
    await supabaseAdmin
      .from('aft_user_aircraft_access')
      .delete()
      .eq('user_id', targetUserId)
      .eq('aircraft_id', aircraftId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

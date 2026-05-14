import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Get deletion impact preview — shows what will be deleted */
export async function GET(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    // Find aircraft this user created (will be cascade-deleted)
    const { data: ownedAircraft } = await supabaseAdmin
      .from('aft_aircraft')
      .select('id, tail_number, aircraft_type')
      .eq('created_by', user.id);

    // Find other users who will lose access to those aircraft
    let affectedUsers: any[] = [];
    if (ownedAircraft && ownedAircraft.length > 0) {
      const aircraftIds = ownedAircraft.map(a => a.id);
      const { data: access } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('user_id, aircraft_id')
        .in('aircraft_id', aircraftIds)
        .neq('user_id', user.id);

      if (access) {
        const userIds = Array.from(new Set(access.map(a => a.user_id)));
        const { data: users } = await supabaseAdmin
          .from('aft_user_roles')
          .select('user_id, email')
          .in('user_id', userIds);
        affectedUsers = users || [];
      }
    }

    return NextResponse.json({
      ownedAircraft: ownedAircraft || [],
      affectedUserCount: affectedUsers.length,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}

/** Delete the user's own account */
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { confirmDelete } = await req.json();

    if (confirmDelete !== true) {
      return NextResponse.json({ error: 'Deletion must be explicitly confirmed.' }, { status: 400 });
    }

    // Cancel all future reservations by this user. Throw on failure so
    // we don't proceed to deleteUser and leave dangling confirmed
    // reservations attached to a user_id that's about to be SET NULL —
    // those would otherwise render to other pilots as ghost bookings
    // with no owner attached.
    const { error: cancelErr } = await supabaseAdmin
      .from('aft_reservations')
      .update({ status: 'cancelled' })
      .eq('user_id', user.id)
      .eq('status', 'confirmed')
      .gt('start_time', new Date().toISOString());
    if (cancelErr) throw cancelErr;

    // Revoke all refresh tokens before delete so a stolen device can't
    // continue using a cached token until natural expiry (~7 days).
    // Best-effort: log and continue if signOut fails — the deleteUser
    // below is the actual source of truth.
    const { error: signOutErr } = await supabaseAdmin.auth.admin.signOut(user.id, 'global');
    if (signOutErr) console.warn('[account/delete] global signOut failed:', signOutErr.message);

    // Delete the user from Supabase Auth
    // This will cascade-delete:
    // - aft_aircraft where created_by = user.id (CASCADE)
    //   - which cascades to flight_logs, mx_items, squawks, notes, events, etc.
    // - aft_user_roles (CASCADE)
    // - aft_user_aircraft_access (CASCADE)
    // - aft_notification_preferences (CASCADE)
    const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, req);
  }
}

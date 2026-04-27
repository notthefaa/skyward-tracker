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

    // Race-safe demotion path. The previous guard read the admin
    // list and *then* updated, so two admins demoting at the same
    // moment could each see "2 admins, safe to demote" and both
    // succeed, leaving the aircraft with zero admins. The conditional
    // path below relies on a follow-up SELECT keyed off the target's
    // *new* role to confirm at least one admin still exists; if the
    // post-update count is zero we revert the change.
    if (newRole === 'pilot') {
      // Snapshot the target's current role for the friendly-error path
      // and to skip the no-op case.
      const { data: targetCurrent } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('aircraft_role')
        .eq('user_id', targetUserId)
        .eq('aircraft_id', aircraftId)
        .maybeSingle();

      if (!targetCurrent) {
        return NextResponse.json({ error: 'User does not have access to this aircraft.' }, { status: 404 });
      }
      if (targetCurrent.aircraft_role === 'pilot') {
        // Already a pilot — nothing to do, treat as success.
        return NextResponse.json({ success: true });
      }

      // Apply the demotion, then verify in a single follow-up read
      // that at least one admin remains. If a concurrent demotion
      // stranded the aircraft, revert this one immediately. The
      // small race window where both writes succeed and we then
      // restore both is acceptable — both callers receive the error
      // and the aircraft never settles in a 0-admin state.
      await supabaseAdmin
        .from('aft_user_aircraft_access')
        .update({ aircraft_role: 'pilot' })
        .eq('user_id', targetUserId)
        .eq('aircraft_id', aircraftId);

      const { count: remainingAdmins } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('user_id', { count: 'exact', head: true })
        .eq('aircraft_id', aircraftId)
        .eq('aircraft_role', 'admin');

      if ((remainingAdmins ?? 0) === 0) {
        // Restore — and tell the caller why.
        await supabaseAdmin
          .from('aft_user_aircraft_access')
          .update({ aircraft_role: 'admin' })
          .eq('user_id', targetUserId)
          .eq('aircraft_id', aircraftId);
        const msg = targetUserId === user.id
          ? 'Cannot demote yourself — no other admins remain. Promote another pilot first.'
          : 'Cannot demote the only remaining admin. Promote another pilot first.';
        return NextResponse.json({ error: msg }, { status: 409 });
      }

      return NextResponse.json({ success: true });
    }

    // Promotion to admin — no admin-count concern.
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

    // Race-safe removal. Snapshot the target's role, perform the
    // delete, then verify at least one admin remains. If a concurrent
    // removal stranded the aircraft, restore the row.
    const { data: targetCurrent } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('aircraft_role')
      .eq('user_id', targetUserId)
      .eq('aircraft_id', aircraftId)
      .maybeSingle();

    if (!targetCurrent) {
      // Already gone — treat as success (idempotent removal).
      return NextResponse.json({ success: true });
    }

    // Cancel all future reservations for this user on this aircraft
    await supabaseAdmin
      .from('aft_reservations')
      .update({ status: 'cancelled' })
      .eq('aircraft_id', aircraftId)
      .eq('user_id', targetUserId)
      .eq('status', 'confirmed')
      .gt('start_time', new Date().toISOString());

    await supabaseAdmin
      .from('aft_user_aircraft_access')
      .delete()
      .eq('user_id', targetUserId)
      .eq('aircraft_id', aircraftId);

    // Only verify when removing an admin; pilot removal can never
    // strand the aircraft.
    if (targetCurrent.aircraft_role === 'admin') {
      const { count: remainingAdmins } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('user_id', { count: 'exact', head: true })
        .eq('aircraft_id', aircraftId)
        .eq('aircraft_role', 'admin');

      if ((remainingAdmins ?? 0) === 0) {
        // Restore the row so the aircraft isn't orphaned.
        await supabaseAdmin
          .from('aft_user_aircraft_access')
          .insert({
            user_id: targetUserId,
            aircraft_id: aircraftId,
            aircraft_role: 'admin',
          });
        const msg = targetUserId === user.id
          ? 'Cannot remove yourself — no other admins remain. Promote another pilot first.'
          : 'Cannot remove the only remaining admin. Promote another pilot first.';
        return NextResponse.json({ error: msg }, { status: 409 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

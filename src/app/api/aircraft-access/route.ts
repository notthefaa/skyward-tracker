import { NextResponse } from 'next/server';
import { requireAuth, handleApiError, aircraftHasGlobalAdminWithAccess } from '@/lib/auth';
import { idempotency } from '@/lib/idempotency';

/** Update a user's aircraft role */
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    // Idempotency BEFORE the read-and-demote dance — without this a
    // network-blip retry of a successful demote re-runs the verify
    // count + reverts on a transient failure, surfacing a confusing
    // "cannot demote — only admin" error to a user whose first call
    // actually succeeded.
    const idem = idempotency(supabaseAdmin, user.id, req, 'aircraft-access/PUT');
    const cached = await idem.check();
    if (cached) return cached;
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
        const ok = { success: true };
        await idem.save(200, ok);
        return NextResponse.json(ok);
      }

      // Apply the demotion, then verify in a single follow-up read
      // that at least one admin remains. If a concurrent demotion
      // stranded the aircraft, revert this one immediately. The
      // small race window where both writes succeed and we then
      // restore both is acceptable — both callers receive the error
      // and the aircraft never settles in a 0-admin state.
      const { error: demoteErr } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .update({ aircraft_role: 'pilot' })
        .eq('user_id', targetUserId)
        .eq('aircraft_id', aircraftId);
      if (demoteErr) throw demoteErr;

      const { count: remainingAdmins, error: countErr } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('user_id', { count: 'exact', head: true })
        .eq('aircraft_id', aircraftId)
        .eq('aircraft_role', 'admin');
      if (countErr) throw countErr;

      if ((remainingAdmins ?? 0) === 0) {
        // Relaxed sole-admin guard: if a global admin has access to
        // this aircraft, leaving zero aircraft-admins doesn't strand
        // the plane — the global admin can recover (promote a pilot,
        // edit the aircraft directly). Don't restore the demotion in
        // that case. We exclude the target so a self-demote of a
        // global admin still demands another global admin elsewhere
        // on the access list.
        const hasGlobalAdmin = await aircraftHasGlobalAdminWithAccess(
          supabaseAdmin, aircraftId, targetUserId,
        );
        if (!hasGlobalAdmin) {
          // Restore — and tell the caller why.
          const { error: restoreErr } = await supabaseAdmin
            .from('aft_user_aircraft_access')
            .update({ aircraft_role: 'admin' })
            .eq('user_id', targetUserId)
            .eq('aircraft_id', aircraftId);
          if (restoreErr) throw restoreErr;
          const msg = targetUserId === user.id
            ? 'Cannot demote yourself — no other admins remain. Promote another pilot first, or add a global admin to the aircraft.'
            : 'Cannot demote the only remaining admin. Promote another pilot first, or add a global admin to the aircraft.';
          return NextResponse.json({ error: msg }, { status: 409 });
        }
      }

      const ok = { success: true };
      await idem.save(200, ok);
      return NextResponse.json(ok);
    }

    // Promotion to admin — no admin-count concern.
    const { error: promoteErr } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .update({ aircraft_role: newRole })
      .eq('user_id', targetUserId)
      .eq('aircraft_id', aircraftId);
    if (promoteErr) throw promoteErr;

    const ok = { success: true };
    await idem.save(200, ok);
    return NextResponse.json(ok);
  } catch (error) {
    return handleApiError(error, req);
  }
}

/** Remove a user from an aircraft */
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    // Idempotency BEFORE the read-and-delete dance so a network-blip
    // retry of a successful removal returns cached 200 instead of
    // running the read + restore + count again with stale state.
    const idem = idempotency(supabaseAdmin, user.id, req, 'aircraft-access/DELETE');
    const cached = await idem.check();
    if (cached) return cached;
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
      const ok = { success: true };
      await idem.save(200, ok);
      return NextResponse.json(ok);
    }

    // Cancel all future reservations for this user on this aircraft.
    // Throw on failure: leaving the user's reservations on the calendar
    // after access removal is a real foot-gun (calendar shows them as
    // "the booked pilot" but they no longer have access to act on it).
    const { error: rsvCancelErr } = await supabaseAdmin
      .from('aft_reservations')
      .update({ status: 'cancelled' })
      .eq('aircraft_id', aircraftId)
      .eq('user_id', targetUserId)
      .eq('status', 'confirmed')
      .gt('start_time', new Date().toISOString());
    if (rsvCancelErr) throw rsvCancelErr;

    const { error: accessDelErr } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .delete()
      .eq('user_id', targetUserId)
      .eq('aircraft_id', aircraftId);
    if (accessDelErr) throw accessDelErr;

    // Only verify when removing an admin; pilot removal can never
    // strand the aircraft.
    if (targetCurrent.aircraft_role === 'admin') {
      // Throw on count error — without this, a transient supabase
      // blip silently treats remainingAdmins as 0, triggering the
      // restore path and surfacing a confusing "cannot remove — only
      // admin" 409 to an admin who just successfully removed a peer
      // and is one of several remaining admins.
      const { count: remainingAdmins, error: countErr } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('user_id', { count: 'exact', head: true })
        .eq('aircraft_id', aircraftId)
        .eq('aircraft_role', 'admin');
      if (countErr) throw countErr;

      if ((remainingAdmins ?? 0) === 0) {
        // Relaxed sole-admin guard: if a global admin has access to
        // this aircraft (excluding the just-removed target), removing
        // the only aircraft-admin doesn't strand the plane. Skip the
        // restore in that case.
        const hasGlobalAdmin = await aircraftHasGlobalAdminWithAccess(
          supabaseAdmin, aircraftId, targetUserId,
        );
        if (!hasGlobalAdmin) {
          // Restore the row so the aircraft isn't orphaned.
          await supabaseAdmin
            .from('aft_user_aircraft_access')
            .insert({
              user_id: targetUserId,
              aircraft_id: aircraftId,
              aircraft_role: 'admin',
            });
          const msg = targetUserId === user.id
            ? 'Cannot remove yourself — no other admins remain. Promote another pilot first, or add a global admin to the aircraft.'
            : 'Cannot remove the only remaining admin. Promote another pilot first, or add a global admin to the aircraft.';
          return NextResponse.json({ error: msg }, { status: 409 });
        }
      }
    }

    const ok = { success: true };
    await idem.save(200, ok);
    return NextResponse.json(ok);
  } catch (error) {
    return handleApiError(error, req);
  }
}

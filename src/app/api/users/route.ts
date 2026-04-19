import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

export async function DELETE(req: Request) {
  try {
    // SECURITY: Only admins can delete users
    const { user, supabaseAdmin } = await requireAuth(req, 'admin');
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required.' }, { status: 400 });
    }

    // Prevent admins from accidentally deleting themselves
    if (userId === user.id) {
      return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
    }

    // Block deletion if the target is the sole admin on any aircraft.
    // Without this, deleting them would leave the aircraft with zero
    // admins — the remaining pilots can't edit it and nobody can
    // recover it without direct DB access. Force the deleter to
    // promote a replacement first.
    const { data: targetAdminAircraft } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('aircraft_id')
      .eq('user_id', userId)
      .eq('aircraft_role', 'admin');

    for (const row of targetAdminAircraft || []) {
      const { data: admins } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('user_id')
        .eq('aircraft_id', row.aircraft_id)
        .eq('aircraft_role', 'admin');
      if ((admins?.length ?? 0) <= 1) {
        // Pull the tail for a more helpful error.
        const { data: ac } = await supabaseAdmin
          .from('aft_aircraft').select('tail_number').eq('id', row.aircraft_id).maybeSingle();
        return NextResponse.json(
          { error: `This user is the only admin on ${ac?.tail_number ?? 'an aircraft'}. Promote another pilot on that aircraft before deleting.` },
          { status: 400 },
        );
      }
    }

    // FK cascades today (migrations 005 / 006 / 007 / 008 / 020 / 028):
    //   CASCADE    — user_preferences, rate_limit, chuck/howard threads +
    //                messages, idempotency_keys (ephemeral data, OK to drop)
    //   SET NULL   — flight_logs.user_id, squawks.reported_by, notes.user_id,
    //                documents.user_id (history preserved, author becomes
    //                anonymous)
    //   NO ACTION  — audit columns with no ON DELETE clause (deleted_by,
    //                locked_by, proposed_actions.user_id, etc.). These will
    //                BLOCK the deletion if the user has touched those rows;
    //                the error bubbles up through the catch below. A future
    //                migration should give these explicit SET NULL / CASCADE
    //                rules — see project_audit_2026_04_19.md follow-ups.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

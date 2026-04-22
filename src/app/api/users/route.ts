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

    // FK cascade behavior (migrations 005 / 006 / 007 / 008 / 009 /
    // 012 / 013 / 014 / 015 / 020 / 028 / 035):
    //   CASCADE   — user_preferences, rate_limit, chuck/howard threads,
    //               idempotency_keys, aft_proposed_actions.user_id
    //               (thread-scoped content that should die with the user).
    //   SET NULL  — every audit / authorship column (`*_by`, historical
    //               user_id on logs/docs/notes/squawks). Migration 035
    //               replaced the default NO ACTION on these so the
    //               deletion doesn't throw when the user has touched
    //               audit-tracked rows.
    // The sole-admin guard above still blocks the case where deletion
    // would leave an aircraft unrecoverable.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

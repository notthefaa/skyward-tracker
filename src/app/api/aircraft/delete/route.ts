import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';
import { setAppUser, SOFT_DELETE_TABLES } from '@/lib/audit';

// Tables that carry an aircraft_id FK and should be soft-deleted when the
// aircraft itself is soft-deleted. Kept narrow: retention-critical tables
// only. User access grants and Chuck threads stay hard-delete.
const CASCADE_TABLES = [
  'aft_flight_logs',
  'aft_maintenance_items',
  'aft_maintenance_events',
  'aft_squawks',
  'aft_vor_checks',
  'aft_tire_checks',
  'aft_oil_logs',
  'aft_notes',
  'aft_documents',
];

export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId } = await req.json();

    if (!aircraftId) {
      return NextResponse.json({ error: 'Aircraft ID is required.' }, { status: 400 });
    }

    // Verify the aircraft exists (and isn't already soft-deleted)
    const { data: aircraft, error: acErr } = await supabaseAdmin
      .from('aft_aircraft')
      .select('id, tail_number, created_by, deleted_at')
      .eq('id', aircraftId)
      .single();

    if (acErr || !aircraft) {
      return NextResponse.json({ error: 'Aircraft not found.' }, { status: 404 });
    }
    if (aircraft.deleted_at) {
      return NextResponse.json({ error: 'Aircraft already deleted.' }, { status: 410 });
    }

    // Permission check: global admin OR aircraft admin for this aircraft
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
        return NextResponse.json(
          { error: 'Only global admins and aircraft admins can delete aircraft.' },
          { status: 403 }
        );
      }
    }

    // Attribute all the about-to-happen soft-deletes to the caller.
    await setAppUser(supabaseAdmin, user.id);

    const now = new Date().toISOString();

    // Soft-delete child records first so historical queries scoped to the
    // aircraft stop returning them once the parent is gone.
    for (const table of CASCADE_TABLES) {
      if (!SOFT_DELETE_TABLES.has(table)) continue;
      await supabaseAdmin
        .from(table)
        .update({ deleted_at: now, deleted_by: user.id })
        .eq('aircraft_id', aircraftId)
        .is('deleted_at', null);
    }

    // Soft-delete the aircraft itself.
    const { error: deleteError } = await supabaseAdmin
      .from('aft_aircraft')
      .update({ deleted_at: now, deleted_by: user.id })
      .eq('id', aircraftId);

    if (deleteError) throw deleteError;

    // Hard-delete the access grants — users shouldn't still see a
    // soft-deleted aircraft in their list. History is captured in
    // aft_record_history via trigger on aft_aircraft.
    await supabaseAdmin
      .from('aft_user_aircraft_access')
      .delete()
      .eq('aircraft_id', aircraftId);

    return NextResponse.json({ success: true, tailNumber: aircraft.tail_number });
  } catch (error) {
    return handleApiError(error);
  }
}

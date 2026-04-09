import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId } = await req.json();

    if (!aircraftId) {
      return NextResponse.json({ error: 'Aircraft ID is required.' }, { status: 400 });
    }

    // Verify the aircraft exists
    const { data: aircraft, error: acErr } = await supabaseAdmin
      .from('aft_aircraft')
      .select('id, tail_number, created_by')
      .eq('id', aircraftId)
      .single();

    if (acErr || !aircraft) {
      return NextResponse.json({ error: 'Aircraft not found.' }, { status: 404 });
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

    // Delete the aircraft — cascades to flight logs, MX items, squawks,
    // notes, events, access records, and reservations via ON DELETE CASCADE
    const { error: deleteError } = await supabaseAdmin
      .from('aft_aircraft')
      .delete()
      .eq('id', aircraftId);

    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true, tailNumber: aircraft.tail_number });
  } catch (error) {
    return handleApiError(error);
  }
}

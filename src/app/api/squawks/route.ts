import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { idempotency } from '@/lib/idempotency';

// POST — report squawk (any user with aircraft access)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const idem = idempotency(supabaseAdmin, user.id, req, 'squawks/POST');
    const cached = await idem.check();
    if (cached) return cached;

    const { aircraftId, squawkData } = await req.json();
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    await setAppUser(supabaseAdmin, user.id);
    const { data, error } = await supabaseAdmin.from('aft_squawks').insert({ ...squawkData, aircraft_id: aircraftId }).select().single();
    if (error) throw error;

    const body = { success: true, squawk: data };
    await idem.save(200, body);
    return NextResponse.json(body);
  } catch (error) { return handleApiError(error); }
}

// PUT — edit or resolve squawk (author or aircraft admin).
// SECURITY: we MUST verify the squawk's aircraft_id matches the caller-
// supplied aircraftId before the admin check, otherwise an admin on
// Aircraft A could supply their own aircraftId + Aircraft B's squawk ID
// and pass the admin-on-aircraftId gate while editing B's squawk.
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { squawkId, aircraftId, squawkData } = await req.json();
    if (!squawkId || !aircraftId) return NextResponse.json({ error: 'Squawk ID and Aircraft ID required.' }, { status: 400 });

    const { data: squawk } = await supabaseAdmin
      .from('aft_squawks')
      .select('reported_by, aircraft_id, deleted_at')
      .eq('id', squawkId)
      .maybeSingle();
    if (!squawk || squawk.deleted_at) return NextResponse.json({ error: 'Squawk not found.' }, { status: 404 });
    if (squawk.aircraft_id !== aircraftId) {
      return NextResponse.json({ error: 'Squawk does not belong to the given aircraft.' }, { status: 403 });
    }

    const isAuthor = squawk.reported_by === user.id;
    if (!isAuthor) {
      await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    } else {
      // Author still needs read access on the aircraft to edit their own
      // squawk — guards against an access grant being revoked mid-session.
      await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);
    }

    await setAppUser(supabaseAdmin, user.id);
    const { error } = await supabaseAdmin.from('aft_squawks').update(squawkData).eq('id', squawkId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — soft-delete squawk (author or aircraft admin). Same
// aircraft_id-verification story as PUT above.
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { squawkId, aircraftId } = await req.json();
    if (!squawkId || !aircraftId) return NextResponse.json({ error: 'Squawk ID and Aircraft ID required.' }, { status: 400 });

    const { data: squawk } = await supabaseAdmin
      .from('aft_squawks')
      .select('reported_by, aircraft_id, deleted_at')
      .eq('id', squawkId)
      .maybeSingle();
    if (!squawk || squawk.deleted_at) return NextResponse.json({ error: 'Squawk not found.' }, { status: 404 });
    if (squawk.aircraft_id !== aircraftId) {
      return NextResponse.json({ error: 'Squawk does not belong to the given aircraft.' }, { status: 403 });
    }

    const isAuthor = squawk.reported_by === user.id;
    if (!isAuthor) {
      await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    } else {
      await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);
    }

    await setAppUser(supabaseAdmin, user.id);
    const { error } = await supabaseAdmin
      .from('aft_squawks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', squawkId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

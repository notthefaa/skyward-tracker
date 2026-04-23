import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { idempotency } from '@/lib/idempotency';
import { stripProtectedFields } from '@/lib/validation';

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
    // Strip server-owned fields, then set aircraft_id + reported_by
    // authoritatively so a client can't spoof authorship or drop a
    // squawk onto a different aircraft by sneaking the fields into
    // the payload.
    const safeSquawk = stripProtectedFields(squawkData);
    const { data, error } = await supabaseAdmin
      .from('aft_squawks')
      .insert({ ...safeSquawk, aircraft_id: aircraftId, reported_by: user.id })
      .select()
      .single();
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
    // Strip server-owned fields so a PUT can't migrate the squawk to
    // a different aircraft (bypassing the access check above), resurrect
    // a soft-delete, or reassign reported_by.
    const safeUpdate = stripProtectedFields(squawkData);
    const { error } = await supabaseAdmin.from('aft_squawks').update(safeUpdate).eq('id', squawkId);
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

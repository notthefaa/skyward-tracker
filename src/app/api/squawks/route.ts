import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';

// POST — report squawk (any user with aircraft access)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, squawkData } = await req.json();
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    const { data, error } = await supabaseAdmin.from('aft_squawks').insert({ ...squawkData, aircraft_id: aircraftId }).select().single();
    if (error) throw error;

    return NextResponse.json({ success: true, squawk: data });
  } catch (error) { return handleApiError(error); }
}

// PUT — edit or resolve squawk (author or aircraft admin)
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { squawkId, aircraftId, squawkData } = await req.json();
    if (!squawkId || !aircraftId) return NextResponse.json({ error: 'Squawk ID and Aircraft ID required.' }, { status: 400 });

    const { data: squawk } = await supabaseAdmin.from('aft_squawks').select('reported_by').eq('id', squawkId).single();
    if (!squawk) return NextResponse.json({ error: 'Squawk not found.' }, { status: 404 });

    const isAuthor = squawk.reported_by === user.id;
    if (!isAuthor) {
      await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    }

    const { error } = await supabaseAdmin.from('aft_squawks').update(squawkData).eq('id', squawkId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — delete squawk (author or aircraft admin)
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { squawkId, aircraftId } = await req.json();
    if (!squawkId || !aircraftId) return NextResponse.json({ error: 'Squawk ID and Aircraft ID required.' }, { status: 400 });

    const { data: squawk } = await supabaseAdmin.from('aft_squawks').select('reported_by').eq('id', squawkId).single();
    if (!squawk) return NextResponse.json({ error: 'Squawk not found.' }, { status: 404 });

    const isAuthor = squawk.reported_by === user.id;
    if (!isAuthor) {
      await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    }

    const { error } = await supabaseAdmin.from('aft_squawks').delete().eq('id', squawkId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

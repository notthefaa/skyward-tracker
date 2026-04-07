import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';

// POST — create flight log (any user with aircraft access)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, logData, aircraftUpdate } = await req.json();
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    await supabaseAdmin.from('aft_flight_logs').insert({ ...logData, aircraft_id: aircraftId, user_id: user.id });
    await supabaseAdmin.from('aft_aircraft').update(aircraftUpdate).eq('id', aircraftId);

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// PUT — edit flight log (admin only)
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { logId, aircraftId, logData, aircraftUpdate } = await req.json();
    if (!logId || !aircraftId) return NextResponse.json({ error: 'Log ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    await supabaseAdmin.from('aft_flight_logs').update(logData).eq('id', logId);
    await supabaseAdmin.from('aft_aircraft').update(aircraftUpdate).eq('id', aircraftId);

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — delete latest flight log (admin only)
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { logId, aircraftId, aircraftUpdate } = await req.json();
    if (!logId || !aircraftId) return NextResponse.json({ error: 'Log ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    await supabaseAdmin.from('aft_flight_logs').delete().eq('id', logId);
    await supabaseAdmin.from('aft_aircraft').update(aircraftUpdate).eq('id', aircraftId);

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

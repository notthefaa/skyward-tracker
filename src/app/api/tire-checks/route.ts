import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';

// POST — create tire check (any user with aircraft access)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, logData } = await req.json();
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    if (!logData || typeof logData !== 'object') return NextResponse.json({ error: 'Invalid log data.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    const { nose_psi, left_main_psi, right_main_psi, initials, notes } = logData;
    if (!initials || typeof initials !== 'string') return NextResponse.json({ error: 'Initials are required.' }, { status: 400 });

    const fields: Array<[string, any]> = [
      ['nose_psi', nose_psi],
      ['left_main_psi', left_main_psi],
      ['right_main_psi', right_main_psi],
    ];
    for (const [field, value] of fields) {
      const num = Number(value);
      if (Number.isNaN(num) || num < 0) return NextResponse.json({ error: `Invalid ${field}: must be a non-negative number.` }, { status: 400 });
    }

    await supabaseAdmin.from('aft_tire_checks').insert({
      aircraft_id: aircraftId,
      user_id: user.id,
      nose_psi: Number(nose_psi),
      left_main_psi: Number(left_main_psi),
      right_main_psi: Number(right_main_psi),
      initials: initials.trim().toUpperCase(),
      notes: notes?.trim() || null,
    });

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — delete tire check (admin only)
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { logId, aircraftId } = await req.json();
    if (!logId || !aircraftId) return NextResponse.json({ error: 'Log ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    await supabaseAdmin.from('aft_tire_checks').delete().eq('id', logId);
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

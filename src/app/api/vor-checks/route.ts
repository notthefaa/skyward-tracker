import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';

const VOR_TOLERANCES: Record<string, number> = {
  'VOT': 4,
  'Ground Checkpoint': 4,
  'Airborne Checkpoint': 6,
  'Dual VOR': 4,
};

const VALID_TYPES = Object.keys(VOR_TOLERANCES);

// POST — create VOR check (any user with aircraft access)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, logData } = await req.json();
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    if (!logData || typeof logData !== 'object') return NextResponse.json({ error: 'Invalid log data.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    const { check_type, station, bearing_error, initials } = logData;
    if (!VALID_TYPES.includes(check_type)) return NextResponse.json({ error: 'Invalid check type.' }, { status: 400 });
    if (!station || typeof station !== 'string') return NextResponse.json({ error: 'Station/place is required.' }, { status: 400 });
    if (!initials || typeof initials !== 'string') return NextResponse.json({ error: 'Initials are required.' }, { status: 400 });
    const error = Number(bearing_error);
    if (Number.isNaN(error)) return NextResponse.json({ error: 'Bearing error must be a number.' }, { status: 400 });

    const tolerance = VOR_TOLERANCES[check_type];
    const passed = Math.abs(error) <= tolerance;

    await setAppUser(supabaseAdmin, user.id);
    await supabaseAdmin.from('aft_vor_checks').insert({
      aircraft_id: aircraftId,
      user_id: user.id,
      check_type,
      station: station.trim(),
      bearing_error: error,
      tolerance,
      passed,
      initials: initials.trim().toUpperCase(),
    });

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — soft-delete VOR check (admin only)
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { logId, aircraftId } = await req.json();
    if (!logId || !aircraftId) return NextResponse.json({ error: 'Log ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    await setAppUser(supabaseAdmin, user.id);
    await supabaseAdmin
      .from('aft_vor_checks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', logId);
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

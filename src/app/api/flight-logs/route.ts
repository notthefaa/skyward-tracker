import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';

// Ensure numeric fields on a log payload are non-negative. Returns an error
// message on the first violation, or null if the payload is clean.
function validateLogData(logData: any): string | null {
  if (!logData || typeof logData !== 'object') return 'Invalid log data.';
  const nonNegative: Array<[string, any]> = [
    ['landings', logData.landings],
    ['engine_cycles', logData.engine_cycles],
    ['tach', logData.tach],
    ['ftt', logData.ftt],
    ['hobbs', logData.hobbs],
    ['aftt', logData.aftt],
    ['fuel_gallons', logData.fuel_gallons],
  ];
  for (const [field, value] of nonNegative) {
    if (value === null || value === undefined) continue;
    const num = Number(value);
    if (Number.isNaN(num) || num < 0) return `Invalid ${field}: must be a non-negative number.`;
  }
  return null;
}

// POST — create flight log (any user with aircraft access)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, logData, aircraftUpdate } = await req.json();
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    const validationError = validateLogData(logData);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    await supabaseAdmin.from('aft_flight_logs').insert({ ...logData, aircraft_id: aircraftId, user_id: user.id });
    if (aircraftUpdate && Object.keys(aircraftUpdate).length > 0) {
      await supabaseAdmin.from('aft_aircraft').update(aircraftUpdate).eq('id', aircraftId);
    }

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// PUT — edit flight log (admin only)
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { logId, aircraftId, logData, aircraftUpdate } = await req.json();
    if (!logId || !aircraftId) return NextResponse.json({ error: 'Log ID and Aircraft ID required.' }, { status: 400 });
    const validationError = validateLogData(logData);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    await supabaseAdmin.from('aft_flight_logs').update(logData).eq('id', logId);
    if (aircraftUpdate && Object.keys(aircraftUpdate).length > 0) {
      await supabaseAdmin.from('aft_aircraft').update(aircraftUpdate).eq('id', aircraftId);
    }

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

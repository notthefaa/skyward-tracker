import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { friendlyPgError } from '@/lib/pgErrors';

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

// POST — create flight log atomically (any user with aircraft access).
// Uses log_flight_atomic RPC: locks the aircraft row, enforces monotonicity
// + sanity bounds, and updates totals in a single transaction so two
// simultaneous writers can't clobber aircraft hours.
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, logData, aircraftUpdate } = await req.json();
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    const validationError = validateLogData(logData);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    const { error: rpcErr } = await supabaseAdmin.rpc('log_flight_atomic', {
      p_aircraft_id: aircraftId,
      p_user_id: user.id,
      p_log_data: logData ?? {},
      p_aircraft_update: aircraftUpdate ?? {},
    });
    if (rpcErr) {
      // P0001 = check violation (monotonicity / sanity bound) — show to user.
      // P0002 = aircraft not found.
      const status = rpcErr.code === 'P0002' ? 404 : rpcErr.code === 'P0001' ? 400 : 500;
      return NextResponse.json({ error: friendlyPgError(rpcErr) }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// PUT — edit flight log (admin only). Uses edit_flight_log_atomic RPC so
// the log and aircraft-totals updates land in a single transaction; a
// failure on either rolls back both.
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { logId, aircraftId, logData, aircraftUpdate } = await req.json();
    if (!logId || !aircraftId) return NextResponse.json({ error: 'Log ID and Aircraft ID required.' }, { status: 400 });
    const validationError = validateLogData(logData);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    const { error: rpcErr } = await supabaseAdmin.rpc('edit_flight_log_atomic', {
      p_log_id: logId,
      p_aircraft_id: aircraftId,
      p_user_id: user.id,
      p_log_data: logData ?? {},
      p_aircraft_update: aircraftUpdate ?? {},
    });
    if (rpcErr) {
      const status = rpcErr.code === 'P0002' ? 404 : rpcErr.code === 'P0001' ? 400 : 500;
      return NextResponse.json({ error: friendlyPgError(rpcErr) }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — soft-delete flight log (admin only). Uses delete_flight_log_atomic
// RPC so the soft-delete and the aircraft-totals rollback land in one
// transaction — a failure on either rolls back both. The row stays in
// the DB for retention; the trigger logs the operation in aft_record_history.
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { logId, aircraftId, aircraftUpdate } = await req.json();
    if (!logId || !aircraftId) return NextResponse.json({ error: 'Log ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    const { error: rpcErr } = await supabaseAdmin.rpc('delete_flight_log_atomic', {
      p_log_id: logId,
      p_aircraft_id: aircraftId,
      p_user_id: user.id,
      p_aircraft_update: aircraftUpdate ?? {},
    });
    if (rpcErr) {
      const status = rpcErr.code === 'P0002' ? 404 : rpcErr.code === 'P0001' ? 400 : 500;
      return NextResponse.json({ error: friendlyPgError(rpcErr) }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

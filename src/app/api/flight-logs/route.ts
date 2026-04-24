import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { friendlyPgError } from '@/lib/pgErrors';
import { idempotency } from '@/lib/idempotency';
import { apiErrorCoded, handleCodedError } from '@/lib/apiResponse';
import {
  validateFlightLogInput,
  submitFlightLog,
} from '@/lib/submissions';
import { requireAircraftAccessCoded } from '@/lib/submissionAuth';

// POST — create flight log atomically (any user with aircraft access).
// Uses log_flight_atomic RPC: locks the aircraft row, derives aircraft
// totals from the latest-by-occurred_at log (self-healing on out-of-
// order replay), and enforces a 24hr single-leg sanity bound against
// the prior-by-occurred_at log rather than the current aircraft max —
// so a companion-app offline flush of an older leg doesn't bounce
// because some newer leg already landed.
//
// Idempotency: client sends `X-Idempotency-Key` (UUID per submission);
// a repeat of the same key within 1hr returns the cached response
// instead of inserting a duplicate. See src/lib/idempotency.ts.
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const idem = idempotency(supabaseAdmin, user.id, req, 'flight-logs/POST');
    const cached = await idem.check();
    if (cached) return cached;

    const { aircraftId, logData, aircraftUpdate } = await req.json();
    if (!aircraftId) {
      return apiErrorCoded('AIRCRAFT_ID_REQUIRED', 'Aircraft ID required.', 400, req);
    }
    const input = validateFlightLogInput(logData);
    await requireAircraftAccessCoded(supabaseAdmin, user.id, aircraftId);

    const result = await submitFlightLog(
      supabaseAdmin,
      user.id,
      aircraftId,
      input,
      aircraftUpdate ?? {},
    );

    const body = { success: true, logId: result.logId, isLatest: result.isLatest };
    await idem.save(200, body);
    return NextResponse.json(body);
  } catch (error) { return handleCodedError(error, req); }
}

// PUT — edit flight log (admin only). Uses edit_flight_log_atomic RPC
// so the log + aircraft-totals update land in a single transaction;
// totals self-derive from the latest-by-occurred_at log after the edit.
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { logId, aircraftId, logData, aircraftUpdate } = await req.json();
    if (!logId || !aircraftId) return NextResponse.json({ error: 'Log ID and Aircraft ID required.' }, { status: 400 });
    const input = validateFlightLogInput(logData);
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    const { error: rpcErr } = await supabaseAdmin.rpc('edit_flight_log_atomic', {
      p_log_id: logId,
      p_aircraft_id: aircraftId,
      p_user_id: user.id,
      p_log_data: input ?? {},
      p_aircraft_update: aircraftUpdate ?? {},
    });
    if (rpcErr) {
      const status = rpcErr.code === 'P0002' ? 404 : rpcErr.code === 'P0001' ? 400 : 500;
      return NextResponse.json({ error: friendlyPgError(rpcErr) }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — soft-delete flight log (admin only). Aircraft totals self-
// derive from the remaining latest-by-occurred_at log after the delete.
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

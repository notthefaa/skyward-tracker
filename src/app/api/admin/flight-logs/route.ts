import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { handleCodedError } from '@/lib/apiResponse';
import { validateFlightLogInput, submitFlightLog } from '@/lib/submissions';

// POST — admin-only insertion of a missing flight log. Mirrors
// /api/flight-logs but gated to global admin and skips the idempotency
// + rate-limit dance (admin-only is low-volume, every backdated insert
// should land deterministically). Reuses log_flight_atomic so totals
// self-derive from the latest-by-occurred_at log; a backdated entry
// that lands between two existing logs becomes a middle row and the
// aircraft aggregate stays anchored on whichever log is actually
// latest. The 24hr per-leg sanity guard still fires against the
// prior-by-occurred_at neighbor, which is the correct check for a
// backdated insert.
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req, 'admin');
    const { aircraftId, logData } = await req.json();
    if (!aircraftId) {
      return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    }
    const input = validateFlightLogInput(logData);
    // Empty aircraftUpdate: the RPC re-derives totals from the
    // latest-by-occurred_at log, so a backdated middle insert must
    // NOT overwrite current totals with its older reading.
    const result = await submitFlightLog(
      supabaseAdmin,
      user.id,
      aircraftId,
      input,
      {},
    );
    return NextResponse.json({ success: true, logId: result.logId, isLatest: result.isLatest });
  } catch (error) {
    return handleCodedError(error, req);
  }
}

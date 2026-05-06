import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { handleCodedError } from '@/lib/apiResponse';
import { validateFlightLogInput, submitFlightLog } from '@/lib/submissions';
import { idempotency } from '@/lib/idempotency';

// POST — admin-only insertion of a missing flight log. Mirrors
// /api/flight-logs but gated to global admin. Reuses log_flight_atomic
// so totals self-derive from the latest-by-occurred_at log; a
// backdated entry that lands between two existing logs becomes a
// middle row and the aircraft aggregate stays anchored on whichever
// log is actually latest. The 24hr per-leg sanity guard still fires
// against the prior-by-occurred_at neighbor, which is the correct
// check for a backdated insert.
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req, 'admin');
    const { aircraftId, logData } = await req.json();
    if (!aircraftId) {
      return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    }

    // Idempotency — admin double-tap on the Insert Missing Flight Log
    // form would otherwise create phantom-dups (one becomes the
    // "latest" and clobbers the previously-anchored aircraft totals).
    // Same X-Idempotency-Key replays cached {logId, isLatest}.
    const idem = idempotency(supabaseAdmin, user.id, req, 'admin/flight-logs');
    const cached = await idem.check();
    if (cached) return cached;

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
    const responseBody = { success: true, logId: result.logId, isLatest: result.isLatest };
    await idem.save(200, responseBody);
    return NextResponse.json(responseBody);
  } catch (error) {
    return handleCodedError(error, req);
  }
}

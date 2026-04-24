import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { idempotency } from '@/lib/idempotency';
import { apiErrorCoded, handleCodedError } from '@/lib/apiResponse';
import { validateVorCheckInput, submitVorCheck } from '@/lib/submissions';
import { requireAircraftAccessCoded } from '@/lib/submissionAuth';

// POST — create VOR check (any user with aircraft access).
// Companion-app queue contract:
//   * occurred_at (ISO datetime with tz) pins FAR 91.171 expiry math
//     to when the check was actually performed, not when the server
//     saw the request. A 29-day-old offline submission can't silently
//     be recorded as fresh.
//   * X-Idempotency-Key header makes retries safe — repeats return
//     the cached response, no duplicate row.
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const idem = idempotency(supabaseAdmin, user.id, req, 'vor-checks/POST');
    const cached = await idem.check();
    if (cached) return cached;

    const { aircraftId, logData } = await req.json();
    if (!aircraftId) {
      return apiErrorCoded('AIRCRAFT_ID_REQUIRED', 'Aircraft ID required.', 400, req);
    }
    const input = validateVorCheckInput(logData);
    await requireAircraftAccessCoded(supabaseAdmin, user.id, aircraftId);

    const result = await submitVorCheck(supabaseAdmin, user.id, aircraftId, input);

    const body = { success: true, id: result.id, passed: result.passed };
    await idem.save(200, body);
    return NextResponse.json(body);
  } catch (error) { return handleCodedError(error, req); }
}

// DELETE — soft-delete VOR check (admin only)
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { logId, aircraftId } = await req.json();
    if (!logId || !aircraftId) return NextResponse.json({ error: 'Log ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    await setAppUser(supabaseAdmin, user.id);
    // Guard: admin on aircraft A must not be able to delete logs on B
    // by supplying aircraftId=A plus a foreign logId. Filtering the
    // update by both columns means a mismatched pair updates zero rows
    // and we return 404 instead of silently wiping someone else's data.
    const { data: deleted } = await supabaseAdmin
      .from('aft_vor_checks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', logId)
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (!deleted) return NextResponse.json({ error: 'VOR check not found for this aircraft.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

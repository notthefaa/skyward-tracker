import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { idempotency } from '@/lib/idempotency';
import { apiErrorCoded, handleCodedError } from '@/lib/apiResponse';
import { validateOilLogInput, submitOilLog } from '@/lib/submissions';
import { requireAircraftAccessCoded } from '@/lib/submissionAuth';
import { checkSubmitRateLimit } from '@/lib/submitRateLimit';

// POST — create oil log (any user with aircraft access).
// occurred_at + idempotency contract same as flight-logs / VOR.
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    const rl = await checkSubmitRateLimit(supabaseAdmin, user.id);
    if (!rl.allowed) {
      return apiErrorCoded('RATE_LIMITED', `Too many submissions. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`, 429, req);
    }

    const idem = idempotency(supabaseAdmin, user.id, req, 'oil-logs/POST');
    const cached = await idem.check();
    if (cached) return cached;

    const { aircraftId, logData } = await req.json();
    if (!aircraftId) {
      return apiErrorCoded('AIRCRAFT_ID_REQUIRED', 'Aircraft ID required.', 400, req);
    }
    const input = validateOilLogInput(logData);
    await requireAircraftAccessCoded(supabaseAdmin, user.id, aircraftId);

    const result = await submitOilLog(supabaseAdmin, user.id, aircraftId, input);

    const body = { success: true, id: result.id };
    await idem.save(200, body);
    return NextResponse.json(body);
  } catch (error) { return handleCodedError(error, req); }
}

// DELETE — soft-delete oil log (admin only)
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { logId, aircraftId } = await req.json();
    if (!logId || !aircraftId) return NextResponse.json({ error: 'Log ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    await setAppUser(supabaseAdmin, user.id);
    // Guard: filter by aircraft_id too so admin-on-A can't delete B's logs
    // by mixing aircraftId=A with a foreign logId.
    const { data: deleted, error: deleteErr } = await supabaseAdmin
      .from('aft_oil_logs')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', logId)
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    // Throw on DB errors so a transient supabase failure isn't masked
    // as "not found" — admin would otherwise retry endlessly thinking
    // the log was already gone when the delete actually never landed.
    if (deleteErr) throw deleteErr;
    if (!deleted) return NextResponse.json({ error: 'Oil log not found for this aircraft.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

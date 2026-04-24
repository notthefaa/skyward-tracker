import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { idempotency } from '@/lib/idempotency';
import { stripProtectedFields } from '@/lib/validation';
import { apiErrorCoded, handleCodedError } from '@/lib/apiResponse';
import { validateSquawkInput, submitSquawk } from '@/lib/submissions';
import { requireAircraftAccessCoded } from '@/lib/submissionAuth';
import { checkSubmitRateLimit } from '@/lib/submitRateLimit';

// POST — report squawk (any user with aircraft access).
// occurred_at + idempotency. Mass-assignment still handled by
// stripProtectedFields inside submitSquawk.
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    const rl = await checkSubmitRateLimit(supabaseAdmin, user.id);
    if (!rl.allowed) {
      return apiErrorCoded('RATE_LIMITED', `Too many submissions. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`, 429, req);
    }

    const idem = idempotency(supabaseAdmin, user.id, req, 'squawks/POST');
    const cached = await idem.check();
    if (cached) return cached;

    const { aircraftId, squawkData } = await req.json();
    if (!aircraftId) {
      return apiErrorCoded('AIRCRAFT_ID_REQUIRED', 'Aircraft ID required.', 400, req);
    }
    const input = validateSquawkInput(squawkData);
    await requireAircraftAccessCoded(supabaseAdmin, user.id, aircraftId);

    const result = await submitSquawk(supabaseAdmin, user.id, aircraftId, input);

    const body = { success: true, squawk: result.row };
    await idem.save(200, body);
    return NextResponse.json(body);
  } catch (error) { return handleCodedError(error, req); }
}

// PUT — edit or resolve squawk (author or aircraft admin).
// SECURITY: we MUST verify the squawk's aircraft_id matches the caller-
// supplied aircraftId before the admin check, otherwise an admin on
// Aircraft A could supply their own aircraftId + Aircraft B's squawk ID
// and pass the admin-on-aircraftId gate while editing B's squawk.
//
// Companion-app contract: a resolve-PUT that lands before the create-
// POST (offline queue replayed out of dependency order) returns
// `SQUAWK_NOT_FOUND`. The companion app should retain the resolve in
// the queue and retry after the create succeeds.
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { squawkId, aircraftId, squawkData } = await req.json();
    if (!squawkId || !aircraftId) {
      return apiErrorCoded('VALIDATION_ERROR', 'Squawk ID and Aircraft ID required.', 400, req);
    }

    const { data: squawk } = await supabaseAdmin
      .from('aft_squawks')
      .select('reported_by, aircraft_id, deleted_at')
      .eq('id', squawkId)
      .maybeSingle();
    if (!squawk || squawk.deleted_at) {
      return apiErrorCoded('SQUAWK_NOT_FOUND', 'Squawk not found.', 404, req);
    }
    if (squawk.aircraft_id !== aircraftId) {
      return apiErrorCoded('NO_AIRCRAFT_ACCESS', 'Squawk does not belong to the given aircraft.', 403, req);
    }

    const isAuthor = squawk.reported_by === user.id;
    if (!isAuthor) {
      await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    } else {
      // Author still needs read access on the aircraft to edit their own
      // squawk — guards against an access grant being revoked mid-session.
      await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);
    }

    await setAppUser(supabaseAdmin, user.id);
    // Strip server-owned fields so a PUT can't migrate the squawk to
    // a different aircraft (bypassing the access check above), resurrect
    // a soft-delete, or reassign reported_by.
    const safeUpdate = stripProtectedFields(squawkData);
    const { error } = await supabaseAdmin.from('aft_squawks').update(safeUpdate).eq('id', squawkId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) { return handleCodedError(error, req); }
}

// DELETE — soft-delete squawk (author or aircraft admin). Same
// aircraft_id-verification story as PUT above.
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { squawkId, aircraftId } = await req.json();
    if (!squawkId || !aircraftId) return NextResponse.json({ error: 'Squawk ID and Aircraft ID required.' }, { status: 400 });

    const { data: squawk } = await supabaseAdmin
      .from('aft_squawks')
      .select('reported_by, aircraft_id, deleted_at')
      .eq('id', squawkId)
      .maybeSingle();
    if (!squawk || squawk.deleted_at) return NextResponse.json({ error: 'Squawk not found.' }, { status: 404 });
    if (squawk.aircraft_id !== aircraftId) {
      return NextResponse.json({ error: 'Squawk does not belong to the given aircraft.' }, { status: 403 });
    }

    const isAuthor = squawk.reported_by === user.id;
    if (!isAuthor) {
      await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    } else {
      await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);
    }

    await setAppUser(supabaseAdmin, user.id);
    const { error } = await supabaseAdmin
      .from('aft_squawks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', squawkId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

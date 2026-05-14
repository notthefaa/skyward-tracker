import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { isIsoDate } from '@/lib/validation';
import { idempotency } from '@/lib/idempotency';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const idem = idempotency(supabaseAdmin, user.id, req, 'mx-events/POST');
    const cached = await idem.check();
    if (cached) return cached;

    const { aircraftId, mxItemIds, squawkIds, addonServices, proposedDate } = await req.json();

    if (!aircraftId) {
      return NextResponse.json({ error: 'Aircraft ID is required.' }, { status: 400 });
    }
    if (proposedDate != null && proposedDate !== '' && !isIsoDate(proposedDate)) {
      return NextResponse.json({ error: 'Proposed date must be a valid YYYY-MM-DD date.' }, { status: 400 });
    }

    // Verify the user is an admin for this aircraft
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    await setAppUser(supabaseAdmin, user.id);

    // Single-transaction creation (migration 037). The five writes
    // that used to run sequentially — event insert, three batches
    // of line items, and the initial message — now commit or roll
    // back together, so a partial failure can't leave an orphaned
    // draft with a subset of line items.
    const initialMessage = proposedDate
      ? `Work package created. Preferred date: ${proposedDate}. Ready to send to mechanic.`
      : 'Work package created. Ready to send to mechanic.';

    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('create_mx_event_atomic', {
      p_aircraft_id:    aircraftId,
      p_user_id:        user.id,
      p_proposed_date:  proposedDate || null,
      p_addon_services: addonServices && addonServices.length > 0 ? addonServices : null,
      p_mx_item_ids:    mxItemIds && mxItemIds.length > 0 ? mxItemIds : null,
      p_squawk_ids:     squawkIds && squawkIds.length > 0 ? squawkIds : null,
      p_initial_message: initialMessage,
    });

    if (rpcErr) {
      if (rpcErr.code === 'P0002') {
        return NextResponse.json({ error: 'Aircraft not found.' }, { status: 404 });
      }
      return NextResponse.json({ error: "Couldn't create the maintenance event." }, { status: 500 });
    }

    const body = { success: true, eventId: rpcData as string };
    await idem.save(200, body);
    return NextResponse.json(body);
  } catch (error) {
    return handleApiError(error, req);
  }
}

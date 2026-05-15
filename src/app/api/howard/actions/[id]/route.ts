import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { idempotency } from '@/lib/idempotency';
import { executeAction, type ProposedAction } from '@/lib/howard/proposedActions';

export const dynamic = 'force-dynamic';

// POST /api/howard/actions/[id] — confirm and execute a proposed action
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, supabaseAdmin } = await requireAuth(req);

    // Double-tap protection: same X-Idempotency-Key replays the cached
    // {success, action_id, record} without re-running executeAction.
    // MUST come before the terminal-status guard below — a legitimate
    // network-retry of a successful confirm would otherwise hit the
    // executed-status check (status now='executed') and return 409
    // instead of the cached 200 from the original successful call.
    const idem = idempotency(supabaseAdmin, user.id, req, 'howard/actions/POST');
    const cached = await idem.check();
    if (cached) return cached;

    const { data: action, error: fetchErr } = await supabaseAdmin
      .from('aft_proposed_actions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr || !action) {
      return NextResponse.json({ error: 'Proposed action not found.' }, { status: 404 });
    }
    if (action.user_id !== user.id) {
      return NextResponse.json({ error: 'Not your proposed action.' }, { status: 403 });
    }
    // Retry path: failed actions can be re-attempted from the same endpoint.
    // Pending → new confirm. Failed → retry. Anything else → 409.
    if (action.status !== 'pending' && action.status !== 'failed') {
      return NextResponse.json({ error: `Action already ${action.status}.` }, { status: 409 });
    }

    // Role gate — confirm matches required_role. Onboarding runs before
    // any aircraft access exists for the caller, so it skips the
    // aircraft-scoped check entirely; the executor hard-codes the
    // caller as the new aircraft's admin after the insert.
    if (action.action_type !== 'onboarding_setup') {
      if (action.required_role === 'admin') {
        await requireAircraftAdmin(supabaseAdmin, user.id, action.aircraft_id);
      } else {
        await requireAircraftAccess(supabaseAdmin, user.id, action.aircraft_id);
      }

      // Re-verify the aircraft is still live. requireAircraftAccess /
      // requireAircraftAdmin check user→aircraft membership but not
      // aircraft.deleted_at. A stale propose confirmed AFTER the
      // aircraft was soft-deleted would otherwise insert squawks /
      // notes / reservations into a deleted aircraft, where they'd
      // sit orphaned.
      const { data: ac, error: acErr } = await supabaseAdmin
        .from('aft_aircraft')
        .select('id, deleted_at')
        .eq('id', action.aircraft_id)
        .maybeSingle();
      if (acErr) throw acErr;
      if (!ac || ac.deleted_at) {
        return NextResponse.json({ error: 'That aircraft is no longer available.' }, { status: 410 });
      }
    }

    // Attribute subsequent writes to the user via the audit trigger.
    await setAppUser(supabaseAdmin, user.id);

    // ATOMIC CLAIM. Two devices (phone + laptop) tapping Confirm on
    // the same card each mint their own X-Idempotency-Key, so the
    // idempotency check above doesn't dedupe them. Without the claim,
    // both pass the `status === 'pending'` check higher up, both run
    // executeAction, and the user ends up with two squawks / two
    // notes / two equipment rows. Race-condition double-write.
    //
    // The claim is a single UPDATE atomically transitioning the row
    // from pending|failed → confirmed. Postgres MVCC serializes the
    // two UPDATEs; one returns the row, the other returns zero rows
    // and gets 409. The losing device sees "Action already claimed
    // by another device." and bails.
    //
    // status='confirmed' is the intent marker; the old comment
    // warning about stuck-confirmed (after this comment block) is
    // accepted as the lesser evil — double-write is irrecoverable
    // (duplicate user-visible rows in the DB), stuck-confirmed is
    // admin-recoverable + the side-effect did actually happen.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('aft_proposed_actions')
      .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: user.id })
      .eq('id', id)
      .in('status', ['pending', 'failed'])
      .select('id')
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (!claimed) {
      return NextResponse.json({ error: 'Action already claimed by another device or already resolved.' }, { status: 409 });
    }

    try {
      const result = await executeAction(supabaseAdmin, action as ProposedAction, user.id);
      const { error: updateErr } = await supabaseAdmin
        .from('aft_proposed_actions')
        .update({
          status: 'executed',
          executed_at: new Date().toISOString(),
          executed_record_id: result.recordId,
          executed_record_table: result.recordTable,
          error_message: null,
        })
        .eq('id', id);
      if (updateErr) {
        // Side-effect landed but the bookkeeping didn't. Log and return
        // success so the UI doesn't show a failed card for a change
        // that actually happened — the next GET will reconcile via
        // retry-to-200-OK if bookkeeping eventually recovers.
        console.error('[howard/actions] executed but status update failed', updateErr);
      }

      const responseBody = { success: true, action_id: id, record: result };
      await idem.save(200, responseBody);
      return NextResponse.json(responseBody);
    } catch (execErr: any) {
      // Mark the row as failed so the UI can offer a retry. If even
      // this update fails, surface a warning — leaving the action stuck
      // in `pending` after a real execution failure is the worst state
      // (the user can re-trigger executeAction without knowing it
      // already partially ran).
      const { error: failUpdateErr } = await supabaseAdmin
        .from('aft_proposed_actions')
        .update({ status: 'failed', error_message: execErr?.message || 'Execution failed' })
        .eq('id', id);
      if (failUpdateErr) {
        console.error('[howard/actions] failed to mark action as failed', failUpdateErr);
      }
      return NextResponse.json({ error: execErr?.message || 'Execution failed' }, { status: 500 });
    }
  } catch (error) { return handleApiError(error, req); }
}

// DELETE /api/howard/actions/[id] — cancel a pending proposal
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, supabaseAdmin } = await requireAuth(req);

    // Double-tap protection: same X-Idempotency-Key replays the cached
    // {success:true} without re-running the cancel UPDATE. MUST come
    // before the cancelled-status guard below — a legitimate network-
    // retry of a successful cancel would otherwise hit the cancelled-
    // check (status now='cancelled') and 409 instead of returning the
    // cached 200 from the original successful call.
    const idem = idempotency(supabaseAdmin, user.id, req, 'howard/actions/DELETE');
    const cached = await idem.check();
    if (cached) return cached;

    // Read errors must surface as 500, not 404 — masking a transient DB
    // hit as "not found" would cause the UI to drop the action card on
    // a flake, leaving the user with no way to confirm or cancel.
    const { data: action, error: readErr } = await supabaseAdmin
      .from('aft_proposed_actions')
      .select('id, user_id, status')
      .eq('id', id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!action) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    if (action.user_id !== user.id) return NextResponse.json({ error: 'Not your action.' }, { status: 403 });
    if (action.status !== 'pending') {
      return NextResponse.json({ error: `Action already ${action.status}.` }, { status: 409 });
    }

    const { error: cancelErr } = await supabaseAdmin
      .from('aft_proposed_actions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id);
    if (cancelErr) throw cancelErr;

    const responseBody = { success: true };
    await idem.save(200, responseBody);
    return NextResponse.json(responseBody);
  } catch (error) { return handleApiError(error, req); }
}

// GET /api/howard/actions/[id] — fetch a single action (for the UI card)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, supabaseAdmin } = await requireAuth(req);

    const { data: action, error: readErr } = await supabaseAdmin
      .from('aft_proposed_actions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!action) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    if (action.user_id !== user.id) return NextResponse.json({ error: 'Not your action.' }, { status: 403 });

    return NextResponse.json({ action });
  } catch (error) { return handleApiError(error, req); }
}

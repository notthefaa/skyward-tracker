import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { executeAction, type ProposedAction } from '@/lib/howard/proposedActions';

// POST /api/howard/actions/[id] — confirm and execute a proposed action
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, supabaseAdmin } = await requireAuth(req);

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
    }

    // Attribute subsequent writes to the user via the audit trigger.
    await setAppUser(supabaseAdmin, user.id);

    // Run the side-effect first, then record the outcome as a single
    // status flip. The old flow marked `confirmed` up front (for audit
    // intent) and relied on a second update to set `executed` or
    // `failed`. That left a failure window: if the second update
    // failed the row stayed stuck in `confirmed` — neither retryable
    // nor visibly failed. Single-flip avoids the stuck state; the
    // confirm timestamp is still recorded via confirmed_at on success.
    try {
      const result = await executeAction(supabaseAdmin, action as ProposedAction, user.id);
      const { error: updateErr } = await supabaseAdmin
        .from('aft_proposed_actions')
        .update({
          status: 'executed',
          confirmed_at: new Date().toISOString(),
          confirmed_by: user.id,
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

      return NextResponse.json({
        success: true,
        action_id: id,
        record: result,
      });
    } catch (execErr: any) {
      await supabaseAdmin
        .from('aft_proposed_actions')
        .update({ status: 'failed', error_message: execErr?.message || 'Execution failed' })
        .eq('id', id);
      return NextResponse.json({ error: execErr?.message || 'Execution failed' }, { status: 500 });
    }
  } catch (error) { return handleApiError(error); }
}

// DELETE /api/howard/actions/[id] — cancel a pending proposal
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, supabaseAdmin } = await requireAuth(req);

    const { data: action } = await supabaseAdmin
      .from('aft_proposed_actions')
      .select('id, user_id, status')
      .eq('id', id)
      .maybeSingle();
    if (!action) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    if (action.user_id !== user.id) return NextResponse.json({ error: 'Not your action.' }, { status: 403 });
    if (action.status !== 'pending') {
      return NextResponse.json({ error: `Action already ${action.status}.` }, { status: 409 });
    }

    await supabaseAdmin
      .from('aft_proposed_actions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id);

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// GET /api/howard/actions/[id] — fetch a single action (for the UI card)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, supabaseAdmin } = await requireAuth(req);

    const { data: action } = await supabaseAdmin
      .from('aft_proposed_actions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!action) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    if (action.user_id !== user.id) return NextResponse.json({ error: 'Not your action.' }, { status: 403 });

    return NextResponse.json({ action });
  } catch (error) { return handleApiError(error); }
}

import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { executeAction, type ProposedAction } from '@/lib/chuck/proposedActions';

// POST /api/chuck/actions/[id] — confirm and execute a proposed action
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
    if (action.status !== 'pending') {
      return NextResponse.json({ error: `Action already ${action.status}.` }, { status: 409 });
    }

    // Role gate — confirm matches required_role.
    if (action.required_role === 'admin') {
      await requireAircraftAdmin(supabaseAdmin, user.id, action.aircraft_id);
    } else {
      await requireAircraftAccess(supabaseAdmin, user.id, action.aircraft_id);
    }

    // Attribute subsequent writes to the user via the audit trigger.
    await setAppUser(supabaseAdmin, user.id);

    // Mark confirmed before execution so audit captures the intent.
    await supabaseAdmin
      .from('aft_proposed_actions')
      .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: user.id })
      .eq('id', id);

    try {
      const result = await executeAction(supabaseAdmin, action as ProposedAction, user.id);
      await supabaseAdmin
        .from('aft_proposed_actions')
        .update({
          status: 'executed',
          executed_at: new Date().toISOString(),
          executed_record_id: result.recordId,
          executed_record_table: result.recordTable,
        })
        .eq('id', id);

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

// DELETE /api/chuck/actions/[id] — cancel a pending proposal
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

// GET /api/chuck/actions/[id] — fetch a single action (for the UI card)
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

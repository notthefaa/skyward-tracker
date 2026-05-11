import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { idempotency } from '@/lib/idempotency';

// POST /api/mx-events/close — admin force-close an event without
// running the RPC's per-line completion cascade. Used when remaining
// items are deferred and the owner wants to wrap the event without
// supplying logbook data.
//
// Pre-fix this ran as a direct client UPDATE from ServiceEventDetail
// (`supabase.from('aft_maintenance_events').update({status:'complete'})`),
// with no aircraft_id filter, no audit attribution, no idempotency,
// no cancellation guard. A concurrent cancel from another tab was
// silently overwritten back to 'complete'. Now scoped + audited +
// idempotent + TOCTOU-guarded server-side.
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    const idem = idempotency(supabaseAdmin, user.id, req, 'mx-events/close');
    const cached = await idem.check();
    if (cached) return cached;

    const { eventId } = await req.json();
    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required.' }, { status: 400 });
    }

    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events')
      .select('id, aircraft_id, status, deleted_at')
      .eq('id', eventId)
      .is('deleted_at', null)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!event) {
      return NextResponse.json({ error: 'Maintenance event not found.' }, { status: 404 });
    }

    await requireAircraftAdmin(supabaseAdmin, user.id, event.aircraft_id);

    if (event.status === 'cancelled') {
      return NextResponse.json({ error: 'This event was already cancelled.' }, { status: 409 });
    }
    if (event.status === 'complete') {
      const okBody = { success: true, alreadyClosed: true };
      await idem.save(200, okBody);
      return NextResponse.json(okBody);
    }

    await setAppUser(supabaseAdmin, user.id);

    // count:'exact' + cancelled-guard closes the TOCTOU: a concurrent
    // owner-action cancel landing between the status read and this
    // UPDATE used to be silently overwritten back to 'complete'.
    const { error: updErr, count: updCount } = await supabaseAdmin
      .from('aft_maintenance_events')
      .update({ status: 'complete', completed_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', eventId)
      .eq('aircraft_id', event.aircraft_id)
      .neq('status', 'cancelled')
      .is('deleted_at', null);
    if (updErr) throw updErr;
    if (updCount === 0) {
      return NextResponse.json({ error: 'This event was cancelled by someone else.' }, { status: 409 });
    }

    // System message — throw on error so a status flip without an
    // audit trail doesn't go silently to disk.
    const { error: msgErr } = await supabaseAdmin
      .from('aft_event_messages')
      .insert({
        event_id: eventId,
        sender: 'system',
        message_type: 'status_update',
        message: 'Service event closed. Completed items have been reset. Deferred items remain open.',
      } as any);
    if (msgErr) throw msgErr;

    const okBody = { success: true };
    await idem.save(200, okBody);
    return NextResponse.json(okBody);
  } catch (error) {
    return handleApiError(error);
  }
}

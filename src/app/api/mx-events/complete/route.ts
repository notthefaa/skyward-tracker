import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { parseFiniteNumber } from '@/lib/validation';
import { idempotency } from '@/lib/idempotency';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { eventId, lineCompletions, partial } = await req.json();

    if (!eventId || !lineCompletions || !Array.isArray(lineCompletions)) {
      return NextResponse.json({ error: 'Event ID and line completions are required.' }, { status: 400 });
    }

    // Fetch the event
    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events').select('*').eq('id', eventId).is('deleted_at', null).maybeSingle();

    if (evErr || !event) {
      return NextResponse.json({ error: 'Maintenance event not found.' }, { status: 404 });
    }

    // Verify the user is an admin for this aircraft
    await requireAircraftAdmin(supabaseAdmin, user.id, event.aircraft_id);
    await setAppUser(supabaseAdmin, user.id);

    // Idempotency — a slow-network double-tap on "Complete Event"
    // would otherwise re-run the atomic RPC and double-advance MX
    // intervals + duplicate squawk-resolves. The cleaned-completions
    // payload below is deterministic, so a same-key replay returns
    // the cached {allResolved, unmatchedIds} without re-applying.
    // MUST come before the cancelled-status guard below so a retry of
    // a successful complete returns cached 200 instead of a fresh 409.
    const idem = idempotency(supabaseAdmin, user.id, req, 'mx-events/complete');
    const cached = await idem.check();
    if (cached) return cached;

    // Cancel is terminal. The owner-action route rotates the
    // access_token at cancel time so the mechanic's portal link is
    // already dead — letting Complete advance MX intervals + resolve
    // squawks here would silently undo the cancel and leave the
    // mechanic out of sync. Mirrors the symmetric guard in
    // owner-action/route.ts and respond/route.ts:67.
    if (event.status === 'cancelled') {
      return NextResponse.json({ error: 'This event was already cancelled.' }, { status: 409 });
    }

    // Pre-validate finite numeric fields in every completion so the
    // API returns a clean 400 with a pointer to the bad item instead
    // of burying the failure inside the RPC. The RPC trusts valid
    // input; the loop here is the boundary check.
    const cleanedCompletions: any[] = [];
    for (const completion of lineCompletions) {
      const {
        lineItemId, completionDate, completionTime,
        completedByName, workDescription,
        certType, certNumber, certExpiry,
        tachAtCompletion, hobbsAtCompletion, logbookRef,
      } = completion;

      const completionTimeNum = parseFiniteNumber(completionTime, { min: 0 });
      const tachNum  = parseFiniteNumber(tachAtCompletion,  { min: 0 });
      const hobbsNum = parseFiniteNumber(hobbsAtCompletion, { min: 0 });
      if (completionTimeNum === undefined || tachNum === undefined || hobbsNum === undefined) {
        return NextResponse.json(
          { error: 'completion_time / tach_at_completion / hobbs_at_completion must be a non-negative finite number.' },
          { status: 400 },
        );
      }

      cleanedCompletions.push({
        lineItemId,
        completionDate: completionDate || null,
        // Pass as string so the JSONB payload keeps it numeric. `null`
        // lets the RPC's NULLIF(...)::numeric produce a SQL NULL cleanly.
        completionTime: completionTimeNum != null ? String(completionTimeNum) : null,
        completedByName: completedByName || null,
        workDescription: workDescription || null,
        certType: certType || null,
        certNumber: certNumber || null,
        certExpiry: certExpiry || null,
        tachAtCompletion:  tachNum  != null ? String(tachNum)  : null,
        hobbsAtCompletion: hobbsNum != null ? String(hobbsNum) : null,
        logbookRef: logbookRef || null,
      });
    }

    // Single-transaction apply (migration 037). Line-item updates,
    // MX-item interval advances, squawk resolves, event status flip,
    // and summary message all commit or roll back together — a
    // mid-loop failure can't leave half-finished completions behind.
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('complete_mx_event_atomic', {
      p_event_id:    eventId,
      p_user_id:     user.id,
      p_completions: cleanedCompletions,
      p_partial:     !!partial,
    });
    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message || "Couldn't apply completions." }, { status: 500 });
    }

    const allResolved = !!(rpcData as any)?.all_resolved;
    // Migration 049 returns unmatched_ids so the UI can surface a
    // "1 line item was unknown" toast when stale tabs or fabricated
    // ids slip through. Empty array on the happy path.
    const unmatchedIds = Array.isArray((rpcData as any)?.unmatched_ids)
      ? (rpcData as any).unmatched_ids as string[]
      : [];
    const responseBody = { success: true, allResolved, unmatchedIds };
    await idem.save(200, responseBody);
    return NextResponse.json(responseBody);
  } catch (error) {
    return handleApiError(error, req);
  }
}

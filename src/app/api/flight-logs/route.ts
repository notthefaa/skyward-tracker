import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { friendlyPgError } from '@/lib/pgErrors';
import { idempotency } from '@/lib/idempotency';
import { apiErrorCoded, handleCodedError } from '@/lib/apiResponse';
import {
  validateFlightLogInput,
  submitFlightLog,
} from '@/lib/submissions';
import { requireAircraftAccessCoded } from '@/lib/submissionAuth';
import { checkSubmitRateLimit } from '@/lib/submitRateLimit';

/**
 * GET /api/flight-logs?aircraftId=...&page=N&pageSize=10
 *   OR  ?aircraftId=...&neighbor=prev|next&pivotOccurred=...&pivotCreated=...
 *
 * Two read modes for TimesTab:
 *   1. Paginated history (default). Returns `{ logs, hasMore }` using
 *      the "fetch pageSize+1" pattern — avoids COUNT(*) which wedges
 *      iOS sockets. Default page=1, pageSize=10 (capped at 50).
 *   2. Neighbor lookup. For edit-validation: pass `neighbor=prev` or
 *      `neighbor=next` plus the editing log's `pivotOccurred` /
 *      `pivotCreated` timestamps. Returns `{ neighbor }` (single row
 *      or null). Used to validate the edit doesn't overshoot a
 *      newer log's totals.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const aircraftId = url.searchParams.get('aircraftId');
    if (!aircraftId) return NextResponse.json({ error: 'aircraftId required' }, { status: 400 });

    const { user, supabaseAdmin } = await requireAuth(req);
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    const neighbor = url.searchParams.get('neighbor');
    if (neighbor === 'prev' || neighbor === 'next') {
      const pivotOccurred = url.searchParams.get('pivotOccurred');
      const pivotCreated = url.searchParams.get('pivotCreated');
      if (!pivotOccurred || !pivotCreated) {
        return NextResponse.json({ error: 'pivotOccurred + pivotCreated required for neighbor lookups' }, { status: 400 });
      }
      const orFilter = neighbor === 'prev'
        ? `occurred_at.lt.${pivotOccurred},and(occurred_at.eq.${pivotOccurred},created_at.lt.${pivotCreated})`
        : `occurred_at.gt.${pivotOccurred},and(occurred_at.eq.${pivotOccurred},created_at.gt.${pivotCreated})`;
      const ascending = neighbor === 'next';
      const { data, error } = await supabaseAdmin
        .from('aft_flight_logs')
        .select('*')
        .eq('aircraft_id', aircraftId)
        .is('deleted_at', null)
        .or(orFilter)
        .order('occurred_at', { ascending })
        .order('created_at', { ascending })
        .limit(1);
      if (error) throw error;
      return NextResponse.json({ neighbor: (data && data[0]) || null });
    }

    const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10) || 1, 1);
    const pageSizeParam = parseInt(url.searchParams.get('pageSize') || '10', 10);
    const pageSize = Number.isFinite(pageSizeParam) ? Math.min(Math.max(pageSizeParam, 1), 50) : 10;
    const from = (page - 1) * pageSize;
    const to = from + pageSize; // inclusive end → pageSize+1 rows
    const { data, error } = await supabaseAdmin
      .from('aft_flight_logs')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;
    const rows = data || [];
    const hasMore = rows.length > pageSize;
    return NextResponse.json({
      logs: hasMore ? rows.slice(0, pageSize) : rows,
      hasMore,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}

// POST — create flight log atomically (any user with aircraft access).
// Uses log_flight_atomic RPC: locks the aircraft row, derives aircraft
// totals from the latest-by-occurred_at log (self-healing on out-of-
// order replay), and enforces a 24hr single-leg sanity bound against
// the prior-by-occurred_at log rather than the current aircraft max —
// so a companion-app offline flush of an older leg doesn't bounce
// because some newer leg already landed.
//
// Idempotency: client sends `X-Idempotency-Key` (UUID per submission);
// a repeat of the same key within 1hr returns the cached response
// instead of inserting a duplicate. See src/lib/idempotency.ts.
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    const rl = await checkSubmitRateLimit(supabaseAdmin, user.id);
    if (!rl.allowed) {
      return apiErrorCoded('RATE_LIMITED', `Too many submissions. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`, 429, req);
    }

    const idem = idempotency(supabaseAdmin, user.id, req, 'flight-logs/POST');
    const cached = await idem.check();
    if (cached) return cached;

    const { aircraftId, logData, aircraftUpdate } = await req.json();
    if (!aircraftId) {
      return apiErrorCoded('AIRCRAFT_ID_REQUIRED', 'Aircraft ID required.', 400, req);
    }
    const input = validateFlightLogInput(logData);
    await requireAircraftAccessCoded(supabaseAdmin, user.id, aircraftId);

    const result = await submitFlightLog(
      supabaseAdmin,
      user.id,
      aircraftId,
      input,
      aircraftUpdate ?? {},
    );

    const body = { success: true, logId: result.logId, isLatest: result.isLatest };
    await idem.save(200, body);
    return NextResponse.json(body);
  } catch (error) { return handleCodedError(error, req); }
}

// PUT — edit flight log (admin only). Uses edit_flight_log_atomic RPC
// so the log + aircraft-totals update land in a single transaction;
// totals self-derive from the latest-by-occurred_at log after the edit.
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { logId, aircraftId, logData, aircraftUpdate } = await req.json();
    if (!logId || !aircraftId) return NextResponse.json({ error: 'Log ID and Aircraft ID required.' }, { status: 400 });
    const input = validateFlightLogInput(logData);
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    const { error: rpcErr } = await supabaseAdmin.rpc('edit_flight_log_atomic', {
      p_log_id: logId,
      p_aircraft_id: aircraftId,
      p_user_id: user.id,
      p_log_data: input ?? {},
      p_aircraft_update: aircraftUpdate ?? {},
    });
    if (rpcErr) {
      const status = rpcErr.code === 'P0002' ? 404 : rpcErr.code === 'P0001' ? 400 : 500;
      return NextResponse.json({ error: friendlyPgError(rpcErr) }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — soft-delete flight log (admin only). Aircraft totals self-
// derive from the remaining latest-by-occurred_at log after the delete.
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { logId, aircraftId, aircraftUpdate } = await req.json();
    if (!logId || !aircraftId) return NextResponse.json({ error: 'Log ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    const { error: rpcErr } = await supabaseAdmin.rpc('delete_flight_log_atomic', {
      p_log_id: logId,
      p_aircraft_id: aircraftId,
      p_user_id: user.id,
      p_aircraft_update: aircraftUpdate ?? {},
    });
    if (rpcErr) {
      const status = rpcErr.code === 'P0002' ? 404 : rpcErr.code === 'P0001' ? 400 : 500;
      return NextResponse.json({ error: friendlyPgError(rpcErr) }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

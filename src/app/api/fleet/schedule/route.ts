import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/fleet/schedule?from=ISO&to=ISO[&ids=csv]
 *
 * Cross-fleet calendar data for FleetSchedule. Returns confirmed
 * reservations + active maintenance blocks across the user's
 * accessible aircraft (intersected with `ids` if passed).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!from || !to) {
      return NextResponse.json({ error: 'from + to (ISO) required' }, { status: 400 });
    }

    const { user, supabaseAdmin } = await requireAuth(req);

    const { data: accessRows, error: accessErr } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('aircraft_id')
      .eq('user_id', user.id);
    if (accessErr) throw accessErr;
    const accessIds = (accessRows ?? []).map(r => (r as any).aircraft_id);

    const requestedIds = (url.searchParams.get('ids') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const ids = requestedIds.length > 0
      ? requestedIds.filter(id => accessIds.includes(id))
      : accessIds;

    if (ids.length === 0) {
      return NextResponse.json({ reservations: [], mxEvents: [] });
    }

    const [resRes, mxRes] = await Promise.all([
      supabaseAdmin
        .from('aft_reservations')
        .select('*')
        .in('aircraft_id', ids)
        .eq('status', 'confirmed')
        .gte('end_time', from)
        .lte('start_time', to)
        .order('start_time'),
      supabaseAdmin
        .from('aft_maintenance_events')
        .select('aircraft_id, confirmed_date, estimated_completion, status, mx_contact_name')
        .in('aircraft_id', ids)
        .is('deleted_at', null)
        .in('status', ['confirmed', 'in_progress']),
    ]);
    if (resRes.error) throw resRes.error;
    if (mxRes.error) throw mxRes.error;

    return NextResponse.json({
      reservations: resRes.data ?? [],
      mxEvents: (mxRes.data ?? []).filter((e: any) => e.confirmed_date),
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}

import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/aircraft/[id]/calendar?from=ISO&to=ISO
 *
 * Returns confirmed reservations whose window overlaps [from, to]
 * plus active maintenance blocks (status confirmed/in_progress with
 * a confirmed_date). Used by CalendarTab (month grid) and
 * CalendarDashboard (next-N-day window).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!from || !to) {
      return NextResponse.json({ error: 'from + to (ISO) required' }, { status: 400 });
    }

    const { user, supabaseAdmin } = await requireAuth(req);
    await requireAircraftAccess(supabaseAdmin, user.id, id);

    const [resRes, mxRes] = await Promise.all([
      supabaseAdmin
        .from('aft_reservations')
        .select('*')
        .eq('aircraft_id', id)
        .eq('status', 'confirmed')
        .gte('end_time', from)
        .lte('start_time', to)
        .order('start_time'),
      supabaseAdmin
        .from('aft_maintenance_events')
        .select('confirmed_date, estimated_completion, status, mx_contact_name')
        .eq('aircraft_id', id)
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

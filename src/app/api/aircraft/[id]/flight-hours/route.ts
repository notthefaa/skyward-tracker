import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/aircraft/[id]/flight-hours?from=ISO&to=ISO
 *
 * Returns two single-row reads needed by CalendarDashboard's hours-
 * flown widget: the latest log strictly before `from` (baseline) and
 * the latest log at-or-before `to` (current). Client computes the
 * delta with the right metric (aftt/ftt for turbines, hobbs/tach for
 * pistons) using setup_* fallbacks when the baseline is null.
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

    const [baseRes, curRes] = await Promise.all([
      supabaseAdmin
        .from('aft_flight_logs')
        .select('aftt, ftt, hobbs, tach')
        .eq('aircraft_id', id)
        .is('deleted_at', null)
        .lt('occurred_at', from)
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1),
      supabaseAdmin
        .from('aft_flight_logs')
        .select('aftt, ftt, hobbs, tach')
        .eq('aircraft_id', id)
        .is('deleted_at', null)
        .lte('occurred_at', to)
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1),
    ]);
    if (baseRes.error) throw baseRes.error;
    if (curRes.error) throw curRes.error;

    return NextResponse.json({
      baseline: (baseRes.data && baseRes.data[0]) || null,
      current: (curRes.data && curRes.data[0]) || null,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}

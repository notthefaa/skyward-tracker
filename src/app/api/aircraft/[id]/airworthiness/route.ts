import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';
import { computeAirworthinessStatus, applyOpenSquawkOverride } from '@/lib/airworthiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/aircraft/[id]/airworthiness
 *
 * Replaces 4 parallel browser-side `supabase.from()` reads in
 * useGroundedStatus with one cookie-bearing fetch. The verdict is
 * computed SERVER-SIDE and returned as `{status, reason, openSquawkCount}`
 * — smaller payload than shipping all 4 datasets, and the heavy
 * regulatory math lives in one place.
 *
 * Authoritative source for the airworthiness dot in the header.
 * Called on tail switch + on grounded-state recheck.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { user, supabaseAdmin } = await requireAuth(req);
    await requireAircraftAccess(supabaseAdmin, user.id, id);

    const { data: aircraft, error: acErr } = await supabaseAdmin
      .from('aft_aircraft')
      .select('id, tail_number, total_engine_time, is_ifr_equipped, is_for_hire, time_zone')
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    if (acErr || !aircraft) {
      return NextResponse.json({ error: 'Aircraft not found.' }, { status: 404 });
    }

    // Same parallel reads the hook used to do client-side. Service-role
    // key bypasses RLS — `requireAircraftAccess` above is the gate.
    const [mxRes, sqRes, eqRes, adRes] = await Promise.all([
      supabaseAdmin
        .from('aft_maintenance_items')
        .select('item_name, tracking_type, is_required, due_time, due_date')
        .eq('aircraft_id', id)
        .is('deleted_at', null),
      supabaseAdmin
        .from('aft_squawks')
        .select('affects_airworthiness, location, status')
        .eq('aircraft_id', id)
        .eq('status', 'open')
        .is('deleted_at', null),
      supabaseAdmin
        .from('aft_aircraft_equipment')
        .select('*')
        .eq('aircraft_id', id)
        .is('deleted_at', null)
        .is('removed_at', null),
      supabaseAdmin
        .from('aft_airworthiness_directives')
        .select('*')
        .eq('aircraft_id', id)
        .is('deleted_at', null)
        .eq('is_superseded', false),
    ]);
    if (mxRes.error) throw mxRes.error;
    if (sqRes.error) throw sqRes.error;
    if (eqRes.error) throw eqRes.error;
    if (adRes.error) throw adRes.error;

    const verdict = computeAirworthinessStatus({
      aircraft: {
        id: aircraft.id,
        tail_number: aircraft.tail_number,
        total_engine_time: aircraft.total_engine_time,
        is_ifr_equipped: (aircraft as any).is_ifr_equipped,
        is_for_hire: (aircraft as any).is_for_hire,
        // Pass the aircraft's IANA zone so isDateExpiredInZone compares
        // due dates against the pilot's calendar, not UTC. Without this
        // a Pacific-time pilot opening the app at 8pm local sees a
        // tomorrow-dated ELT/altimeter/transponder check marked
        // expired four hours early — flipping the grounding verdict.
        time_zone: (aircraft as any).time_zone ?? null,
      },
      equipment: (eqRes.data || []) as any,
      mxItems: mxRes.data || [],
      squawks: (sqRes.data || []) as any,
      ads: (adRes.data || []) as any,
    });

    const openSquawkCount = (sqRes.data || []).length;
    const finalStatus = applyOpenSquawkOverride(verdict.status, openSquawkCount);

    return NextResponse.json({
      status: finalStatus,
      reason: verdict.reason || '',
      openSquawkCount,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}

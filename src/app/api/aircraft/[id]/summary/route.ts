import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';
import { todayInZone } from '@/lib/pilotTime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/aircraft/[id]/summary
 *
 * Consolidated read endpoint for SummaryTab. Replaces 7 parallel
 * supabase.from() reads (which each attached a Bearer via supabase-js's
 * GoTrue mutex) with one cookie-bearing call. Service-role key on the
 * server skips the per-call auth dance entirely.
 *
 * Returns:
 *   - mxItems: all aft_maintenance_items rows (client computes the
 *     "next due" with burn-rate metrics, which are in-memory state)
 *   - openSquawks: { id, affects_airworthiness } per open squawk
 *   - latestNote: most recent aft_notes row or null
 *   - lastFlight: { occurred_at, created_at, initials } most recent
 *     flight log or null
 *   - upcomingReservations: up to 2 confirmed future reservations
 *   - currentStatus: which "in progress" badge to show (active
 *     reservation / ready_for_pickup MX / active MX block) or null
 *   - crew: aircraft access list joined with user_roles for names
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { user, supabaseAdmin } = await requireAuth(req);
    await requireAircraftAccess(supabaseAdmin, user.id, id);

    // Pull aircraft for time_zone (used by today-bound currentStatus
    // queries below). Single small read; could be batched but adds
    // minimal latency on its own.
    const { data: aircraft, error: acErr } = await supabaseAdmin
      .from('aft_aircraft')
      .select('time_zone')
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    if (acErr || !aircraft) {
      return NextResponse.json({ error: 'Aircraft not found.' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const today = todayInZone((aircraft as any).time_zone || undefined);

    const [
      mxRes,
      squawksRes,
      noteRes,
      flightRes,
      upcomingResRes,
      activeResRes,
      readyMxRes,
      activeMxRes,
      accessRes,
    ] = await Promise.all([
      supabaseAdmin
        .from('aft_maintenance_items')
        .select('*')
        .eq('aircraft_id', id)
        .is('deleted_at', null),
      supabaseAdmin
        .from('aft_squawks')
        .select('id, affects_airworthiness')
        .eq('aircraft_id', id)
        .eq('status', 'open'),
      supabaseAdmin
        .from('aft_notes')
        .select('*')
        .eq('aircraft_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1),
      supabaseAdmin
        .from('aft_flight_logs')
        .select('occurred_at, created_at, initials')
        .eq('aircraft_id', id)
        .is('deleted_at', null)
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1),
      supabaseAdmin
        .from('aft_reservations')
        .select('*')
        .eq('aircraft_id', id)
        .eq('status', 'confirmed')
        .gt('start_time', now)
        .order('start_time')
        .limit(2),
      supabaseAdmin
        .from('aft_reservations')
        .select('pilot_name, pilot_initials, user_id, start_time, end_time')
        .eq('aircraft_id', id)
        .eq('status', 'confirmed')
        .lte('start_time', now)
        .gte('end_time', now)
        .order('start_time')
        .limit(1),
      supabaseAdmin
        .from('aft_maintenance_events')
        .select('confirmed_date, estimated_completion, mx_contact_name')
        .eq('aircraft_id', id)
        .eq('status', 'ready_for_pickup')
        .limit(1),
      supabaseAdmin
        .from('aft_maintenance_events')
        .select('confirmed_date, estimated_completion, mx_contact_name')
        .eq('aircraft_id', id)
        .in('status', ['confirmed', 'in_progress'])
        .lte('confirmed_date', today)
        .gte('estimated_completion', today)
        .limit(1),
      supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('user_id, aircraft_role')
        .eq('aircraft_id', id),
    ]);

    if (mxRes.error) throw mxRes.error;
    if (squawksRes.error) throw squawksRes.error;
    if (noteRes.error) throw noteRes.error;
    if (flightRes.error) throw flightRes.error;
    if (upcomingResRes.error) throw upcomingResRes.error;
    if (activeResRes.error) throw activeResRes.error;
    if (readyMxRes.error) throw readyMxRes.error;
    if (activeMxRes.error) throw activeMxRes.error;
    if (accessRes.error) throw accessRes.error;

    // Resolve the currentStatus discriminator — same precedence as the
    // original SummaryTab fetcher: active reservation → ready_for_pickup
    // → active maintenance block → null.
    let currentStatus: any = null;
    if (activeResRes.data && activeResRes.data.length > 0) {
      currentStatus = { type: 'reservation', ...activeResRes.data[0] };
    } else if (readyMxRes.data && readyMxRes.data.length > 0) {
      currentStatus = { type: 'ready_for_pickup', ...readyMxRes.data[0] };
    } else if (activeMxRes.data && activeMxRes.data.length > 0) {
      currentStatus = { type: 'maintenance', ...activeMxRes.data[0] };
    }

    // Crew — join access rows with user_roles for display fields.
    const accessRows = accessRes.data ?? [];
    let crew: Array<{
      user_id: string;
      aircraft_role: string;
      email: string;
      initials: string;
      full_name: string;
    }> = [];
    if (accessRows.length > 0) {
      const userIds = accessRows.map((a: any) => a.user_id);
      const { data: usersData, error: usersErr } = await supabaseAdmin
        .from('aft_user_roles')
        .select('user_id, email, initials, full_name')
        .in('user_id', userIds);
      if (usersErr) throw usersErr;
      crew = accessRows.map((access: any) => {
        const u = (usersData ?? []).find((row: any) => row.user_id === access.user_id);
        return {
          user_id: access.user_id,
          aircraft_role: access.aircraft_role,
          email: u?.email ?? '',
          initials: u?.initials ?? '',
          full_name: u?.full_name ?? '',
        };
      });
    }

    return NextResponse.json({
      mxItems: mxRes.data ?? [],
      openSquawks: squawksRes.data ?? [],
      latestNote: (noteRes.data && noteRes.data[0]) || null,
      lastFlight: (flightRes.data && flightRes.data[0]) || null,
      upcomingReservations: upcomingResRes.data ?? [],
      currentStatus,
      crew,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}

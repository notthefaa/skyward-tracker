import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/fleet/airworthiness
 *
 * Replaces the 5-parallel-supabase.from() batch in FleetSummary's
 * SWR fetcher with one cookie-bearing call. Returns the raw datasets
 * indexed by aircraft_id; FleetSummary still computes the per-card
 * verdict + next-MX + last-flown locally because those depend on the
 * client-side burn-rate metrics from useFleetData (which the server
 * doesn't have without re-running the burn-rate math).
 *
 * Scope: caller's accessible aircraft only. The hook used to query
 * with `in('aircraft_id', aircraftIds)` where aircraftIds came from
 * the local `aircraftList` (already access-scoped client-side). Here
 * we ALSO derive the access list server-side and intersect with any
 * aircraftIds the client requested, so a tampered client request
 * can't widen the read set.
 */
export async function GET(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    // Server-side access derivation. Caller can pass `?ids=` to scope
    // further (e.g., admin viewing a subset) but cannot widen beyond
    // their access list.
    const url = new URL(req.url);
    const requestedIds = (url.searchParams.get('ids') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    // Pull access list. Admin gets everything they have an access row
    // for (admin Global-Fleet UI lazy-loads single aircraft via a
    // different endpoint when needed; this surface is the user's
    // assigned set).
    const { data: accessRows, error: accessErr } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('aircraft_id')
      .eq('user_id', user.id);
    if (accessErr) throw accessErr;
    const accessIds = (accessRows ?? []).map(r => r.aircraft_id as string);

    const aircraftIds = requestedIds.length > 0
      ? requestedIds.filter(id => accessIds.includes(id))
      : accessIds;

    if (aircraftIds.length === 0) {
      return NextResponse.json({
        mx: [], squawks: [], equipment: [], ads: [], lastFlights: [],
      });
    }

    const [mxRes, sqRes, logRes, eqRes, adRes] = await Promise.all([
      supabaseAdmin
        .from('aft_maintenance_items')
        .select('aircraft_id, item_name, tracking_type, is_required, due_time, due_date, time_interval')
        .in('aircraft_id', aircraftIds)
        .is('deleted_at', null),
      supabaseAdmin
        .from('aft_squawks')
        .select('aircraft_id, affects_airworthiness, location, status')
        .in('aircraft_id', aircraftIds)
        .eq('status', 'open')
        .is('deleted_at', null),
      supabaseAdmin
        .from('aft_flight_logs')
        .select('aircraft_id, occurred_at, created_at, initials')
        .in('aircraft_id', aircraftIds)
        .is('deleted_at', null)
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('aft_aircraft_equipment')
        .select('*')
        .in('aircraft_id', aircraftIds)
        .is('deleted_at', null)
        .is('removed_at', null),
      supabaseAdmin
        .from('aft_airworthiness_directives')
        .select('*')
        .in('aircraft_id', aircraftIds)
        .is('deleted_at', null)
        .eq('is_superseded', false),
    ]);
    if (mxRes.error) throw mxRes.error;
    if (sqRes.error) throw sqRes.error;
    if (logRes.error) throw logRes.error;
    if (eqRes.error) throw eqRes.error;
    if (adRes.error) throw adRes.error;

    // Reduce flight logs to the latest per aircraft_id server-side so
    // the client doesn't have to ship every log for first-flight-found
    // detection. Logs are already ordered DESC, so the first hit per
    // aircraft is the latest.
    const seen = new Set<string>();
    const lastFlights: Array<{ aircraft_id: string; occurred_at: string; initials: string | null }> = [];
    for (const log of logRes.data ?? []) {
      const acId = (log as any).aircraft_id as string;
      if (seen.has(acId)) continue;
      seen.add(acId);
      lastFlights.push({
        aircraft_id: acId,
        occurred_at: ((log as any).occurred_at ?? (log as any).created_at) as string,
        initials: ((log as any).initials ?? null) as string | null,
      });
    }

    return NextResponse.json({
      mx: mxRes.data ?? [],
      squawks: sqRes.data ?? [],
      equipment: eqRes.data ?? [],
      ads: adRes.data ?? [],
      lastFlights,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}

import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIVE_STATUSES = ['draft', 'scheduling', 'confirmed', 'in_progress', 'ready_for_pickup'] as const;
const PAST_STATUSES = ['complete', 'cancelled'] as const;

/**
 * GET /api/mx-events?aircraftId=...&filter=active|past&limit=20
 *
 * Migrated from direct supabase.from() reads in MaintenanceTab so the
 * iOS GoTrue mutex isn't pressured on every MX tab open. Two filter
 * shapes:
 *   - filter=active (default) — open work, ordered newest-first, no
 *     limit (typically 0–3 events at any time).
 *   - filter=past — last `limit` complete/cancelled events for the
 *     history panel. limit defaults to 20, capped at 100.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const aircraftId = url.searchParams.get('aircraftId');
    if (!aircraftId) return NextResponse.json({ error: 'aircraftId required' }, { status: 400 });
    const filter = (url.searchParams.get('filter') || 'active') as 'active' | 'past';
    const limitParam = parseInt(url.searchParams.get('limit') || '20', 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 20;

    const { user, supabaseAdmin } = await requireAuth(req);
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    let query = supabaseAdmin
      .from('aft_maintenance_events')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null);

    if (filter === 'past') {
      query = query.in('status', PAST_STATUSES as unknown as string[])
        .order('created_at', { ascending: false })
        .limit(limit);
    } else {
      query = query.in('status', ACTIVE_STATUSES as unknown as string[])
        .order('created_at', { ascending: false });
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ events: data ?? [] });
  } catch (error) {
    return handleApiError(error, req);
  }
}

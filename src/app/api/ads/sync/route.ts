import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { syncAdsForAircraft } from '@/lib/drs';

export const maxDuration = 60;

// POST — run a live Federal Register AD sync for one aircraft and
// return the result synchronously. Used by the "Sync from DRS"
// button in ADsTab.
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId } = await req.json();
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    await setAppUser(supabaseAdmin, user.id);

    const { data: ac, error: acErr } = await supabaseAdmin
      .from('aft_aircraft')
      .select('id, make, model, aircraft_type, engine_type')
      .eq('id', aircraftId)
      .maybeSingle();
    if (acErr) throw acErr;
    if (!ac) return NextResponse.json({ error: 'Aircraft not found.' }, { status: 404 });

    const result = await syncAdsForAircraft(supabaseAdmin, ac);
    if (result.error) {
      return NextResponse.json({ error: result.error, ...result }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (error) { return handleApiError(error); }
}

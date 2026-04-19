import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { parseFiniteNumber } from '@/lib/validation';

// POST — update aircraft fuel state. Replaces the SummaryTab direct
// `supabase.from('aft_aircraft').update(...)` call, which let any
// caller with RLS access write NaN / Infinity / negatives straight
// into current_fuel_gallons. The client still owns unit conversion
// (lbs → gal) because the conversion factor depends on engine type,
// which the client already has in the aircraft record; the server's
// job here is to validate the gallon value and persist it under a
// bounded range.
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, gallons } = await req.json();

    if (!aircraftId || typeof aircraftId !== 'string') {
      return NextResponse.json({ error: 'aircraftId is required.' }, { status: 400 });
    }
    // 10,000 gal upper bound is generous (typical GA tanks are <200 gal,
    // bizjets <2,000); picked to catch typos without rejecting unusual
    // but real aircraft. Tighten if needed.
    const parsed = parseFiniteNumber(gallons, { min: 0, max: 10000 });
    if (parsed === undefined || parsed === null) {
      return NextResponse.json(
        { error: 'gallons must be a finite number between 0 and 10,000.' },
        { status: 400 },
      );
    }

    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);
    await setAppUser(supabaseAdmin, user.id);

    const { error } = await supabaseAdmin
      .from('aft_aircraft')
      .update({ current_fuel_gallons: parsed, fuel_last_updated: new Date().toISOString() })
      .eq('id', aircraftId)
      .is('deleted_at', null);
    if (error) throw error;

    return NextResponse.json({ success: true, current_fuel_gallons: parsed });
  } catch (error) {
    return handleApiError(error);
  }
}

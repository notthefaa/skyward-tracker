import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { stripProtectedFields } from '@/lib/validation';

// GET — list ADs for an aircraft
export async function GET(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const aircraftId = searchParams.get('aircraftId');
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    const includeSuperseded = searchParams.get('includeSuperseded') === 'true';

    let q = supabaseAdmin
      .from('aft_airworthiness_directives')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('next_due_date', { ascending: true, nullsFirst: false })
      .order('ad_number', { ascending: false });

    if (!includeSuperseded) q = q.eq('is_superseded', false);

    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ ads: data || [] });
  } catch (error) { return handleApiError(error); }
}

// POST — create AD manually (aircraft admin only)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, adData } = await req.json();
    if (!aircraftId || !adData) return NextResponse.json({ error: 'Aircraft ID and AD data required.' }, { status: 400 });
    if (!adData.ad_number || !adData.subject) {
      return NextResponse.json({ error: 'AD number and subject are required.' }, { status: 400 });
    }
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    await setAppUser(supabaseAdmin, user.id);

    // source='manual' marks records entered by hand vs. synced from DRS.
    // That distinction must be server-controlled — a client who set
    // source='drs' on a manual record would bypass future sync-conflict
    // resolution. aircraft_id / created_by are also server-owned.
    const { data, error } = await supabaseAdmin
      .from('aft_airworthiness_directives')
      .insert({ ...stripProtectedFields(adData, 'ads'), aircraft_id: aircraftId, source: 'manual', created_by: user.id })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: `AD ${adData.ad_number} already tracked on this aircraft.` }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ ad: data });
  } catch (error) { return handleApiError(error); }
}

// PUT — update AD (aircraft admin only). Used to log compliance.
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { adId, aircraftId, adData } = await req.json();
    if (!adId || !aircraftId) return NextResponse.json({ error: 'AD ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    await setAppUser(supabaseAdmin, user.id);

    // 'ads' table key locks down DRS-managed fields (source,
    // is_superseded, sync_hash, applicability_*) so a PUT can't
    // mark a manual record as DRS-synced or spoof the per-aircraft
    // applicability verdict written by check-applicability/route.
    const safeUpdate = stripProtectedFields(adData, 'ads');
    const { error } = await supabaseAdmin
      .from('aft_airworthiness_directives')
      .update(safeUpdate)
      .eq('id', adId)
      .eq('aircraft_id', aircraftId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — soft-delete AD (aircraft admin only)
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { adId, aircraftId } = await req.json();
    if (!adId || !aircraftId) return NextResponse.json({ error: 'AD ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    await setAppUser(supabaseAdmin, user.id);

    const { error } = await supabaseAdmin
      .from('aft_airworthiness_directives')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', adId)
      .eq('aircraft_id', aircraftId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

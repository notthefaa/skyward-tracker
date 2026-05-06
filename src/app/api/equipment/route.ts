import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { stripProtectedFields } from '@/lib/validation';

// GET — list equipment for an aircraft
export async function GET(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const aircraftId = searchParams.get('aircraftId');
    const includeRemoved = searchParams.get('includeRemoved') === 'true';
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    let q = supabaseAdmin
      .from('aft_aircraft_equipment')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('category', { ascending: true })
      .order('installed_at', { ascending: false });

    if (!includeRemoved) q = q.is('removed_at', null);

    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ equipment: data || [] });
  } catch (error) { return handleApiError(error); }
}

// POST — create equipment (aircraft admin only)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, equipmentData, bulk } = await req.json();
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    await setAppUser(supabaseAdmin, user.id);

    if (Array.isArray(bulk)) {
      // Bulk inserts skipped the per-row name/category validation that
      // the single-item path enforces. A bulk client could ship
      // half-populated rows. Apply the same minimum bar before insert.
      for (const e of bulk) {
        if (!e?.name || !e?.category) {
          return NextResponse.json({ error: 'Every bulk row needs name and category.' }, { status: 400 });
        }
      }
      const rows = bulk.map((e: any) => ({
        ...stripProtectedFields(e, 'equipment'),
        aircraft_id: aircraftId,
        created_by: user.id,
      }));
      const { data, error } = await supabaseAdmin
        .from('aft_aircraft_equipment')
        .insert(rows)
        .select();
      if (error) throw error;
      return NextResponse.json({ equipment: data || [] });
    }

    if (!equipmentData?.name || !equipmentData?.category) {
      return NextResponse.json({ error: 'Name and category are required.' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from('aft_aircraft_equipment')
      .insert({ ...stripProtectedFields(equipmentData, 'equipment'), aircraft_id: aircraftId, created_by: user.id })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ equipment: data });
  } catch (error) { return handleApiError(error); }
}

// PUT — update equipment (aircraft admin only)
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { equipmentId, aircraftId, equipmentData } = await req.json();
    if (!equipmentId || !aircraftId) {
      return NextResponse.json({ error: 'Equipment ID and Aircraft ID required.' }, { status: 400 });
    }
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    await setAppUser(supabaseAdmin, user.id);

    // Strip server-owned fields — the aircraft_id filter on the
    // update query already prevents cross-aircraft escapes, but
    // without the strip a client could still blank `installed_at`,
    // resurrect a soft-delete via `deleted_at: null`, or spoof
    // `created_by`. `removed_at` is intentionally NOT in the strip
    // set: the "Mark Removed" UI sets it via PUT. Resurrect
    // protection (preventing a client from clearing an already-set
    // removed_at to bring gear back without an audit trail) is
    // handled below; the acting user is captured via the history
    // trigger that fires off `setAppUser`.
    const safeUpdate: Record<string, unknown> = stripProtectedFields(equipmentData, 'equipment');

    if (Object.prototype.hasOwnProperty.call(equipmentData, 'removed_at')) {
      const incoming = equipmentData.removed_at;
      if (incoming === null || incoming === '') {
        // No-resurrect: only allow null when the row was already null.
        // Fetching the existing value adds one round-trip per edit,
        // but it's the simplest way to keep the audit trail intact
        // without a dedicated reinstate endpoint.
        const { data: existing } = await supabaseAdmin
          .from('aft_aircraft_equipment')
          .select('removed_at')
          .eq('id', equipmentId)
          .eq('aircraft_id', aircraftId)
          .maybeSingle();
        if (existing?.removed_at) {
          delete safeUpdate.removed_at;
        } else {
          safeUpdate.removed_at = null;
        }
      } else {
        safeUpdate.removed_at = incoming;
      }
    }

    const { error } = await supabaseAdmin
      .from('aft_aircraft_equipment')
      .update(safeUpdate)
      .eq('id', equipmentId)
      .eq('aircraft_id', aircraftId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — soft-delete equipment (aircraft admin only)
// Prefer setting removed_at via PUT to mark "no longer installed";
// DELETE is reserved for mistaken entries.
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { equipmentId, aircraftId } = await req.json();
    if (!equipmentId || !aircraftId) {
      return NextResponse.json({ error: 'Equipment ID and Aircraft ID required.' }, { status: 400 });
    }
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    await setAppUser(supabaseAdmin, user.id);

    const { error } = await supabaseAdmin
      .from('aft_aircraft_equipment')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', equipmentId)
      .eq('aircraft_id', aircraftId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

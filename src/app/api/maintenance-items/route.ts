import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';

// POST — create maintenance item(s) (aircraft admin only)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const body = await req.json();
    const { aircraftId, itemData, items } = body;
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    await setAppUser(supabaseAdmin, user.id);
    if (items && Array.isArray(items)) {
      const rows = items.map((item: any) => ({ ...item, aircraft_id: aircraftId }));
      const { error } = await supabaseAdmin.from('aft_maintenance_items').insert(rows);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin.from('aft_maintenance_items').insert({ ...itemData, aircraft_id: aircraftId });
      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// PUT — update maintenance item (aircraft admin only)
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { itemId, aircraftId, itemData } = await req.json();
    if (!itemId || !aircraftId) return NextResponse.json({ error: 'Item ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    // Verify the item actually belongs to the aircraft the caller is admin
    // on — otherwise an admin of aircraft A could update any item across
    // the whole fleet by supplying A's id + any itemId.
    const { data: existing } = await supabaseAdmin
      .from('aft_maintenance_items')
      .select('aircraft_id, deleted_at')
      .eq('id', itemId)
      .maybeSingle();
    if (!existing || existing.aircraft_id !== aircraftId || existing.deleted_at) {
      return NextResponse.json({ error: 'Maintenance item not found for this aircraft.' }, { status: 404 });
    }

    await setAppUser(supabaseAdmin, user.id);
    const { error } = await supabaseAdmin.from('aft_maintenance_items').update(itemData).eq('id', itemId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — soft-delete maintenance item (aircraft admin only)
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { itemId, aircraftId } = await req.json();
    if (!itemId || !aircraftId) return NextResponse.json({ error: 'Item ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    // Same cross-aircraft guard as PUT — fetch the row and require its
    // aircraft_id matches the aircraft the caller's admin on.
    const { data: existing } = await supabaseAdmin
      .from('aft_maintenance_items')
      .select('aircraft_id, deleted_at')
      .eq('id', itemId)
      .maybeSingle();
    if (!existing || existing.aircraft_id !== aircraftId || existing.deleted_at) {
      return NextResponse.json({ error: 'Maintenance item not found for this aircraft.' }, { status: 404 });
    }

    await setAppUser(supabaseAdmin, user.id);
    const { error } = await supabaseAdmin
      .from('aft_maintenance_items')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', itemId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';

// POST — create maintenance item(s) (aircraft admin only)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const body = await req.json();
    const { aircraftId, itemData, items } = body;
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    // Support bulk insert (from templates) or single item
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

    const { error } = await supabaseAdmin.from('aft_maintenance_items').update(itemData).eq('id', itemId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — delete maintenance item (aircraft admin only)
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { itemId, aircraftId } = await req.json();
    if (!itemId || !aircraftId) return NextResponse.json({ error: 'Item ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    const { error } = await supabaseAdmin.from('aft_maintenance_items').delete().eq('id', itemId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

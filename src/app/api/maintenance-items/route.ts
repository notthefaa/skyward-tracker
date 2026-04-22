import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { pickAllowedFields } from '@/lib/validation';

// Columns a client may set when creating / updating a maintenance item.
// Schema-owned fields (reminder_*_sent, mx_schedule_sent, deleted_*,
// created_*) are deliberately excluded so a malicious admin can't
// pre-mark an item as "reminders sent" or forge audit metadata.
const MX_ITEM_ALLOWED_FIELDS = [
  'item_name',
  'tracking_type',
  'is_required',
  'last_completed_time', 'time_interval', 'due_time',
  'last_completed_date', 'date_interval_days', 'due_date',
  'automate_scheduling',
] as const;

// Bulk-insert cap. Templates typically insert ~15 items at once.
// 100 is generous headroom; anything larger signals abuse or a bug.
const MAX_BULK_ITEMS = 100;

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
      if (items.length === 0) {
        return NextResponse.json({ error: 'items array cannot be empty.' }, { status: 400 });
      }
      if (items.length > MAX_BULK_ITEMS) {
        return NextResponse.json({ error: `Too many items; max ${MAX_BULK_ITEMS} per request.` }, { status: 400 });
      }
      const rows = items.map((item: unknown) => ({
        ...pickAllowedFields(item, MX_ITEM_ALLOWED_FIELDS),
        aircraft_id: aircraftId,
      }));
      const { error } = await supabaseAdmin.from('aft_maintenance_items').insert(rows);
      if (error) throw error;
    } else {
      const safe = pickAllowedFields(itemData, MX_ITEM_ALLOWED_FIELDS);
      const { error } = await supabaseAdmin.from('aft_maintenance_items').insert({ ...safe, aircraft_id: aircraftId });
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
    const safeUpdate = pickAllowedFields(itemData, MX_ITEM_ALLOWED_FIELDS);
    const { error } = await supabaseAdmin.from('aft_maintenance_items').update(safeUpdate).eq('id', itemId);
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

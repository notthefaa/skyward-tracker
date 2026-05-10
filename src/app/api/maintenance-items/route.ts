import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { idempotency } from '@/lib/idempotency';
import { pickAllowedFields, parseFiniteNumber, isIsoDate } from '@/lib/validation';

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

// Coerce + validate the numeric/date columns on the way in. The form
// already gates these client-side, but a devtools-fabricated payload
// would otherwise let `due_time = NaN` (which JSON-serializes to null)
// or a "2025-02-30" land in the row — and the column constraints
// don't catch all of those. Returns either { ok: cleanedRow } or an
// { error } string to bounce as a 400.
function validateMxItemRow(
  raw: Record<string, unknown>,
): { ok: Record<string, unknown> } | { error: string } {
  const out: Record<string, unknown> = { ...raw };

  if ('tracking_type' in raw) {
    const t = raw.tracking_type;
    if (t !== 'time' && t !== 'date' && t !== 'both') {
      return { error: 'tracking_type must be "time", "date", or "both".' };
    }
  }

  for (const k of ['last_completed_time', 'time_interval', 'due_time'] as const) {
    if (k in raw) {
      const n = parseFiniteNumber(raw[k], { min: 0 });
      if (n === undefined) return { error: `${k} must be a non-negative finite number.` };
      out[k] = n;
    }
  }

  if ('date_interval_days' in raw) {
    const n = parseFiniteNumber(raw.date_interval_days, { min: 0 });
    if (n === undefined) return { error: 'date_interval_days must be a non-negative finite number.' };
    out.date_interval_days = n === null ? null : Math.trunc(n);
  }

  for (const k of ['last_completed_date', 'due_date'] as const) {
    if (k in raw) {
      const v = raw[k];
      if (v === null || v === undefined || v === '') { out[k] = null; continue; }
      if (!isIsoDate(v)) return { error: `${k} must be a valid YYYY-MM-DD date.` };
    }
  }

  for (const k of ['is_required', 'automate_scheduling'] as const) {
    if (k in raw && typeof raw[k] !== 'boolean') {
      return { error: `${k} must be a boolean.` };
    }
  }

  if ('item_name' in raw) {
    const v = raw.item_name;
    if (typeof v !== 'string' || v.trim() === '') {
      return { error: 'item_name must be a non-empty string.' };
    }
  }

  return { ok: out };
}

// POST — create maintenance item(s) (aircraft admin only)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const idem = idempotency(supabaseAdmin, user.id, req, 'maintenance-items/POST');
    const cached = await idem.check();
    if (cached) return cached;
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
      const rows: Record<string, unknown>[] = [];
      for (const item of items) {
        const safe = pickAllowedFields(item as Record<string, unknown>, MX_ITEM_ALLOWED_FIELDS);
        const checked = validateMxItemRow(safe as Record<string, unknown>);
        if ('error' in checked) {
          return NextResponse.json({ error: checked.error }, { status: 400 });
        }
        rows.push({ ...checked.ok, aircraft_id: aircraftId });
      }
      const { error } = await supabaseAdmin.from('aft_maintenance_items').insert(rows);
      if (error) throw error;
    } else {
      const safe = pickAllowedFields(itemData, MX_ITEM_ALLOWED_FIELDS);
      const checked = validateMxItemRow(safe as Record<string, unknown>);
      if ('error' in checked) {
        return NextResponse.json({ error: checked.error }, { status: 400 });
      }
      const { error } = await supabaseAdmin.from('aft_maintenance_items').insert({ ...checked.ok, aircraft_id: aircraftId });
      if (error) throw error;
    }

    const ok = { success: true };
    await idem.save(200, ok);
    return NextResponse.json(ok);
  } catch (error) { return handleApiError(error); }
}

// PUT — update maintenance item (aircraft admin only)
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const idem = idempotency(supabaseAdmin, user.id, req, 'maintenance-items/PUT');
    const cached = await idem.check();
    if (cached) return cached;
    const { itemId, aircraftId, itemData } = await req.json();
    if (!itemId || !aircraftId) return NextResponse.json({ error: 'Item ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    // Verify the item actually belongs to the aircraft the caller is admin
    // on — otherwise an admin of aircraft A could update any item across
    // the whole fleet by supplying A's id + any itemId.
    const { data: existing, error: readErr } = await supabaseAdmin
      .from('aft_maintenance_items')
      .select('aircraft_id, deleted_at')
      .eq('id', itemId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!existing || existing.aircraft_id !== aircraftId || existing.deleted_at) {
      return NextResponse.json({ error: 'Maintenance item not found for this aircraft.' }, { status: 404 });
    }

    await setAppUser(supabaseAdmin, user.id);
    const safeUpdate = pickAllowedFields(itemData, MX_ITEM_ALLOWED_FIELDS);
    const checked = validateMxItemRow(safeUpdate as Record<string, unknown>);
    if ('error' in checked) {
      return NextResponse.json({ error: checked.error }, { status: 400 });
    }

    // If this update records a completion (last_completed_* was set),
    // reset the email-sent flags so the next approaching-due cycle
    // triggers fresh heads-up + schedule reminders. Without this, an
    // item that ever fired its heads-up email never fires it again
    // for the rest of its lifetime. Mirrors the flag-reset block in
    // complete_mx_event_atomic (e2e/sql/01_public_schema.sql:269-273)
    // so the manual PUT path stays in sync with the service-event path.
    const finalUpdate: Record<string, unknown> = { ...checked.ok };
    if ('last_completed_time' in checked.ok || 'last_completed_date' in checked.ok) {
      finalUpdate.primary_heads_up_sent = false;
      finalUpdate.mx_schedule_sent = false;
      finalUpdate.reminder_5_sent = false;
      finalUpdate.reminder_15_sent = false;
      finalUpdate.reminder_30_sent = false;
    }

    // Filter by aircraft_id + deleted_at to close the read-then-update
    // race — without this, a concurrent admin DELETE could let a PUT
    // resurrect the row through the soft-delete.
    const { error } = await supabaseAdmin
      .from('aft_maintenance_items')
      .update(finalUpdate)
      .eq('id', itemId)
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null);
    if (error) throw error;

    const ok = { success: true };
    await idem.save(200, ok);
    return NextResponse.json(ok);
  } catch (error) { return handleApiError(error); }
}

// DELETE — soft-delete maintenance item (aircraft admin only)
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const idem = idempotency(supabaseAdmin, user.id, req, 'maintenance-items/DELETE');
    const cached = await idem.check();
    if (cached) return cached;
    const { itemId, aircraftId } = await req.json();
    if (!itemId || !aircraftId) return NextResponse.json({ error: 'Item ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    // Same cross-aircraft guard as PUT — fetch the row and require its
    // aircraft_id matches the aircraft the caller's admin on.
    const { data: existing, error: readErr } = await supabaseAdmin
      .from('aft_maintenance_items')
      .select('aircraft_id, deleted_at')
      .eq('id', itemId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!existing || existing.aircraft_id !== aircraftId || existing.deleted_at) {
      return NextResponse.json({ error: 'Maintenance item not found for this aircraft.' }, { status: 404 });
    }

    await setAppUser(supabaseAdmin, user.id);
    // Filter by deleted_at IS NULL — without this, a retry of a
    // successful soft-delete would overwrite deleted_at with a later
    // timestamp, breaking the "first-deletion-wins" audit semantics.
    const { error } = await supabaseAdmin
      .from('aft_maintenance_items')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', itemId)
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null);
    if (error) throw error;

    const ok = { success: true };
    await idem.save(200, ok);
    return NextResponse.json(ok);
  } catch (error) { return handleApiError(error); }
}

import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';

// POST — create oil log (any user with aircraft access)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, logData } = await req.json();
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    if (!logData || typeof logData !== 'object') return NextResponse.json({ error: 'Invalid log data.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    const { oil_qty, oil_added, engine_hours, initials, notes } = logData;
    if (!initials || typeof initials !== 'string') return NextResponse.json({ error: 'Initials are required.' }, { status: 400 });

    const fields: Array<[string, any]> = [
      ['oil_qty', oil_qty],
      ['engine_hours', engine_hours],
    ];
    if (oil_added !== null && oil_added !== undefined && oil_added !== '') {
      fields.push(['oil_added', oil_added]);
    }
    for (const [field, value] of fields) {
      const num = Number(value);
      // `!Number.isFinite` catches NaN *and* ±Infinity — plain
      // `Number.isNaN` was letting "Infinity" slip through.
      if (!Number.isFinite(num) || num < 0) return NextResponse.json({ error: `Invalid ${field}: must be a non-negative finite number.` }, { status: 400 });
    }

    await setAppUser(supabaseAdmin, user.id);
    await supabaseAdmin.from('aft_oil_logs').insert({
      aircraft_id: aircraftId,
      user_id: user.id,
      oil_qty: Number(oil_qty),
      oil_added: oil_added !== null && oil_added !== undefined && oil_added !== '' ? Number(oil_added) : null,
      engine_hours: Number(engine_hours),
      initials: initials.trim().toUpperCase(),
      notes: notes?.trim() || null,
    });

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — soft-delete oil log (admin only)
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { logId, aircraftId } = await req.json();
    if (!logId || !aircraftId) return NextResponse.json({ error: 'Log ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    await setAppUser(supabaseAdmin, user.id);
    // Guard: filter by aircraft_id too so admin-on-A can't delete B's logs
    // by mixing aircraftId=A with a foreign logId.
    const { data: deleted } = await supabaseAdmin
      .from('aft_oil_logs')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', logId)
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (!deleted) return NextResponse.json({ error: 'Oil log not found for this aircraft.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

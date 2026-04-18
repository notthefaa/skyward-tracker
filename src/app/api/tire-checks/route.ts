import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';

// POST — create tire check (any user with aircraft access)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, logData } = await req.json();
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    if (!logData || typeof logData !== 'object') return NextResponse.json({ error: 'Invalid log data.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    const { nose_psi, left_main_psi, right_main_psi, initials, notes } = logData;
    if (!initials || typeof initials !== 'string') return NextResponse.json({ error: 'Initials are required.' }, { status: 400 });

    // null = tire wasn't adjusted on this check. A non-null value
    // must be a non-negative number. At least one tire must be
    // adjusted, otherwise there's nothing to log.
    const normalize = (v: unknown): number | null => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isNaN(n) ? NaN : n;
    };
    const nose = normalize(nose_psi);
    const left = normalize(left_main_psi);
    const right = normalize(right_main_psi);
    for (const [field, val] of [['nose_psi', nose], ['left_main_psi', left], ['right_main_psi', right]] as const) {
      if (val !== null && (Number.isNaN(val) || val < 0)) {
        return NextResponse.json({ error: `Invalid ${field}: must be a non-negative number.` }, { status: 400 });
      }
    }
    if (nose === null && left === null && right === null) {
      return NextResponse.json({ error: 'Select at least one tire that was adjusted.' }, { status: 400 });
    }

    await setAppUser(supabaseAdmin, user.id);
    await supabaseAdmin.from('aft_tire_checks').insert({
      aircraft_id: aircraftId,
      user_id: user.id,
      nose_psi: nose,
      left_main_psi: left,
      right_main_psi: right,
      initials: initials.trim().toUpperCase(),
      notes: notes?.trim() || null,
    });

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — soft-delete tire check (admin only)
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { logId, aircraftId } = await req.json();
    if (!logId || !aircraftId) return NextResponse.json({ error: 'Log ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    await setAppUser(supabaseAdmin, user.id);
    await supabaseAdmin
      .from('aft_tire_checks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', logId);
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

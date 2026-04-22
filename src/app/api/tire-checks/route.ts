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
    // Normalize "not supplied" → null and reject NaN / ±Infinity /
    // negative. Using `Number.isFinite` here (rather than just
    // `Number.isNaN`) means a caller can't sneak "Infinity" through
    // the tire-logged check and poison downstream pressure math.
    const normalize = (v: unknown): number | null | 'invalid' => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return 'invalid';
      return n;
    };
    const nose = normalize(nose_psi);
    const left = normalize(left_main_psi);
    const right = normalize(right_main_psi);
    for (const [field, val] of [['nose_psi', nose], ['left_main_psi', left], ['right_main_psi', right]] as const) {
      if (val === 'invalid') {
        return NextResponse.json({ error: `Invalid ${field}: must be a non-negative finite number.` }, { status: 400 });
      }
    }
    // After normalize, each slot is either `null` (not adjusted) or a
    // number. The 'invalid' sentinel has already been rejected above.
    const noseClean = nose === 'invalid' ? null : nose;
    const leftClean = left === 'invalid' ? null : left;
    const rightClean = right === 'invalid' ? null : right;
    if (noseClean === null && leftClean === null && rightClean === null) {
      return NextResponse.json({ error: 'Select at least one tire that was adjusted.' }, { status: 400 });
    }

    await setAppUser(supabaseAdmin, user.id);
    await supabaseAdmin.from('aft_tire_checks').insert({
      aircraft_id: aircraftId,
      user_id: user.id,
      nose_psi: noseClean,
      left_main_psi: leftClean,
      right_main_psi: rightClean,
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
    // Guard: filter by aircraft_id too so admin-on-A can't delete B's logs
    // by mixing aircraftId=A with a foreign logId.
    const { data: deleted } = await supabaseAdmin
      .from('aft_tire_checks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', logId)
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (!deleted) return NextResponse.json({ error: 'Tire check not found for this aircraft.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

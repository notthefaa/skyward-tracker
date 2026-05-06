import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { pickAllowedFields } from '@/lib/validation';

// Only these columns can be set by a client on create. Columns the
// server controls (id, created_by, created_at, deleted_at, deleted_by,
// fuel_last_updated) are NOT in this list — a client that slips them
// into the payload silently drops them instead of overriding server
// logic. Keep this allow-list in sync with the Aircraft type.
const AIRCRAFT_ALLOWED_FIELDS = [
  'tail_number', 'serial_number', 'aircraft_type', 'engine_type',
  'total_airframe_time', 'total_engine_time',
  'setup_aftt', 'setup_ftt', 'setup_hobbs', 'setup_tach',
  'home_airport',
  'main_contact', 'main_contact_phone', 'main_contact_email',
  'mx_contact', 'mx_contact_phone', 'mx_contact_email',
  'avatar_url', 'current_fuel_gallons',
  'make', 'model', 'year_mfg',
  'is_ifr_equipped', 'is_for_hire',
  'time_zone',
] as const;

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const body = await req.json();
    const payload = body?.payload;

    if (!payload || typeof payload !== 'object' || !payload.tail_number) {
      return NextResponse.json({ error: 'Aircraft payload with tail_number is required.' }, { status: 400 });
    }

    const safePayload: Record<string, unknown> = {
      ...pickAllowedFields(payload, AIRCRAFT_ALLOWED_FIELDS),
      created_by: user.id,
    };

    await setAppUser(supabaseAdmin, user.id);

    // One-shot RPC (migration 034) does the three writes that used to
    // happen sequentially — aircraft insert, admin access grant, and
    // onboarding flag — inside a single transaction so a failure in
    // any step rolls back the others instead of leaving an orphan.
    const { data: newAircraft, error: insertError } = await supabaseAdmin
      .rpc('create_aircraft_atomic', { p_user_id: user.id, p_payload: safePayload })
      .single<typeof safePayload & { id: string }>();

    if (insertError) {
      if (insertError.code === '23505') {
        // 23505 from this RPC is almost always the tail_number unique
        // index — the access INSERT can't conflict on a freshly-minted
        // aircraft.id, and the roles INSERT has ON CONFLICT. Resolve
        // *which fleet* already has it so the error is actionable:
        //   - their own (live or soft-deleted)  → tell them to switch
        //     in the aircraft picker, not "already exists" (the user
        //     reads that as "stuck — couldn't save anything").
        //   - someone else's                     → tell them the tail
        //     is on another fleet; they should double-check the
        //     registration mark.
        const tail = String(payload.tail_number).toUpperCase().trim();
        const { data: existing } = await supabaseAdmin
          .from('aft_aircraft')
          .select('id, created_by, deleted_at')
          .eq('tail_number', tail)
          .maybeSingle();

        if (existing?.created_by === user.id) {
          const isSoftDeleted = !!existing.deleted_at;
          return NextResponse.json({
            error: isSoftDeleted
              ? `You previously registered ${tail} and it's still in your archive. Restore it from the aircraft picker instead of re-registering.`
              : `${tail} is already on your fleet. Switch to it from the aircraft picker.`,
            existing_aircraft_id: existing.id,
            owned_by_caller: true,
          }, { status: 409 });
        }
        return NextResponse.json({
          error: `${tail} is registered to another fleet. Double-check the tail number — if it's truly yours, the previous owner needs to release it first.`,
          owned_by_caller: false,
        }, { status: 409 });
      }
      throw insertError;
    }

    return NextResponse.json({ success: true, aircraft: newAircraft });
  } catch (error) {
    return handleApiError(error);
  }
}

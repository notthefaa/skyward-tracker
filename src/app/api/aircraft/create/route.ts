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

    // Insert the aircraft
    const { data: newAircraft, error: insertError } = await supabaseAdmin
      .from('aft_aircraft')
      .insert(safePayload)
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return NextResponse.json({ error: 'An aircraft with this tail number already exists.' }, { status: 400 });
      }
      throw insertError;
    }

    // Assign the creator as a tailnumber admin
    await supabaseAdmin.from('aft_user_aircraft_access').insert({
      user_id: user.id,
      aircraft_id: newAircraft.id,
      aircraft_role: 'admin',
    });

    // Creating an aircraft IS onboarding completion for the form path.
    // The Howard-guided path flips this in propose_onboarding_setup's
    // executor; doing it here too means the form path doesn't need a
    // separate POST to /api/user/onboarding-complete that could fail
    // silently and leave the user bouncing back into onboarding on
    // next reload.
    await supabaseAdmin
      .from('aft_user_roles')
      .update({ completed_onboarding: true })
      .eq('user_id', user.id)
      .eq('completed_onboarding', false);

    return NextResponse.json({ success: true, aircraft: newAircraft });
  } catch (error) {
    return handleApiError(error);
  }
}

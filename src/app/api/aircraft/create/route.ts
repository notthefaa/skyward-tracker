import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { payload } = await req.json();

    if (!payload || !payload.tail_number) {
      return NextResponse.json({ error: 'Aircraft payload with tail_number is required.' }, { status: 400 });
    }

    // Ensure created_by is set
    payload.created_by = user.id;
    await setAppUser(supabaseAdmin, user.id);

    // Insert the aircraft
    const { data: newAircraft, error: insertError } = await supabaseAdmin
      .from('aft_aircraft')
      .insert(payload)
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

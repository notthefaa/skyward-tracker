import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { payload } = await req.json();

    if (!payload || !payload.tail_number) {
      return NextResponse.json({ error: 'Aircraft payload with tail_number is required.' }, { status: 400 });
    }

    // Ensure created_by is set
    payload.created_by = user.id;

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

    return NextResponse.json({ success: true, aircraft: newAircraft });
  } catch (error) {
    return handleApiError(error);
  }
}

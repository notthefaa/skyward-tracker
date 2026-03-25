import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    // Authenticate the caller — any logged-in user can create aircraft
    const { user, supabaseAdmin } = await requireAuth(req);
    const { payload } = await req.json();

    // SECURITY: Derive the userId from the verified session, NOT the client body
    const userId = user.id;

    // 1. Insert the new aircraft
    const { data: newAircraft, error: acError } = await supabaseAdmin
      .from('aft_aircraft')
      .insert(payload)
      .select()
      .single();

    if (acError || !newAircraft) throw acError || new Error('Failed to create aircraft.');

    // 2. Immediately assign this new aircraft to the pilot who created it
    const { error: accessError } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .insert({
        user_id: userId,
        aircraft_id: newAircraft.id
      } as any);

    if (accessError) throw accessError;

    return NextResponse.json({ success: true, aircraft: newAircraft });
  } catch (error) {
    return handleApiError(error);
  }
}

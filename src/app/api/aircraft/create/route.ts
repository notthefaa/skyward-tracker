import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { payload, userId } = await req.json();

    // Use the Service Role Key to bypass RLS securely on the backend
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Insert the new aircraft
    const { data: newAircraft, error: acError } = await supabaseAdmin
      .from('aft_aircraft')
      .insert(payload)
      .select()
      .single();

    if (acError) throw acError;

    // 2. Immediately assign this new aircraft to the pilot who created it
    if (userId) {
      const { error: accessError } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .insert({
          user_id: userId,
          aircraft_id: newAircraft.id
        });
        
      if (accessError) throw accessError;
    }

    return NextResponse.json({ success: true, aircraft: newAircraft });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
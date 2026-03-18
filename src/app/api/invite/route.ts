import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { email, role, aircraftIds } = await req.json();
    
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${new URL(req.url).origin}/update-password`
    });

    if (error) throw error;

    if (data.user) {
      // 1. Create the Role Profile
      await supabaseAdmin.from('aft_user_roles').upsert({
        user_id: data.user.id,
        role: role,
        email: email
      });

      // 2. Assign the Aircraft instantly
      if (aircraftIds && aircraftIds.length > 0) {
        const accessInserts = aircraftIds.map((id: string) => ({
          user_id: data.user.id,
          aircraft_id: id
        }));
        await supabaseAdmin.from('aft_user_aircraft_access').insert(accessInserts);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
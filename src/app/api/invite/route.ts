import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    // SECURITY: Only admins can invite users
    const { supabaseAdmin } = await requireAuth(req, 'admin');
    const { email, role, aircraftIds } = await req.json();

    if (!email || !role) {
      return NextResponse.json({ error: 'Email and role are required.' }, { status: 400 });
    }

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

      // 2. Assign the Aircraft instantly. The access row NEEDS an
      //    aircraft_role — downstream gates compare it against
      //    'admin' / 'pilot' string literals, and a NULL value means
      //    the user would silently be treated as having no role. We
      //    default to 'pilot'; a caller who wants to mint admins must
      //    do it from Admin Modals (which specifies the role).
      if (aircraftIds && aircraftIds.length > 0) {
        const accessInserts = aircraftIds.map((id: string) => ({
          user_id: data.user.id,
          aircraft_id: id,
          aircraft_role: 'pilot',
        }));
        await supabaseAdmin.from('aft_user_aircraft_access').insert(accessInserts);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

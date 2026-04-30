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
    // Reject anything other than the two roles downstream gates know
    // about — without this an arbitrary string would land in
    // aft_user_roles.role and silently fail every role-based check.
    if (!['admin', 'pilot'].includes(role)) {
      return NextResponse.json({ error: 'Role must be "admin" or "pilot".' }, { status: 400 });
    }

    // Lowercase the address before storing it. Supabase auth normalizes
    // case internally, but pilot-invite (and other lookups) match by
    // exact-case `aft_user_roles.email`, so a "Foo@bar.com" stored
    // as-typed silently fails to match a later "foo@bar.com" lookup.
    const normalizedEmail = email.toLowerCase().trim();

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo: `${new URL(req.url).origin}/update-password`
    });

    if (error) throw error;

    if (data.user) {
      // 1. Create the Role Profile
      const { error: roleErr } = await supabaseAdmin.from('aft_user_roles').upsert({
        user_id: data.user.id,
        role: role,
        email: normalizedEmail,
      });
      if (roleErr) throw roleErr;

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
        const { error: accessErr } = await supabaseAdmin.from('aft_user_aircraft_access').insert(accessInserts);
        if (accessErr) throw accessErr;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

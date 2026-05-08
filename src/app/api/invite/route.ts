import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';
import { idempotency } from '@/lib/idempotency';

export async function POST(req: Request) {
  try {
    // SECURITY: Only admins can invite users
    const { user, supabaseAdmin } = await requireAuth(req, 'admin');
    const { email, role, aircraftIds } = await req.json();

    if (!email || !role) {
      return NextResponse.json({ error: 'Email and role are required.' }, { status: 400 });
    }

    // Idempotency — admin double-tap on Invite would otherwise fire
    // two Supabase Auth invite calls (the second hits the project-wide
    // 429 throttle and surfaces as a "rate limit" error to the admin
    // even though the first invite landed). Cached replay returns the
    // same {success:true}.
    const idem = idempotency(supabaseAdmin, user.id, req, 'invite');
    const cached = await idem.check();
    if (cached) return cached;
    // Reject anything other than the three role values the dropdown
    // emits — without this an arbitrary string would land in
    // aft_user_roles.role and silently fail every role-based check.
    // 'aircraft_admin' is a UI-only synonym; we split it below into
    // a global pilot role + per-aircraft admin role.
    if (!['admin', 'aircraft_admin', 'pilot'].includes(role)) {
      return NextResponse.json({ error: 'Role must be "admin", "aircraft_admin", or "pilot".' }, { status: 400 });
    }

    // Aircraft admin only makes sense when scoped to at least one
    // aircraft; otherwise the invite mints a user with the global
    // pilot role and no access rows — i.e. no admin authority anywhere.
    if (role === 'aircraft_admin' && (!Array.isArray(aircraftIds) || aircraftIds.length === 0)) {
      return NextResponse.json({ error: 'Aircraft administrators must be assigned to at least one aircraft.' }, { status: 400 });
    }

    // Split the UI value into the two columns the schema actually
    // stores. Global admins keep their per-aircraft access at 'pilot'
    // (their global role supersedes anyway); aircraft admins get a
    // global pilot role with admin authority on each assigned tail.
    const globalRole: 'admin' | 'pilot' = role === 'admin' ? 'admin' : 'pilot';
    const perAircraftRole: 'admin' | 'pilot' = role === 'aircraft_admin' ? 'admin' : 'pilot';

    // Lowercase the address before storing it. Supabase auth normalizes
    // case internally, but pilot-invite (and other lookups) match by
    // exact-case `aft_user_roles.email`, so a "Foo@bar.com" stored
    // as-typed silently fails to match a later "foo@bar.com" lookup.
    const normalizedEmail = email.toLowerCase().trim();

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo: `${new URL(req.url).origin}/update-password`
    });

    if (error) {
      // Surface Supabase Auth's project-wide invite throttle as a
      // friendlier 429 instead of a generic 500. The cap resets after
      // a few minutes; admins benefit from knowing why the click failed.
      const msg = (error as any).message || '';
      const status = (error as any).status;
      if (status === 429 || /rate limit/i.test(msg)) {
        return NextResponse.json(
          { error: 'Too many invites sent in a short window. Wait a few minutes and try again — Supabase Auth caps invite throughput per project.' },
          { status: 429 }
        );
      }
      throw error;
    }

    if (data.user) {
      // 1. Create the Role Profile.
      //
      // completed_onboarding is TRUE only when the invitee is being added
      // to an existing fleet (aircraftIds non-empty) — they shouldn't
      // land in Howard's onboarding chat / manual form, both of which
      // create a NEW aircraft they didn't ask for. With no aircraft
      // pre-assigned the invitee is starting fresh, so leave the flag
      // false: they'll land in the welcome modal and pick guided chat
      // or form to create their own first aircraft. Tour stays false
      // either way so the 30-second orientation still plays.
      const fleetMembershipPreassigned = Array.isArray(aircraftIds) && aircraftIds.length > 0;
      const { error: roleErr } = await supabaseAdmin.from('aft_user_roles').upsert({
        user_id: data.user.id,
        role: globalRole,
        email: normalizedEmail,
        completed_onboarding: fleetMembershipPreassigned,
      });
      if (roleErr) throw roleErr;

      // 2. Assign the Aircraft instantly. The access row NEEDS an
      //    aircraft_role — downstream gates compare it against
      //    'admin' / 'pilot' string literals, and a NULL value means
      //    the user would silently be treated as having no role.
      //    perAircraftRole is 'admin' only when the inviter picked
      //    "Aircraft Administrator"; otherwise pilot.
      if (aircraftIds && aircraftIds.length > 0) {
        const accessInserts = aircraftIds.map((id: string) => ({
          user_id: data.user.id,
          aircraft_id: id,
          aircraft_role: perAircraftRole,
        }));
        const { error: accessErr } = await supabaseAdmin.from('aft_user_aircraft_access').insert(accessInserts);
        if (accessErr) throw accessErr;
      }
    }

    const responseBody = { success: true };
    await idem.save(200, responseBody);
    return NextResponse.json(responseBody);
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { email, aircraftId, aircraftRole } = await req.json();

    if (!email || !aircraftId) {
      return NextResponse.json({ error: 'Email and aircraft ID are required.' }, { status: 400 });
    }

    if (!aircraftRole || !['admin', 'pilot'].includes(aircraftRole)) {
      return NextResponse.json({ error: 'Aircraft role must be "admin" or "pilot".' }, { status: 400 });
    }

    // Verify the caller has tailnumber admin rights OR is a global admin
    const { data: callerRole } = await supabaseAdmin
      .from('aft_user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    const isGlobalAdmin = callerRole?.role === 'admin';

    if (!isGlobalAdmin) {
      // Check if caller is a tailnumber admin for this aircraft
      const { data: callerAccess } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('aircraft_role')
        .eq('user_id', user.id)
        .eq('aircraft_id', aircraftId)
        .single();

      if (!callerAccess || callerAccess.aircraft_role !== 'admin') {
        return NextResponse.json(
          { error: 'You do not have admin privileges for this aircraft.' },
          { status: 403 }
        );
      }
    }

    // Check if the user already exists in the system. Throw on read
    // error: a swallowed failure here falls through to the "user
    // doesn't exist" branch and re-mints the auth account, sending a
    // duplicate invite or stomping a real existing user.
    const { data: existingUsers, error: existingErr } = await supabaseAdmin
      .from('aft_user_roles')
      .select('user_id, email')
      .eq('email', email.toLowerCase());
    if (existingErr) throw existingErr;

    let targetUserId: string;

    if (existingUsers && existingUsers.length > 0) {
      // User already exists — add or update aircraft access
      targetUserId = existingUsers[0].user_id;

      // Check the current access row so we can return a friendly "already
      // assigned" message when the role hasn't actually changed.
      const { data: existingAccess } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('aircraft_role')
        .eq('user_id', targetUserId)
        .eq('aircraft_id', aircraftId)
        .maybeSingle();

      if (existingAccess && existingAccess.aircraft_role === aircraftRole) {
        return NextResponse.json({ error: 'This user already has access to this aircraft.' }, { status: 400 });
      }

      // Upsert rather than insert so a concurrent invite can't collide on
      // the (user_id, aircraft_id) unique constraint and throw 23505.
      const { error: upsertError } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .upsert(
          { user_id: targetUserId, aircraft_id: aircraftId, aircraft_role: aircraftRole },
          { onConflict: 'user_id,aircraft_id' }
        );
      if (upsertError) throw upsertError;

      return NextResponse.json({
        success: true,
        message: existingAccess ? 'User role updated.' : 'User added to aircraft.',
      });

    } else {
      // User doesn't exist — invite via Supabase Auth
      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${new URL(req.url).origin}/update-password`
      });

      if (inviteError) throw inviteError;

      if (inviteData.user) {
        targetUserId = inviteData.user.id;

        // Create role profile as pilot (not global admin). Throw on
        // failure — without the role row, the user lands in the app
        // with no role and no aircraft, and aft_user_aircraft_access
        // would orphan since access rows depend on the user existing
        // in aft_user_roles for downstream role-based gates.
        //
        // Mark completed_onboarding=true: invited pilots already have
        // an aircraft assignment — they shouldn't be forced through the
        // welcome modal that asks them to create a new aircraft from
        // scratch. Tour stays false so they still get the spotlight
        // orientation on first sign-in.
        const { error: roleErr } = await supabaseAdmin.from('aft_user_roles').upsert({
          user_id: targetUserId,
          role: 'pilot',
          email: email.toLowerCase(),
          completed_onboarding: true,
        });
        if (roleErr) throw roleErr;

        // Upsert aircraft access — same reasoning as above.
        const { error: accessError } = await supabaseAdmin
          .from('aft_user_aircraft_access')
          .upsert(
            { user_id: targetUserId, aircraft_id: aircraftId, aircraft_role: aircraftRole },
            { onConflict: 'user_id,aircraft_id' }
          );
        if (accessError) throw accessError;
      }

      return NextResponse.json({ success: true, message: 'Invitation sent.' });
    }
  } catch (error) {
    return handleApiError(error);
  }
}

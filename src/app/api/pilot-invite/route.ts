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

    // Check if the user already exists in the system
    const { data: existingUsers } = await supabaseAdmin
      .from('aft_user_roles')
      .select('user_id, email')
      .eq('email', email.toLowerCase());

    let targetUserId: string;

    if (existingUsers && existingUsers.length > 0) {
      // User already exists — just add aircraft access
      targetUserId = existingUsers[0].user_id;

      // Check if they already have access to this aircraft
      const { data: existingAccess } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('aircraft_role')
        .eq('user_id', targetUserId)
        .eq('aircraft_id', aircraftId)
        .single();

      if (existingAccess) {
        // Already assigned — update role if different
        if (existingAccess.aircraft_role !== aircraftRole) {
          await supabaseAdmin
            .from('aft_user_aircraft_access')
            .update({ aircraft_role: aircraftRole })
            .eq('user_id', targetUserId)
            .eq('aircraft_id', aircraftId);
          return NextResponse.json({ success: true, message: 'User role updated.' });
        }
        return NextResponse.json({ error: 'This user already has access to this aircraft.' }, { status: 400 });
      }

      // Add access
      await supabaseAdmin.from('aft_user_aircraft_access').insert({
        user_id: targetUserId,
        aircraft_id: aircraftId,
        aircraft_role: aircraftRole,
      });

      return NextResponse.json({ success: true, message: 'User added to aircraft.' });

    } else {
      // User doesn't exist — invite via Supabase Auth
      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${new URL(req.url).origin}/update-password`
      });

      if (inviteError) throw inviteError;

      if (inviteData.user) {
        targetUserId = inviteData.user.id;

        // Create role profile as pilot (not global admin)
        await supabaseAdmin.from('aft_user_roles').upsert({
          user_id: targetUserId,
          role: 'pilot',
          email: email.toLowerCase(),
        });

        // Assign to the aircraft with the specified role
        await supabaseAdmin.from('aft_user_aircraft_access').insert({
          user_id: targetUserId,
          aircraft_id: aircraftId,
          aircraft_role: aircraftRole,
        });
      }

      return NextResponse.json({ success: true, message: 'Invitation sent.' });
    }
  } catch (error) {
    return handleApiError(error);
  }
}

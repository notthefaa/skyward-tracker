import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';
import { cancelConflictingReservations } from '@/lib/mxConflicts';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, startDate, endDate, notes } = await req.json();

    if (!aircraftId || !startDate) {
      return NextResponse.json({ error: 'Aircraft ID and start date are required.' }, { status: 400 });
    }

    // Verify the user has access to this aircraft
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    // Check the user is a global admin or aircraft admin
    const { data: roleData } = await supabaseAdmin
      .from('aft_user_roles').select('role').eq('user_id', user.id).single();
    const isGlobalAdmin = roleData?.role === 'admin';

    if (!isGlobalAdmin) {
      const { data: access } = await supabaseAdmin
        .from('aft_user_aircraft_access').select('aircraft_role')
        .eq('user_id', user.id).eq('aircraft_id', aircraftId).single();
      if (access?.aircraft_role !== 'admin') {
        return NextResponse.json({ error: 'Only admins can create maintenance blocks.' }, { status: 403 });
      }
    }

    // Get user profile for contact info
    const { data: profile } = await supabaseAdmin
      .from('aft_user_profiles').select('full_name, email')
      .eq('user_id', user.id).single();

    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events')
      .insert({
        aircraft_id: aircraftId,
        created_by: user.id,
        status: 'confirmed',
        confirmed_date: startDate,
        confirmed_at: new Date().toISOString(),
        estimated_completion: endDate || startDate,
        mechanic_notes: notes || null,
        mx_contact_name: profile?.full_name || null,
        primary_contact_name: profile?.full_name || null,
        primary_contact_email: profile?.email || user.email || null,
      } as any)
      .select()
      .single();

    if (evErr || !event) {
      return NextResponse.json({ error: 'Failed to create maintenance block.' }, { status: 500 });
    }

    // Log a system message
    await supabaseAdmin.from('aft_event_messages').insert({
      event_id: event.id,
      sender: 'system',
      message_type: 'status_update',
      message: `Maintenance block created by ${profile?.full_name || 'admin'} for ${startDate}${endDate && endDate !== startDate ? ` – ${endDate}` : ''}.${notes ? ` Notes: ${notes}` : ''}`,
    } as any);

    // Cancel any overlapping reservations and notify affected pilots
    const { data: aircraft } = await supabaseAdmin
      .from('aft_aircraft').select('tail_number').eq('id', aircraftId).single();

    const appUrl = req.headers.get('origin') || 'https://app.skywardsociety.com';

    const cancelledCount = await cancelConflictingReservations({
      supabaseAdmin,
      aircraftId,
      confirmedDate: startDate,
      estimatedCompletion: endDate || startDate,
      tailNumber: aircraft?.tail_number || 'N/A',
      mechanicName: profile?.full_name || null,
      appUrl,
    });

    return NextResponse.json({ success: true, eventId: event.id, cancelledReservations: cancelledCount });
  } catch (error) {
    return handleApiError(error);
  }
}

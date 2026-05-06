import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { cancelConflictingReservations } from '@/lib/mxConflicts';
import { idempotency } from '@/lib/idempotency';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, startDate, endDate, notes, timeZone } = await req.json();

    if (!aircraftId || !startDate) {
      return NextResponse.json({ error: 'Aircraft ID and start date are required.' }, { status: 400 });
    }
    // Reject ranges where end is before start so we never store a block that
    // would never block anything (and would still cancel reservations on the
    // start day via `cancelConflictingReservations`).
    if (endDate && endDate < startDate) {
      return NextResponse.json({ error: 'End date must be on or after start date.' }, { status: 400 });
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

    await setAppUser(supabaseAdmin, user.id);

    // Double-tap protection: same X-Idempotency-Key returns the cached
    // result without re-creating the block + duplicating reservation
    // cancel emails to affected pilots.
    const idem = idempotency(supabaseAdmin, user.id, req, 'mx-events/block');
    const cached = await idem.check();
    if (cached) return cached;

    // Get the caller's name/email from aft_user_roles (the canonical table).
    const { data: profile } = await supabaseAdmin
      .from('aft_user_roles').select('full_name, email')
      .eq('user_id', user.id).maybeSingle();

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
      return NextResponse.json({ error: "Couldn't create the maintenance block." }, { status: 500 });
    }

    // Log a system message — throw on failure so an MX block can't
    // exist without an audit-trail entry of who created it and why.
    const { error: blockMsgErr } = await supabaseAdmin.from('aft_event_messages').insert({
      event_id: event.id,
      sender: 'system',
      message_type: 'status_update',
      message: `Maintenance block created by ${profile?.full_name || 'admin'} for ${startDate}${endDate && endDate !== startDate ? ` – ${endDate}` : ''}.${notes ? ` Notes: ${notes}` : ''}`,
    } as any);
    if (blockMsgErr) throw blockMsgErr;

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
      timeZone,
    });

    const responseBody = { success: true, eventId: event.id, cancelledReservations: cancelledCount };
    await idem.save(200, responseBody);
    return NextResponse.json(responseBody);
  } catch (error) {
    return handleApiError(error);
  }
}

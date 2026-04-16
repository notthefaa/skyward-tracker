import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, mxItemIds, squawkIds, addonServices, proposedDate } = await req.json();

    if (!aircraftId) {
      return NextResponse.json({ error: 'Aircraft ID is required.' }, { status: 400 });
    }

    // Verify the user is an admin for this aircraft
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    await setAppUser(supabaseAdmin, user.id);

    const { data: aircraft, error: acErr } = await supabaseAdmin
      .from('aft_aircraft').select('*').eq('id', aircraftId).is('deleted_at', null).maybeSingle();
    if (acErr || !aircraft) {
      return NextResponse.json({ error: 'Aircraft not found.' }, { status: 404 });
    }

    // 1. Create the maintenance event as DRAFT (no email sent yet)
    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events')
      .insert({
        aircraft_id: aircraftId,
        created_by: user.id,
        status: 'draft',
        proposed_date: proposedDate || null,
        proposed_by: proposedDate ? 'owner' : null,
        addon_services: addonServices || [],
        mx_contact_name: aircraft.mx_contact || null,
        mx_contact_email: aircraft.mx_contact_email || null,
        primary_contact_name: aircraft.main_contact || null,
        primary_contact_email: aircraft.main_contact_email || null,
      } as any)
      .select()
      .single();

    if (evErr || !event) {
      return NextResponse.json({ error: 'Failed to create maintenance event.' }, { status: 500 });
    }

    // 2. Create line items from MX items
    if (mxItemIds && mxItemIds.length > 0) {
      const { data: mxItems } = await supabaseAdmin
        .from('aft_maintenance_items').select('*').in('id', mxItemIds).is('deleted_at', null);

      if (mxItems && mxItems.length > 0) {
        const lineItems = mxItems.map((mx: any) => ({
          event_id: event.id,
          item_type: 'maintenance',
          maintenance_item_id: mx.id,
          item_name: mx.item_name,
          item_description: mx.tracking_type === 'time'
            ? `Due at ${mx.due_time} hrs`
            : `Due on ${mx.due_date}`,
        }));
        await supabaseAdmin.from('aft_event_line_items').insert(lineItems);
      }
    }

    // 3. Create line items from squawks
    if (squawkIds && squawkIds.length > 0) {
      const { data: squawks } = await supabaseAdmin
        .from('aft_squawks').select('*').in('id', squawkIds).is('deleted_at', null);

      if (squawks && squawks.length > 0) {
        const lineItems = squawks.map((sq: any) => ({
          event_id: event.id,
          item_type: 'squawk',
          squawk_id: sq.id,
          item_name: sq.description ? `Squawk: ${sq.description}` : `Squawk: ${sq.location || 'No description'}`,
          item_description: sq.affects_airworthiness && sq.location ? `Grounded at ${sq.location}` : (sq.description || null),
        }));
        await supabaseAdmin.from('aft_event_line_items').insert(lineItems);
      }
    }

    // 4. Create line items from add-on services
    if (addonServices && addonServices.length > 0) {
      const lineItems = addonServices.map((service: string) => ({
        event_id: event.id,
        item_type: 'addon',
        item_name: service,
        item_description: null,
      }));
      await supabaseAdmin.from('aft_event_line_items').insert(lineItems);
    }

    // 5. Log the initial message
    await supabaseAdmin.from('aft_event_messages').insert({
      event_id: event.id,
      sender: 'system',
      message_type: 'status_update',
      message: proposedDate
        ? `Work package created. Preferred date: ${proposedDate}. Ready to send to mechanic.`
        : 'Work package created. Ready to send to mechanic.',
    } as any);

    return NextResponse.json({ success: true, eventId: event.id });
  } catch (error) {
    return handleApiError(error);
  }
}

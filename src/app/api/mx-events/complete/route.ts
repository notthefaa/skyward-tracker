import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { eventId, lineCompletions, partial } = await req.json();

    if (!eventId || !lineCompletions || !Array.isArray(lineCompletions)) {
      return NextResponse.json({ error: 'Event ID and line completions are required.' }, { status: 400 });
    }

    // Fetch the event
    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events').select('*').eq('id', eventId).single();

    if (evErr || !event) {
      return NextResponse.json({ error: 'Maintenance event not found.' }, { status: 404 });
    }

    // Verify the user is an admin for this aircraft
    await requireAircraftAdmin(supabaseAdmin, user.id, event.aircraft_id);

    // Process each line item completion
    const completedNames: string[] = [];

    for (const completion of lineCompletions) {
      const { lineItemId, completionDate, completionTime, completedByName, completedByCert, workDescription } = completion;

      // Update the line item with completion data
      await supabaseAdmin.from('aft_event_line_items').update({
        line_status: 'complete',
        completion_date: completionDate || null,
        completion_time: completionTime ? parseFloat(completionTime) : null,
        completed_by_name: completedByName || null,
        completed_by_cert: completedByCert || null,
        work_description: workDescription || null,
      }).eq('id', lineItemId).eq('event_id', eventId);

      // Fetch the line item to check if it's linked to an MX item
      const { data: lineItem } = await supabaseAdmin
        .from('aft_event_line_items').select('*').eq('id', lineItemId).single();

      if (lineItem) {
        completedNames.push(lineItem.item_name);

        if (lineItem.maintenance_item_id) {
          // Fetch the original MX item to get the interval
          const { data: mxItem } = await supabaseAdmin
            .from('aft_maintenance_items').select('*').eq('id', lineItem.maintenance_item_id).single();

          if (mxItem) {
            const mxUpdate: any = {
              // Reset reminder flags
              reminder_5_sent: false,
              reminder_15_sent: false,
              reminder_30_sent: false,
              mx_schedule_sent: false,
              primary_heads_up_sent: false,
            };

            if (mxItem.tracking_type === 'time' && completionTime) {
              mxUpdate.last_completed_time = parseFloat(completionTime);
              if (mxItem.time_interval) {
                mxUpdate.due_time = parseFloat(completionTime) + mxItem.time_interval;
              }
            } else if (mxItem.tracking_type === 'date' && completionDate) {
              mxUpdate.last_completed_date = completionDate;
              if (mxItem.date_interval_days) {
                // Parse the completion date as UTC midnight so getUTC*/setUTC* stays
                // in-sync. Using bare `new Date('YYYY-MM-DD')` + local getDate/setDate
                // shifts the result by one day in negative-UTC zones.
                const nextDue = new Date(completionDate + 'T00:00:00Z');
                nextDue.setUTCDate(nextDue.getUTCDate() + mxItem.date_interval_days);
                mxUpdate.due_date = nextDue.toISOString().split('T')[0];
              }
            }

            await supabaseAdmin.from('aft_maintenance_items')
              .update(mxUpdate).eq('id', mxItem.id);
          }
        }

        // If it's a squawk line item, resolve the squawk and record the service event reference
        if (lineItem.squawk_id) {
          await supabaseAdmin.from('aft_squawks').update({
            status: 'resolved',
            affects_airworthiness: false,
            resolved_by_event_id: eventId,
          }).eq('id', lineItem.squawk_id);
        }
      }
    }

    // Check if ALL line items in the event are now resolved (complete or deferred)
    const { data: allItems } = await supabaseAdmin
      .from('aft_event_line_items').select('line_status').eq('event_id', eventId);

    const allResolved = allItems && allItems.every(
      (li: any) => li.line_status === 'complete' || li.line_status === 'deferred'
    );

    if (allResolved && !partial) {
      // All items done and caller didn't request partial — close the event
      await supabaseAdmin.from('aft_maintenance_events').update({
        status: 'complete',
        completed_at: new Date().toISOString(),
      }).eq('id', eventId);

      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: eventId,
        sender: 'system',
        message_type: 'status_update',
        message: 'Maintenance event completed. All tracking items have been reset.',
      } as any);
    } else if (allResolved && partial) {
      // All resolved but caller used partial mode — mark complete automatically
      await supabaseAdmin.from('aft_maintenance_events').update({
        status: 'complete',
        completed_at: new Date().toISOString(),
      }).eq('id', eventId);

      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: eventId,
        sender: 'system',
        message_type: 'status_update',
        message: 'All items resolved. Maintenance event completed and tracking reset.',
      } as any);
    } else {
      // Partial completion — log what was completed, keep event open
      const itemList = completedNames.join(', ');
      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: eventId,
        sender: 'system',
        message_type: 'status_update',
        message: `Logbook data entered for: ${itemList}. Tracking reset for completed items. Remaining items still open.`,
      } as any);
    }

    return NextResponse.json({ success: true, allResolved: !!allResolved });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { supabaseAdmin } = await requireAuth(req);
    const { eventId, lineCompletions } = await req.json();

    if (!eventId || !lineCompletions || !Array.isArray(lineCompletions)) {
      return NextResponse.json({ error: 'Event ID and line completions are required.' }, { status: 400 });
    }

    // Fetch the event
    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events').select('*').eq('id', eventId).single();

    if (evErr || !event) {
      return NextResponse.json({ error: 'Maintenance event not found.' }, { status: 404 });
    }

    // Process each line item completion
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

      if (lineItem && lineItem.maintenance_item_id) {
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
            // Reset time-based tracking using logbook time
            mxUpdate.last_completed_time = parseFloat(completionTime);

            if (mxItem.time_interval) {
              // Auto-calculate next due time from logbook entry time + interval
              mxUpdate.due_time = parseFloat(completionTime) + mxItem.time_interval;
            }
          } else if (mxItem.tracking_type === 'date' && completionDate) {
            // Reset date-based tracking using logbook date
            mxUpdate.last_completed_date = completionDate;

            if (mxItem.date_interval_days) {
              // Auto-calculate next due date from logbook entry date + interval
              const nextDue = new Date(completionDate);
              nextDue.setDate(nextDue.getDate() + mxItem.date_interval_days);
              mxUpdate.due_date = nextDue.toISOString().split('T')[0];
            }
          }

          await supabaseAdmin.from('aft_maintenance_items')
            .update(mxUpdate).eq('id', mxItem.id);
        }
      }

      // If it's a squawk line item, resolve the squawk
      if (lineItem && lineItem.squawk_id) {
        await supabaseAdmin.from('aft_squawks').update({
          status: 'resolved',
          affects_airworthiness: false,
        }).eq('id', lineItem.squawk_id);
      }
    }

    // Mark the event as complete
    await supabaseAdmin.from('aft_maintenance_events').update({
      status: 'complete',
      completed_at: new Date().toISOString(),
    }).eq('id', eventId);

    // Log system message
    await supabaseAdmin.from('aft_event_messages').insert({
      event_id: eventId,
      sender: 'system',
      message_type: 'status_update',
      message: 'Maintenance event completed. All tracking items have been reset.',
    } as any);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

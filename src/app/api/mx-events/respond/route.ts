import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient, handleApiError } from '@/lib/auth';
import { env } from '@/lib/env';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    const { accessToken, action, proposedDate, message, lineItemUpdates } = await req.json();

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required.' }, { status: 400 });
    }

    // NOTE: This route is intentionally unauthenticated — mechanics access
    // it via a secure unguessable token in the portal URL, same pattern as
    // the squawk viewer. The access_token is a 64-char hex string (256 bits).
    const supabaseAdmin = createAdminClient();

    // Verify the token and fetch the event
    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events')
      .select('*')
      .eq('access_token', accessToken)
      .single();

    if (evErr || !event) {
      return NextResponse.json({ error: 'Service event not found.' }, { status: 404 });
    }

    // Handle different mechanic actions
    if (action === 'propose_date') {
      if (!proposedDate) {
        return NextResponse.json({ error: 'Proposed date is required.' }, { status: 400 });
      }

      // Update event with mechanic's proposed date
      await supabaseAdmin.from('aft_maintenance_events').update({
        proposed_date: proposedDate,
        proposed_by: 'mechanic',
      }).eq('id', event.id);

      // Log the message
      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'propose_date',
        proposed_date: proposedDate,
        message: message || `Proposed service date: ${proposedDate}`,
      } as any);

      // Email the primary contact
      if (event.primary_contact_email) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: `Schedule Update: ${event.mx_contact_name || 'Your mechanic'} proposed ${proposedDate}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #1B4869;">Schedule Proposal</h2>
              <p>${event.mx_contact_name || 'Your maintenance provider'} has proposed <strong>${proposedDate}</strong> for service on your aircraft.</p>
              ${message ? `<p style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-left: 4px solid #F08B46; border-radius: 4px;"><em>${message}</em></p>` : ''}
              <p style="margin-top: 20px;">Log in to the fleet portal to confirm or propose a different date.</p>
            </div>
          `
        });
      }

    } else if (action === 'confirm') {
      // Mechanic confirms the owner's proposed date
      await supabaseAdmin.from('aft_maintenance_events').update({
        status: 'confirmed',
        confirmed_date: event.proposed_date,
        confirmed_at: new Date().toISOString(),
      }).eq('id', event.id);

      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'confirm',
        proposed_date: event.proposed_date,
        message: message || `Confirmed for ${event.proposed_date}. We'll see you then.`,
      } as any);

      if (event.primary_contact_email) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: `Confirmed: ${event.proposed_date} Service Appointment`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #56B94A;">Appointment Confirmed</h2>
              <p>${event.mx_contact_name || 'Your maintenance provider'} has confirmed service for <strong>${event.proposed_date}</strong>.</p>
              ${message ? `<p style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-left: 4px solid #56B94A; border-radius: 4px;"><em>${message}</em></p>` : ''}
            </div>
          `
        });
      }

    } else if (action === 'comment') {
      // General comment or status update from mechanic
      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'comment',
        message: message || '',
      } as any);

      if (event.primary_contact_email) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: `Service Update from ${event.mx_contact_name || 'your mechanic'}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #1B4869;">Service Update</h2>
              <p style="padding: 15px; background: #f9f9f9; border-left: 4px solid #3AB0FF; border-radius: 4px;">${message}</p>
            </div>
          `
        });
      }

    } else if (action === 'update_lines') {
      // Mechanic updates line item statuses
      if (lineItemUpdates && Array.isArray(lineItemUpdates)) {
        for (const update of lineItemUpdates) {
          const updatePayload: any = {};
          if (update.line_status) updatePayload.line_status = update.line_status;
          if (update.mechanic_comment !== undefined) updatePayload.mechanic_comment = update.mechanic_comment;
          if (Object.keys(updatePayload).length > 0) {
            await supabaseAdmin.from('aft_event_line_items')
              .update(updatePayload)
              .eq('id', update.id)
              .eq('event_id', event.id); // Safety: ensure line belongs to this event
          }
        }
      }

    } else if (action === 'update_estimate') {
      // Mechanic updates estimated completion date and/or notes
      const updatePayload: any = {};
      if (proposedDate) updatePayload.estimated_completion = proposedDate;
      if (message !== undefined) updatePayload.mechanic_notes = message;
      
      await supabaseAdmin.from('aft_maintenance_events')
        .update(updatePayload).eq('id', event.id);

      if (event.primary_contact_email && proposedDate) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: `Estimated Completion: ${proposedDate}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #1B4869;">Completion Estimate</h2>
              <p>${event.mx_contact_name || 'Your maintenance provider'} estimates your aircraft will be ready by <strong>${proposedDate}</strong>.</p>
              ${message ? `<p style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-left: 4px solid #F08B46; border-radius: 4px;"><em>${message}</em></p>` : ''}
            </div>
          `
        });
      }

    } else if (action === 'suggest_item') {
      // Mechanic discovers additional work needed and adds it to the work package
      const { itemName, itemDescription } = await req.json().catch(() => ({ itemName: null, itemDescription: null }));
      const suggestedName = itemName || message || 'Additional Work';

      await supabaseAdmin.from('aft_event_line_items').insert({
        event_id: event.id,
        item_type: 'addon',
        item_name: suggestedName,
        item_description: itemDescription || null,
        line_status: 'pending',
        mechanic_comment: 'Added by maintenance provider',
      } as any);

      // Log as a message so the owner sees it in the thread
      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'status_update',
        message: `Added item: ${suggestedName}${itemDescription ? ' — ' + itemDescription : ''}`,
      } as any);

      // Notify the owner
      if (event.primary_contact_email) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: `Additional Work Suggested: ${suggestedName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #F08B46;">Additional Work Found</h2>
              <p>${event.mx_contact_name || 'Your maintenance provider'} has identified additional work needed on your aircraft:</p>
              <div style="margin-top: 15px; padding: 15px; background: #FFF7ED; border-left: 4px solid #F08B46; border-radius: 4px;">
                <strong>${suggestedName}</strong>
                ${itemDescription ? `<p style="margin-top: 8px; color: #666;">${itemDescription}</p>` : ''}
              </div>
              <p style="margin-top: 20px;">Log in to the fleet portal to review.</p>
            </div>
          `
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

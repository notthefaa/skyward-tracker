import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient, handleApiError } from '@/lib/auth';
import { env } from '@/lib/env';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

const ctaButton = (url: string, label: string) => `
  <div style="margin-top: 25px; text-align: center;">
    <a href="${url}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; letter-spacing: 1px;">${label}</a>
  </div>
`;

export async function POST(req: Request) {
  try {
    const { accessToken, action, proposedDate, message, lineItemUpdates } = await req.json();

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required.' }, { status: 400 });
    }

    const supabaseAdmin = createAdminClient();
    const baseUrl = new URL(req.url).origin;

    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events')
      .select('*')
      .eq('access_token', accessToken)
      .single();

    if (evErr || !event) {
      return NextResponse.json({ error: 'Service event not found.' }, { status: 404 });
    }

    // Token expiry: reject actions on events completed more than 7 days ago
    if (event.status === 'complete' && event.completed_at) {
      const expiryDate = new Date(new Date(event.completed_at).getTime() + 7 * 24 * 60 * 60 * 1000);
      if (new Date() > expiryDate) {
        return NextResponse.json({ error: 'This service portal link has expired.' }, { status: 403 });
      }
    }

    const appUrl = baseUrl;

    if (action === 'propose_date') {
      await supabaseAdmin.from('aft_maintenance_events').update({
        proposed_date: proposedDate,
        proposed_by: 'mechanic',
      }).eq('id', event.id);

      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'propose_date',
        proposed_date: proposedDate,
        message: message || `Proposed service date: ${proposedDate}`,
      } as any);

      if (event.primary_contact_email) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: `Schedule Update: ${event.mx_contact_name || 'Your mechanic'} proposed ${proposedDate}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #091F3C;">Schedule Proposal</h2>
              <p>${event.mx_contact_name || 'Your maintenance provider'} has proposed <strong>${proposedDate}</strong> for service on your aircraft.</p>
              ${message ? `<p style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-left: 4px solid #F08B46; border-radius: 4px;"><em>${message}</em></p>` : ''}
              <p style="margin-top: 15px; color: #666;">Open the app to confirm or propose a different date.</p>
              ${ctaButton(appUrl, 'OPEN AIRCRAFT MANAGER')}
            </div>
          `
        });
      }

    } else if (action === 'confirm') {
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
              ${ctaButton(appUrl, 'OPEN AIRCRAFT MANAGER')}
            </div>
          `
        });
      }

    } else if (action === 'comment') {
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
              <h2 style="color: #091F3C;">Service Update</h2>
              <p>${event.mx_contact_name || 'Your maintenance provider'} sent a message:</p>
              <p style="padding: 15px; background: #f9f9f9; border-left: 4px solid #3AB0FF; border-radius: 4px;">${message}</p>
              ${ctaButton(appUrl, 'OPEN AIRCRAFT MANAGER')}
            </div>
          `
        });
      }

    } else if (action === 'update_lines') {
      if (lineItemUpdates && Array.isArray(lineItemUpdates)) {
        for (const update of lineItemUpdates) {
          const updatePayload: any = {};
          if (update.line_status) updatePayload.line_status = update.line_status;
          if (update.mechanic_comment !== undefined) updatePayload.mechanic_comment = update.mechanic_comment;
          if (Object.keys(updatePayload).length > 0) {
            await supabaseAdmin.from('aft_event_line_items')
              .update(updatePayload)
              .eq('id', update.id)
              .eq('event_id', event.id);
          }
        }

        const { data: allItems } = await supabaseAdmin
          .from('aft_event_line_items').select('item_name, line_status').eq('event_id', event.id);
        
        if (allItems && event.primary_contact_email) {
          const totalItems = allItems.length;
          const completedItems = allItems.filter((li: any) => li.line_status === 'complete').length;
          const inProgressItems = allItems.filter((li: any) => li.line_status === 'in_progress').length;

          const summaryLine = `${completedItems}/${totalItems} items complete` + (inProgressItems > 0 ? `, ${inProgressItems} in progress` : '');

          await resend.emails.send({
            from: `Skyward Operations <${FROM_EMAIL}>`,
            to: [event.primary_contact_email],
            subject: `Work Package Update — ${summaryLine}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #091F3C;">Work Package Progress</h2>
                <p>${event.mx_contact_name || 'Your maintenance provider'} updated the status of work items on your aircraft.</p>
                <div style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-radius: 4px;">
                  <p style="margin: 0; font-size: 16px;"><strong>${summaryLine}</strong></p>
                </div>
                <div style="margin-top: 15px;">
                  ${allItems.map((li: any) => {
                    const color = li.line_status === 'complete' ? '#56B94A' : li.line_status === 'in_progress' ? '#3AB0FF' : li.line_status === 'deferred' ? '#999' : '#F08B46';
                    return `<p style="margin: 4px 0; font-size: 14px;">• ${li.item_name} — <span style="color: ${color}; font-weight: bold; text-transform: uppercase;">${li.line_status}</span></p>`;
                  }).join('')}
                </div>
                ${ctaButton(appUrl, 'OPEN AIRCRAFT MANAGER')}
              </div>
            `
          });
        }
      }

    } else if (action === 'update_estimate') {
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
              <h2 style="color: #091F3C;">Completion Estimate</h2>
              <p>${event.mx_contact_name || 'Your maintenance provider'} estimates your aircraft will be ready by <strong>${proposedDate}</strong>.</p>
              ${message ? `<p style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-left: 4px solid #F08B46; border-radius: 4px;"><em>${message}</em></p>` : ''}
              ${ctaButton(appUrl, 'OPEN AIRCRAFT MANAGER')}
            </div>
          `
        });
      }

    } else if (action === 'suggest_item') {
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

      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'status_update',
        message: `Added item: ${suggestedName}${itemDescription ? ' — ' + itemDescription : ''}`,
      } as any);

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
              ${ctaButton(appUrl, 'OPEN AIRCRAFT MANAGER')}
            </div>
          `
        });
      }

    } else if (action === 'decline') {
      await supabaseAdmin.from('aft_maintenance_events').update({
        status: 'cancelled',
        mechanic_notes: message || 'Declined by maintenance provider.',
      }).eq('id', event.id);

      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'status_update',
        message: message || 'Service declined by maintenance provider.',
      } as any);

      if (event.primary_contact_email) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: `Service Declined by ${event.mx_contact_name || 'Maintenance Provider'}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #CE3732;">Service Declined</h2>
              <p>${event.mx_contact_name || 'Your maintenance provider'} has indicated they are unable to accommodate this service request.</p>
              ${message ? `<p style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-left: 4px solid #CE3732; border-radius: 4px;"><em>${message}</em></p>` : ''}
              <p style="margin-top: 15px; color: #666;">You may wish to contact an alternative maintenance provider or reschedule.</p>
              ${ctaButton(appUrl, 'OPEN AIRCRAFT MANAGER')}
            </div>
          `
        });
      }

    } else if (action === 'mark_ready') {
      await supabaseAdmin.from('aft_maintenance_events').update({
        status: 'ready_for_pickup',
      }).eq('id', event.id);

      await supabaseAdmin.from('aft_event_messages').insert({
        event_id: event.id,
        sender: 'mechanic',
        message_type: 'status_update',
        message: message || 'All work complete. Aircraft is ready for pickup.',
      } as any);

      if (event.primary_contact_email) {
        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to: [event.primary_contact_email],
          subject: `Aircraft Ready for Pickup`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #56B94A;">Aircraft Ready for Pickup!</h2>
              <p>${event.mx_contact_name || 'Your maintenance provider'} has completed all work and your aircraft is ready.</p>
              ${message ? `<p style="margin-top: 15px; padding: 15px; background: #f0fdf4; border-left: 4px solid #56B94A; border-radius: 4px;"><em>${message}</em></p>` : ''}
              <p style="margin-top: 15px; color: #666;">Please log in to enter the logbook data from your mechanic's sign-off to complete this service event and reset maintenance tracking.</p>
              ${ctaButton(appUrl, 'OPEN AIRCRAFT MANAGER')}
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

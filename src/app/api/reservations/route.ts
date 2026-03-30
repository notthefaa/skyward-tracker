import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireAuth, handleApiError } from '@/lib/auth';
import { env } from '@/lib/env';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, startTime, endTime, title, route } = await req.json();

    if (!aircraftId || !startTime || !endTime) {
      return NextResponse.json({ error: 'Aircraft, start time, and end time are required.' }, { status: 400 });
    }

    if (new Date(endTime) <= new Date(startTime)) {
      return NextResponse.json({ error: 'End time must be after start time.' }, { status: 400 });
    }

    // Verify user has access to this aircraft
    const { data: access } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('aircraft_role')
      .eq('user_id', user.id)
      .eq('aircraft_id', aircraftId)
      .single();

    if (!access) {
      return NextResponse.json({ error: 'You do not have access to this aircraft.' }, { status: 403 });
    }

    // Check for conflicting reservations
    const { data: conflicts } = await supabaseAdmin
      .from('aft_reservations')
      .select('*, pilot_name')
      .eq('aircraft_id', aircraftId)
      .eq('status', 'confirmed')
      .lt('start_time', endTime)
      .gt('end_time', startTime);

    if (conflicts && conflicts.length > 0) {
      const conflict = conflicts[0];
      const conflictStart = new Date(conflict.start_time).toLocaleString();
      const conflictEnd = new Date(conflict.end_time).toLocaleString();
      return NextResponse.json({
        error: `This aircraft is already booked by ${conflict.pilot_name || 'another pilot'} from ${conflictStart} to ${conflictEnd}.`
      }, { status: 409 });
    }

    // Check for conflicting maintenance events
    const { data: mxEvents } = await supabaseAdmin
      .from('aft_maintenance_events')
      .select('confirmed_date, estimated_completion, status')
      .eq('aircraft_id', aircraftId)
      .in('status', ['confirmed', 'in_progress']);

    if (mxEvents) {
      for (const ev of mxEvents) {
        if (ev.confirmed_date) {
          const mxStart = new Date(ev.confirmed_date + 'T00:00:00');
          const mxEnd = ev.estimated_completion 
            ? new Date(ev.estimated_completion + 'T23:59:59')
            : new Date(mxStart.getTime() + 24 * 60 * 60 * 1000); // Default 1 day

          if (new Date(startTime) < mxEnd && new Date(endTime) > mxStart) {
            return NextResponse.json({
              error: `This aircraft is scheduled for maintenance from ${ev.confirmed_date}${ev.estimated_completion ? ' to ' + ev.estimated_completion : ''}.`
            }, { status: 409 });
          }
        }
      }
    }

    // Get user info for the reservation
    const { data: userRole } = await supabaseAdmin
      .from('aft_user_roles')
      .select('initials, email')
      .eq('user_id', user.id)
      .single();

    // Create the reservation
    const { data: reservation, error: resError } = await supabaseAdmin
      .from('aft_reservations')
      .insert({
        aircraft_id: aircraftId,
        user_id: user.id,
        start_time: startTime,
        end_time: endTime,
        title: title || null,
        route: route || null,
        pilot_name: userRole?.email || user.email || 'Pilot',
        pilot_initials: userRole?.initials || '',
        status: 'confirmed',
      })
      .select()
      .single();

    if (resError) {
      // Exclusion constraint violation = overlap
      if (resError.code === '23P01') {
        return NextResponse.json({ error: 'This time slot conflicts with an existing reservation.' }, { status: 409 });
      }
      throw resError;
    }

    // Notify other assigned users (check preferences)
    const { data: aircraft } = await supabaseAdmin
      .from('aft_aircraft')
      .select('tail_number')
      .eq('id', aircraftId)
      .single();

    const { data: assignedUsers } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('user_id')
      .eq('aircraft_id', aircraftId)
      .neq('user_id', user.id);

    if (assignedUsers && assignedUsers.length > 0 && aircraft) {
      const userIds = assignedUsers.map(u => u.user_id);

      // Check notification preferences — exclude users who muted this type
      const { data: mutedUsers } = await supabaseAdmin
        .from('aft_notification_preferences')
        .select('user_id')
        .in('user_id', userIds)
        .eq('notification_type', 'reservation_created')
        .eq('enabled', false);

      const mutedIds = new Set((mutedUsers || []).map(u => u.user_id));
      const notifyIds = userIds.filter(id => !mutedIds.has(id));

      if (notifyIds.length > 0) {
        const { data: notifyUsers } = await supabaseAdmin
          .from('aft_user_roles')
          .select('email')
          .in('user_id', notifyIds);

        const emails = (notifyUsers || []).map(u => u.email).filter(Boolean) as string[];

        if (emails.length > 0) {
          const startStr = new Date(startTime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
          const endStr = new Date(endTime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

          await resend.emails.send({
            from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
            to: emails,
            subject: `${aircraft.tail_number} Reserved: ${new Date(startTime).toLocaleDateString()}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #091F3C;">New Reservation</h2>
                <p><strong>${userRole?.initials || 'A pilot'}</strong> has reserved <strong>${aircraft.tail_number}</strong>:</p>
                <div style="margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #3AB0FF; border-radius: 4px;">
                  <p style="margin: 0 0 8px 0;"><strong>From:</strong> ${startStr}</p>
                  <p style="margin: 0 0 8px 0;"><strong>To:</strong> ${endStr}</p>
                  ${title ? `<p style="margin: 0 0 8px 0;"><strong>Purpose:</strong> ${title}</p>` : ''}
                  ${route ? `<p style="margin: 0;"><strong>Route:</strong> ${route}</p>` : ''}
                </div>
                <div style="margin-top: 25px; text-align: center;">
                  <a href="${new URL(req.url).origin}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; letter-spacing: 1px;">OPEN AIRCRAFT MANAGER</a>
                </div>
              </div>
            `,
          });
        }
      }
    }

    return NextResponse.json({ success: true, reservation });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { reservationId } = await req.json();

    if (!reservationId) {
      return NextResponse.json({ error: 'Reservation ID is required.' }, { status: 400 });
    }

    // Fetch the reservation
    const { data: reservation, error: resErr } = await supabaseAdmin
      .from('aft_reservations')
      .select('*')
      .eq('id', reservationId)
      .single();

    if (resErr || !reservation) {
      return NextResponse.json({ error: 'Reservation not found.' }, { status: 404 });
    }

    // Check permissions: own reservation, tailnumber admin, or global admin
    const { data: callerRole } = await supabaseAdmin
      .from('aft_user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    const isGlobalAdmin = callerRole?.role === 'admin';
    const isOwner = reservation.user_id === user.id;

    if (!isGlobalAdmin && !isOwner) {
      const { data: callerAccess } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('aircraft_role')
        .eq('user_id', user.id)
        .eq('aircraft_id', reservation.aircraft_id)
        .single();

      if (!callerAccess || callerAccess.aircraft_role !== 'admin') {
        return NextResponse.json({ error: 'You can only cancel your own reservations.' }, { status: 403 });
      }
    }

    // Cancel the reservation (soft delete)
    await supabaseAdmin
      .from('aft_reservations')
      .update({ status: 'cancelled' })
      .eq('id', reservationId);

    // Notify other assigned users
    const { data: aircraft } = await supabaseAdmin
      .from('aft_aircraft')
      .select('tail_number')
      .eq('id', reservation.aircraft_id)
      .single();

    const { data: assignedUsers } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('user_id')
      .eq('aircraft_id', reservation.aircraft_id)
      .neq('user_id', user.id);

    if (assignedUsers && assignedUsers.length > 0 && aircraft) {
      const userIds = assignedUsers.map(u => u.user_id);

      const { data: mutedUsers } = await supabaseAdmin
        .from('aft_notification_preferences')
        .select('user_id')
        .in('user_id', userIds)
        .eq('notification_type', 'reservation_cancelled')
        .eq('enabled', false);

      const mutedIds = new Set((mutedUsers || []).map(u => u.user_id));
      const notifyIds = userIds.filter(id => !mutedIds.has(id));

      if (notifyIds.length > 0) {
        const { data: notifyUsers } = await supabaseAdmin
          .from('aft_user_roles')
          .select('email')
          .in('user_id', notifyIds);

        const emails = (notifyUsers || []).map(u => u.email).filter(Boolean) as string[];

        if (emails.length > 0) {
          const startStr = new Date(reservation.start_time).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

          await resend.emails.send({
            from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
            to: emails,
            subject: `${aircraft.tail_number} Reservation Cancelled: ${new Date(reservation.start_time).toLocaleDateString()}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #CE3732;">Reservation Cancelled</h2>
                <p>A reservation for <strong>${aircraft.tail_number}</strong> on <strong>${startStr}</strong> has been cancelled.</p>
                ${reservation.pilot_name ? `<p style="color: #666;">Originally booked by: ${reservation.pilot_name}</p>` : ''}
                <div style="margin-top: 25px; text-align: center;">
                  <a href="${new URL(req.url).origin}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; letter-spacing: 1px;">OPEN AIRCRAFT MANAGER</a>
                </div>
              </div>
            `,
          });
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

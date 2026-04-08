import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireAuth, handleApiError } from '@/lib/auth';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, startTime, endTime, title, route, recurrence } = await req.json();

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

    // Get user info for the reservation
    const { data: userRole } = await supabaseAdmin
      .from('aft_user_roles')
      .select('initials, email')
      .eq('user_id', user.id)
      .single();

    // Build list of occurrences (single or recurring)
    const occurrences: { start: string; end: string }[] = [];
    const baseStart = new Date(startTime);
    const baseEnd = new Date(endTime);
    const durationMs = baseEnd.getTime() - baseStart.getTime();

    if (recurrence && recurrence.type !== 'none' && recurrence.count > 1) {
      const intervalDays = recurrence.type === 'biweekly' ? 14 : 7;
      const count = Math.min(recurrence.count, 52); // Cap at 52 weeks
      for (let i = 0; i < count; i++) {
        const s = new Date(baseStart.getTime() + i * intervalDays * 86400000);
        const e = new Date(s.getTime() + durationMs);
        occurrences.push({ start: s.toISOString(), end: e.toISOString() });
      }
    } else {
      occurrences.push({ start: startTime, end: endTime });
    }

    // Prefetch all existing reservations and MX events in the full date range for conflict checking
    const rangeStart = occurrences[0].start;
    const rangeEnd = occurrences[occurrences.length - 1].end;

    const [existingRes, mxEvents] = await Promise.all([
      supabaseAdmin
        .from('aft_reservations')
        .select('*, pilot_name')
        .eq('aircraft_id', aircraftId)
        .eq('status', 'confirmed')
        .lt('start_time', rangeEnd)
        .gt('end_time', rangeStart),
      supabaseAdmin
        .from('aft_maintenance_events')
        .select('confirmed_date, estimated_completion, status')
        .eq('aircraft_id', aircraftId)
        .in('status', ['confirmed', 'in_progress']),
    ]);

    const allReservations = existingRes.data || [];
    const allMxEvents = mxEvents.data || [];

    // Check each occurrence for conflicts
    const created: { start: string; end: string }[] = [];
    const skipped: { start: string; reason: string }[] = [];

    for (const occ of occurrences) {
      // Check reservation conflicts
      const resConflict = allReservations.find(r =>
        new Date(r.start_time) < new Date(occ.end) && new Date(r.end_time) > new Date(occ.start)
      );
      if (resConflict) {
        skipped.push({ start: occ.start, reason: `Conflicts with ${resConflict.pilot_name || 'another pilot'}` });
        continue;
      }

      // Check MX conflicts
      let mxConflict = false;
      for (const ev of allMxEvents) {
        if (ev.confirmed_date) {
          const mxStart = new Date(ev.confirmed_date + 'T00:00:00');
          const mxEnd = ev.estimated_completion
            ? new Date(ev.estimated_completion + 'T23:59:59')
            : new Date(mxStart.getTime() + 86400000);
          if (new Date(occ.start) < mxEnd && new Date(occ.end) > mxStart) {
            skipped.push({ start: occ.start, reason: 'Maintenance scheduled' });
            mxConflict = true;
            break;
          }
        }
      }
      if (mxConflict) continue;

      created.push(occ);
    }

    // For single non-recurring reservation that conflicts, return error (preserves original UX)
    if (occurrences.length === 1 && created.length === 0) {
      return NextResponse.json({ error: skipped[0]?.reason || 'Time slot conflicts with an existing booking.' }, { status: 409 });
    }

    // Insert all non-conflicting reservations
    if (created.length > 0) {
      const rows = created.map(occ => ({
        aircraft_id: aircraftId,
        user_id: user.id,
        start_time: occ.start,
        end_time: occ.end,
        title: title || null,
        route: route || null,
        pilot_name: userRole?.email || user.email || 'Pilot',
        pilot_initials: userRole?.initials || '',
        status: 'confirmed',
      }));

      const { error: insertErr } = await supabaseAdmin.from('aft_reservations').insert(rows);
      if (insertErr) {
        if (insertErr.code === '23P01') {
          return NextResponse.json({ error: 'One or more time slots conflict with existing reservations.' }, { status: 409 });
        }
        throw insertErr;
      }

      // Add created reservations to the conflict list so later occurrences in the same batch can't overlap
      for (const occ of created) {
        allReservations.push({ start_time: occ.start, end_time: occ.end, pilot_name: userRole?.email } as any);
      }
    }

    // Notify other assigned users (single consolidated email)
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

    if (assignedUsers && assignedUsers.length > 0 && aircraft && created.length > 0) {
      const userIds = assignedUsers.map(u => u.user_id);

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
          const safeTail = escapeHtml(aircraft.tail_number);
          const safeInitials = escapeHtml(userRole?.initials || 'A pilot');
          const safeTitle = title ? escapeHtml(title) : '';
          const safeRoute = route ? escapeHtml(route) : '';

          if (created.length === 1) {
            // Single reservation email (original format)
            const startStr = new Date(created[0].start).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
            const endStr = new Date(created[0].end).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

            await resend.emails.send({
              from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
              to: emails,
              subject: `${safeTail} Reserved: ${new Date(created[0].start).toLocaleDateString()}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h2 style="color: #091F3C;">New Reservation</h2>
                  <p><strong>${safeInitials}</strong> has reserved <strong>${safeTail}</strong>:</p>
                  <div style="margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #3AB0FF; border-radius: 4px;">
                    <p style="margin: 0 0 8px 0;"><strong>From:</strong> ${startStr}</p>
                    <p style="margin: 0 0 8px 0;"><strong>To:</strong> ${endStr}</p>
                    ${safeTitle ? `<p style="margin: 0 0 8px 0;"><strong>Purpose:</strong> ${safeTitle}</p>` : ''}
                    ${safeRoute ? `<p style="margin: 0;"><strong>Route:</strong> ${safeRoute}</p>` : ''}
                  </div>
                  <div style="margin-top: 25px; text-align: center;">
                    <a href="${new URL(req.url).origin}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; letter-spacing: 1px;">OPEN AIRCRAFT MANAGER</a>
                  </div>
                </div>
              `,
            });
          } else {
            // Recurring reservation email (consolidated)
            const dateList = created.map(occ => {
              const d = new Date(occ.start);
              return `<li>${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} — ${new Date(occ.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} to ${new Date(occ.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</li>`;
            }).join('');

            await resend.emails.send({
              from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
              to: emails,
              subject: `${safeTail} Reserved: ${created.length} recurring bookings`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h2 style="color: #091F3C;">Recurring Reservation</h2>
                  <p><strong>${safeInitials}</strong> has reserved <strong>${safeTail}</strong> for ${created.length} dates:</p>
                  ${safeTitle ? `<p style="color: #666;"><strong>Purpose:</strong> ${safeTitle}</p>` : ''}
                  ${safeRoute ? `<p style="color: #666;"><strong>Route:</strong> ${safeRoute}</p>` : ''}
                  <div style="margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #3AB0FF; border-radius: 4px;">
                    <ul style="margin: 0; padding-left: 18px;">${dateList}</ul>
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
    }

    return NextResponse.json({
      success: true,
      created: created.length,
      skipped: skipped.length,
      skippedDetails: skipped.length > 0 ? skipped : undefined,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// PUT — edit an existing reservation (own, aircraft admin, or global admin)
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { reservationId, startTime, endTime, title, route } = await req.json();

    if (!reservationId) {
      return NextResponse.json({ error: 'Reservation ID is required.' }, { status: 400 });
    }

    // Fetch the existing reservation
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('aft_reservations')
      .select('*')
      .eq('id', reservationId)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Reservation not found.' }, { status: 404 });
    }

    // Check permissions: own reservation, tailnumber admin, or global admin
    const { data: callerRole } = await supabaseAdmin
      .from('aft_user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    const isGlobalAdmin = callerRole?.role === 'admin';
    const isOwner = existing.user_id === user.id;

    if (!isGlobalAdmin && !isOwner) {
      const { data: callerAccess } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('aircraft_role')
        .eq('user_id', user.id)
        .eq('aircraft_id', existing.aircraft_id)
        .single();

      if (!callerAccess || callerAccess.aircraft_role !== 'admin') {
        return NextResponse.json({ error: 'You can only edit your own reservations.' }, { status: 403 });
      }
    }

    const newStart = startTime || existing.start_time;
    const newEnd = endTime || existing.end_time;

    if (new Date(newEnd) <= new Date(newStart)) {
      return NextResponse.json({ error: 'End time must be after start time.' }, { status: 400 });
    }

    // Check for conflicting reservations (exclude self)
    const { data: conflicts } = await supabaseAdmin
      .from('aft_reservations')
      .select('*, pilot_name')
      .eq('aircraft_id', existing.aircraft_id)
      .eq('status', 'confirmed')
      .neq('id', reservationId)
      .lt('start_time', newEnd)
      .gt('end_time', newStart);

    if (conflicts && conflicts.length > 0) {
      const conflict = conflicts[0];
      const conflictStart = new Date(conflict.start_time).toLocaleString();
      const conflictEnd = new Date(conflict.end_time).toLocaleString();
      return NextResponse.json({
        error: `This time conflicts with a booking by ${conflict.pilot_name || 'another pilot'} from ${conflictStart} to ${conflictEnd}.`
      }, { status: 409 });
    }

    // Check for conflicting maintenance events
    const { data: mxEvents } = await supabaseAdmin
      .from('aft_maintenance_events')
      .select('confirmed_date, estimated_completion, status')
      .eq('aircraft_id', existing.aircraft_id)
      .in('status', ['confirmed', 'in_progress']);

    if (mxEvents) {
      for (const ev of mxEvents) {
        if (ev.confirmed_date) {
          const mxStart = new Date(ev.confirmed_date + 'T00:00:00');
          const mxEnd = ev.estimated_completion
            ? new Date(ev.estimated_completion + 'T23:59:59')
            : new Date(mxStart.getTime() + 24 * 60 * 60 * 1000);

          if (new Date(newStart) < mxEnd && new Date(newEnd) > mxStart) {
            return NextResponse.json({
              error: `This aircraft is scheduled for maintenance from ${ev.confirmed_date}${ev.estimated_completion ? ' to ' + ev.estimated_completion : ''}.`
            }, { status: 409 });
          }
        }
      }
    }

    // Update the reservation
    const updateData: Record<string, any> = {
      start_time: newStart,
      end_time: newEnd,
    };
    if (title !== undefined) updateData.title = title || null;
    if (route !== undefined) updateData.route = route || null;

    const { error: updateErr } = await supabaseAdmin
      .from('aft_reservations')
      .update(updateData)
      .eq('id', reservationId);

    if (updateErr) {
      if (updateErr.code === '23P01') {
        return NextResponse.json({ error: 'This time slot conflicts with an existing reservation.' }, { status: 409 });
      }
      throw updateErr;
    }

    // Only notify if the times actually changed
    const timesChanged = newStart !== existing.start_time || newEnd !== existing.end_time;

    if (timesChanged) {
      const { data: aircraft } = await supabaseAdmin
        .from('aft_aircraft')
        .select('tail_number')
        .eq('id', existing.aircraft_id)
        .single();

      const { data: assignedUsers } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('user_id')
        .eq('aircraft_id', existing.aircraft_id)
        .neq('user_id', user.id);

      if (assignedUsers && assignedUsers.length > 0 && aircraft) {
        const userIds = assignedUsers.map(u => u.user_id);

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
            const safeTail = escapeHtml(aircraft.tail_number);
            const safePilot = escapeHtml(existing.pilot_initials || 'A pilot');
            const newStartStr = new Date(newStart).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
            const newEndStr = new Date(newEnd).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

            await resend.emails.send({
              from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
              to: emails,
              subject: `${safeTail} Reservation Updated: ${new Date(newStart).toLocaleDateString()}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h2 style="color: #091F3C;">Reservation Updated</h2>
                  <p><strong>${safePilot}</strong> has updated their reservation for <strong>${safeTail}</strong>:</p>
                  <div style="margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #F08B46; border-radius: 4px;">
                    <p style="margin: 0 0 8px 0;"><strong>New From:</strong> ${newStartStr}</p>
                    <p style="margin: 0;"><strong>New To:</strong> ${newEndStr}</p>
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
    }

    return NextResponse.json({ success: true });
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

          // Sanitize user-provided values
          const safeTail = escapeHtml(aircraft.tail_number);
          const safePilotName = escapeHtml(reservation.pilot_name);

          await resend.emails.send({
            from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
            to: emails,
            subject: `${safeTail} Reservation Cancelled: ${new Date(reservation.start_time).toLocaleDateString()}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #CE3732;">Reservation Cancelled</h2>
                <p>A reservation for <strong>${safeTail}</strong> on <strong>${startStr}</strong> has been cancelled.</p>
                ${safePilotName ? `<p style="color: #666;">Originally booked by: ${safePilotName}</p>` : ''}
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

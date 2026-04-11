import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireAuth, handleApiError } from '@/lib/auth';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import {
  safeTimeZone,
  formatInTimeZone,
  formatTimeInTimeZone,
  formatDateInTimeZone,
  formatShortDateInTimeZone,
} from '@/lib/dateFormat';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, occurrences: rawOccurrences, title, route, timeZone, bookForUserId } = await req.json();
    const tz = safeTimeZone(timeZone);

    if (!aircraftId || !Array.isArray(rawOccurrences) || rawOccurrences.length === 0) {
      return NextResponse.json({ error: 'Aircraft and at least one occurrence are required.' }, { status: 400 });
    }

    // Hard cap to prevent abuse / runaway recurrences. Frontend caps at 100 too.
    if (rawOccurrences.length > 100) {
      return NextResponse.json({ error: 'A single recurring series may not exceed 100 occurrences.' }, { status: 400 });
    }

    // Validate each occurrence and normalize
    const occurrences: { start: string; end: string }[] = [];
    for (const occ of rawOccurrences) {
      if (!occ || typeof occ.start !== 'string' || typeof occ.end !== 'string') {
        return NextResponse.json({ error: 'Each occurrence must include start and end timestamps.' }, { status: 400 });
      }
      const s = new Date(occ.start);
      const e = new Date(occ.end);
      if (isNaN(s.getTime()) || isNaN(e.getTime())) {
        return NextResponse.json({ error: 'Invalid occurrence timestamp.' }, { status: 400 });
      }
      if (e <= s) {
        return NextResponse.json({ error: 'End time must be after start time.' }, { status: 400 });
      }
      occurrences.push({ start: s.toISOString(), end: e.toISOString() });
    }
    // Sort chronologically so the conflict-check window and skip messages are stable.
    occurrences.sort((a, b) => a.start.localeCompare(b.start));

    // Verify caller has access to this aircraft
    const { data: access } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('aircraft_role')
      .eq('user_id', user.id)
      .eq('aircraft_id', aircraftId)
      .single();

    if (!access) {
      return NextResponse.json({ error: 'You do not have access to this aircraft.' }, { status: 403 });
    }

    // Get caller's user info
    const { data: userRole } = await supabaseAdmin
      .from('aft_user_roles')
      .select('role, initials, email, full_name')
      .eq('user_id', user.id)
      .single();

    // Determine the booking target. Admins (global or aircraft) may book for
    // another pilot on the same aircraft; everyone else can only book for self.
    const bookingForOther = !!bookForUserId && bookForUserId !== user.id;
    let targetUserId = user.id;
    // pilot_name is denormalized onto the reservation row for display on
    // the calendar and in emails. Prefer full_name, fall back to email so
    // legacy users without a name still render something sensible.
    let targetName = userRole?.full_name || userRole?.email || user.email || 'Pilot';
    let targetInitials = userRole?.initials || '';

    if (bookingForOther) {
      const isGlobalAdmin = userRole?.role === 'admin';
      const isAircraftAdmin = access.aircraft_role === 'admin';
      if (!isGlobalAdmin && !isAircraftAdmin) {
        return NextResponse.json({ error: 'Only admins can book reservations for other pilots.' }, { status: 403 });
      }

      // Validate target has access to this aircraft
      const { data: targetAccess } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('user_id')
        .eq('user_id', bookForUserId)
        .eq('aircraft_id', aircraftId)
        .single();
      if (!targetAccess) {
        return NextResponse.json({ error: 'Selected pilot is not assigned to this aircraft.' }, { status: 400 });
      }

      const { data: targetRole } = await supabaseAdmin
        .from('aft_user_roles')
        .select('initials, email, full_name')
        .eq('user_id', bookForUserId)
        .single();
      if (!targetRole) {
        return NextResponse.json({ error: 'Selected pilot not found.' }, { status: 400 });
      }

      targetUserId = bookForUserId;
      targetName = targetRole.full_name || targetRole.email || 'Pilot';
      targetInitials = targetRole.initials || '';
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
      const occStartMs = new Date(occ.start).getTime();
      const occEndMs = new Date(occ.end).getTime();

      // Check existing reservation conflicts
      const resConflict = allReservations.find(r =>
        new Date(r.start_time).getTime() < occEndMs && new Date(r.end_time).getTime() > occStartMs
      );
      if (resConflict) {
        skipped.push({ start: occ.start, reason: `Conflicts with ${resConflict.pilot_name || 'another pilot'}` });
        continue;
      }

      // Check intra-batch conflicts (e.g. multi-day weekly recurrence whose
      // occurrences overlap each other). Without this, both rows pass the
      // existing-reservation check and the DB exclusion constraint rejects
      // the entire insert with a misleading 23P01 error.
      const batchConflict = created.find(c =>
        new Date(c.start).getTime() < occEndMs && new Date(c.end).getTime() > occStartMs
      );
      if (batchConflict) {
        skipped.push({ start: occ.start, reason: 'Overlaps another occurrence in this series' });
        continue;
      }

      // Check MX conflicts — build the block in UTC so it compares correctly
      // against ISO reservation timestamps regardless of server TZ.
      let mxConflict = false;
      for (const ev of allMxEvents) {
        if (ev.confirmed_date) {
          const mxStart = new Date(ev.confirmed_date + 'T00:00:00Z');
          const mxEnd = ev.estimated_completion
            ? new Date(ev.estimated_completion + 'T23:59:59.999Z')
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
        user_id: targetUserId,
        start_time: occ.start,
        end_time: occ.end,
        title: title || null,
        route: route || null,
        pilot_name: targetName,
        pilot_initials: targetInitials,
        status: 'confirmed',
        time_zone: tz,
      }));

      const { error: insertErr } = await supabaseAdmin.from('aft_reservations').insert(rows);
      if (insertErr) {
        if (insertErr.code === '23P01') {
          return NextResponse.json({ error: 'One or more time slots conflict with existing reservations.' }, { status: 409 });
        }
        throw insertErr;
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
          const safeCallerInitials = escapeHtml(userRole?.initials || 'An admin');
          const safeTargetInitials = escapeHtml(targetInitials || 'A pilot');
          const reservedByLine = bookingForOther
            ? `<strong>${safeCallerInitials}</strong> has booked <strong>${safeTail}</strong> for <strong>${safeTargetInitials}</strong>:`
            : `<strong>${safeTargetInitials}</strong> has reserved <strong>${safeTail}</strong>:`;
          const safeTitle = title ? escapeHtml(title) : '';
          const safeRoute = route ? escapeHtml(route) : '';

          if (created.length === 1) {
            // Single reservation email (original format)
            const startStr = formatInTimeZone(created[0].start, tz);
            const endStr = formatInTimeZone(created[0].end, tz);

            await resend.emails.send({
              from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
              to: emails,
              subject: `${safeTail} Reserved: ${formatShortDateInTimeZone(created[0].start, tz)}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h2 style="color: #091F3C;">New Reservation</h2>
                  <p>${reservedByLine}</p>
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
              const dayLabel = formatDateInTimeZone(occ.start, tz);
              const startLabel = formatTimeInTimeZone(occ.start, tz);
              const endLabel = formatTimeInTimeZone(occ.end, tz);
              return `<li>${dayLabel} — ${startLabel} to ${endLabel}</li>`;
            }).join('');

            await resend.emails.send({
              from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
              to: emails,
              subject: `${safeTail} Reserved: ${created.length} recurring bookings`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h2 style="color: #091F3C;">Recurring Reservation</h2>
                  <p>${bookingForOther
                    ? `<strong>${safeCallerInitials}</strong> has booked <strong>${safeTail}</strong> for <strong>${safeTargetInitials}</strong> on ${created.length} dates:`
                    : `<strong>${safeTargetInitials}</strong> has reserved <strong>${safeTail}</strong> for ${created.length} dates:`}</p>
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
    const { reservationId, startTime, endTime, title, route, timeZone } = await req.json();
    const tz = safeTimeZone(timeZone);

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
      const conflictStart = formatInTimeZone(conflict.start_time, tz);
      const conflictEnd = formatInTimeZone(conflict.end_time, tz);
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
          const mxStart = new Date(ev.confirmed_date + 'T00:00:00Z');
          const mxEnd = ev.estimated_completion
            ? new Date(ev.estimated_completion + 'T23:59:59.999Z')
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
      time_zone: tz,
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
            const newStartStr = formatInTimeZone(newStart, tz);
            const newEndStr = formatInTimeZone(newEnd, tz);

            await resend.emails.send({
              from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
              to: emails,
              subject: `${safeTail} Reservation Updated: ${formatShortDateInTimeZone(newStart, tz)}`,
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
    const { reservationId, timeZone } = await req.json();
    const tz = safeTimeZone(timeZone);

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
          // Prefer the booker's stored zone so an admin in a different zone
          // cancelling on someone's behalf still shows the original local time.
          const displayTz = safeTimeZone(reservation.time_zone || tz);
          const startStr = formatInTimeZone(reservation.start_time, displayTz);

          // Sanitize user-provided values
          const safeTail = escapeHtml(aircraft.tail_number);
          const safePilotName = escapeHtml(reservation.pilot_name);

          await resend.emails.send({
            from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
            to: emails,
            subject: `${safeTail} Reservation Cancelled: ${formatShortDateInTimeZone(reservation.start_time, displayTz)}`,
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

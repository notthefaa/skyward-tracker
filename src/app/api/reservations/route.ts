import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireAuth, handleApiError } from '@/lib/auth';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { getAppUrl } from '@/lib/email/appUrl';
import { idempotency } from '@/lib/idempotency';
import {
  safeTimeZone,
  formatInTimeZone,
  formatTimeInTimeZone,
  formatDateInTimeZone,
  formatShortDateInTimeZone,
  zonedDateStartAsUtc,
  zonedDateEndAsUtc,
} from '@/lib/dateFormat';
import { emailShell, heading, paragraph, callout, bulletList, button, keyValueBlock } from '@/lib/email/layout';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const idem = idempotency(supabaseAdmin, user.id, req, 'reservations/POST');
    const cached = await idem.check();
    if (cached) return cached;

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

    // Prefetch all existing reservations and MX events in the full date range for conflict checking.
    // Occurrences are sorted by start; rangeEnd must be the maximum end across all occurrences
    // (not the last one's end), since callers may submit mixed-duration occurrences.
    const rangeStart = occurrences[0].start;
    const rangeEnd = occurrences.reduce((max, o) => (o.end > max ? o.end : max), occurrences[0].end);

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
        .is('deleted_at', null)
        .in('status', ['confirmed', 'in_progress']),
    ]);

    // Throw on read errors so we never proceed with a false-empty conflict list,
    // which would let MX-blocked or already-booked slots get inserted silently.
    if (existingRes.error) throw existingRes.error;
    if (mxEvents.error) throw mxEvents.error;
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

      // Check MX conflicts. MX blocks are stored as date-only
      // (`YYYY-MM-DD`). "2026-04-19T00:00:00Z" hard-codes UTC midnight,
      // which misaligns with a pilot in UTC+12 whose local-midnight
      // reservation lands outside that UTC window. Interpret the
      // block in the pilot's zone instead so same-day conflicts are
      // detected regardless of where the pilot is.
      let mxConflict = false;
      for (const ev of allMxEvents) {
        if (ev.confirmed_date) {
          const mxStart = zonedDateStartAsUtc(ev.confirmed_date, tz)
            ?? new Date(ev.confirmed_date + 'T00:00:00Z');
          const mxEnd = ev.estimated_completion
            ? (zonedDateEndAsUtc(ev.estimated_completion, tz)
              ?? new Date(ev.estimated_completion + 'T23:59:59.999Z'))
            : new Date(mxStart.getTime() + 86_400_000);
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

    // Notify other assigned users (single consolidated email).
    // Throw on read errors instead of swallowing — a transient blip
    // would otherwise drop the email fan-out silently after the
    // reservation already committed, leaving no one informed.
    const { data: aircraft, error: acReadErr } = await supabaseAdmin
      .from('aft_aircraft')
      .select('tail_number')
      .eq('id', aircraftId)
      .single();
    if (acReadErr) throw acReadErr;

    const { data: assignedUsers, error: assignedErr } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('user_id')
      .eq('aircraft_id', aircraftId)
      .neq('user_id', user.id);
    if (assignedErr) throw assignedErr;

    if (assignedUsers && assignedUsers.length > 0 && aircraft && created.length > 0) {
      const userIds = assignedUsers.map(u => u.user_id);

      const { data: mutedUsers, error: mutedErr } = await supabaseAdmin
        .from('aft_notification_preferences')
        .select('user_id')
        .in('user_id', userIds)
        .eq('notification_type', 'reservation_created')
        .eq('enabled', false);
      if (mutedErr) throw mutedErr;

      const mutedIds = new Set((mutedUsers || []).map(u => u.user_id));
      const notifyIds = userIds.filter(id => !mutedIds.has(id));

      if (notifyIds.length > 0) {
        const { data: notifyUsers, error: notifyUsersErr } = await supabaseAdmin
          .from('aft_user_roles')
          .select('email')
          .in('user_id', notifyIds);
        if (notifyUsersErr) throw notifyUsersErr;

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

          const appUrl = getAppUrl(req);

          if (created.length === 1) {
            const startStr = formatInTimeZone(created[0].start, tz);
            const endStr = formatInTimeZone(created[0].end, tz);
            const details: Array<{ label: string; value: string }> = [
              { label: 'From', value: startStr },
              { label: 'To', value: endStr },
            ];
            if (safeTitle) details.push({ label: 'Purpose', value: safeTitle });
            if (safeRoute) details.push({ label: 'Route', value: safeRoute });

            await resend.emails.send({
              from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
              to: emails,
              subject: `${safeTail} Reserved: ${formatShortDateInTimeZone(created[0].start, tz)}`,
              html: emailShell({
                title: `${safeTail} Reserved`,
                preheader: `${safeTargetInitials} reserved ${safeTail} — ${startStr} → ${endStr}.`,
                body: `
                  ${heading('New Reservation', 'note')}
                  ${paragraph(reservedByLine)}
                  ${callout(keyValueBlock(details), { variant: 'note' })}
                  ${button(appUrl, 'Open Skyward')}
                `,
                preferencesUrl: `${appUrl}#settings`,
              }),
            });
          } else {
            // Recurring reservation email (consolidated)
            const dateLines = created.map(occ => {
              const dayLabel = formatDateInTimeZone(occ.start, tz);
              const startLabel = formatTimeInTimeZone(occ.start, tz);
              const endLabel = formatTimeInTimeZone(occ.end, tz);
              return `${dayLabel} — ${startLabel} to ${endLabel}`;
            });
            const introLine = bookingForOther
              ? `<strong>${safeCallerInitials}</strong> has booked <strong>${safeTail}</strong> for <strong>${safeTargetInitials}</strong> on ${created.length} dates:`
              : `<strong>${safeTargetInitials}</strong> has reserved <strong>${safeTail}</strong> for ${created.length} dates:`;

            await resend.emails.send({
              from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
              to: emails,
              subject: `${safeTail} Reserved: ${created.length} recurring bookings`,
              html: emailShell({
                title: `${safeTail} Reserved — ${created.length} bookings`,
                preheader: `${safeTargetInitials} booked ${safeTail} on ${created.length} dates.`,
                body: `
                  ${heading('Recurring Reservation', 'note')}
                  ${paragraph(introLine)}
                  ${safeTitle ? paragraph(`<strong>Purpose:</strong> ${safeTitle}`) : ''}
                  ${safeRoute ? paragraph(`<strong>Route:</strong> ${safeRoute}`) : ''}
                  ${callout(bulletList(dateLines), { variant: 'note' })}
                  ${button(appUrl, 'Open Skyward')}
                `,
                preferencesUrl: `${appUrl}#settings`,
              }),
            });
          }
        }
      }
    }

    const body = {
      success: true,
      created: created.length,
      skipped: skipped.length,
      skippedDetails: skipped.length > 0 ? skipped : undefined,
    };
    await idem.save(200, body);
    return NextResponse.json(body);
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

    // Double-tap protection. MUST run before the cancelled-status guard
    // below so a legitimate network-retry of a successful edit returns
    // the cached 200 instead of being rejected as if the row had just
    // been cancelled (it hadn't — the original call landed cleanly).
    const idem = idempotency(supabaseAdmin, user.id, req, 'reservations/PUT');
    const cached = await idem.check();
    if (cached) return cached;

    // Cancel is terminal. Editing a cancelled reservation's start/end
    // times silently changes the row but leaves status='cancelled', so
    // it never reappears on the calendar — the user thinks they
    // restored their booking but it stays invisible. Mirrors the
    // mx-events cancel-terminal guard.
    if (existing.status === 'cancelled') {
      return NextResponse.json({ error: 'This reservation was already cancelled. Book a new one instead.' }, { status: 409 });
    }

    const newStart = startTime || existing.start_time;
    const newEnd = endTime || existing.end_time;

    if (new Date(newEnd) <= new Date(newStart)) {
      return NextResponse.json({ error: 'End time must be after start time.' }, { status: 400 });
    }

    // Check for conflicting reservations (exclude self)
    const { data: conflicts, error: conflictsErr } = await supabaseAdmin
      .from('aft_reservations')
      .select('*, pilot_name')
      .eq('aircraft_id', existing.aircraft_id)
      .eq('status', 'confirmed')
      .neq('id', reservationId)
      .lt('start_time', newEnd)
      .gt('end_time', newStart);
    if (conflictsErr) throw conflictsErr;

    if (conflicts && conflicts.length > 0) {
      const conflict = conflicts[0];
      const conflictStart = formatInTimeZone(conflict.start_time, tz);
      const conflictEnd = formatInTimeZone(conflict.end_time, tz);
      return NextResponse.json({
        error: `This time conflicts with a booking by ${conflict.pilot_name || 'another pilot'} from ${conflictStart} to ${conflictEnd}.`
      }, { status: 409 });
    }

    // Check for conflicting maintenance events
    const { data: mxEvents, error: mxErr } = await supabaseAdmin
      .from('aft_maintenance_events')
      .select('confirmed_date, estimated_completion, status')
      .eq('aircraft_id', existing.aircraft_id)
      .is('deleted_at', null)
      .in('status', ['confirmed', 'in_progress']);
    if (mxErr) throw mxErr;

    if (mxEvents) {
      for (const ev of mxEvents) {
        if (ev.confirmed_date) {
          // See POST: anchor the date-only block in the pilot's zone
          // so the conflict window matches the calendar day they see.
          const mxStart = zonedDateStartAsUtc(ev.confirmed_date, tz)
            ?? new Date(ev.confirmed_date + 'T00:00:00Z');
          const mxEnd = ev.estimated_completion
            ? (zonedDateEndAsUtc(ev.estimated_completion, tz)
              ?? new Date(ev.estimated_completion + 'T23:59:59.999Z'))
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

    // Belt-and-suspenders: scope by the existing row's aircraft_id so a
    // race-window aircraft-reassignment between the verification read
    // and this write can't land the update on a row the caller no
    // longer has admin/owner access to.
    //
    // status='confirmed' guard closes the TOCTOU: a concurrent DELETE
    // landing between the cancelled-check above (line 420) and this
    // update would otherwise silently flip the row back from cancelled
    // to confirmed (this UPDATE writes new times but doesn't touch
    // status). count:'exact' lets us 409 cleanly when that happens.
    const { error: updateErr, count: updateCount } = await supabaseAdmin
      .from('aft_reservations')
      .update(updateData, { count: 'exact' })
      .eq('id', reservationId)
      .eq('aircraft_id', existing.aircraft_id)
      .eq('status', 'confirmed');

    if (updateErr) {
      if (updateErr.code === '23P01') {
        return NextResponse.json({ error: 'This time slot conflicts with an existing reservation.' }, { status: 409 });
      }
      throw updateErr;
    }
    if (updateCount === 0) {
      return NextResponse.json({ error: 'This reservation was cancelled by someone else. Refresh and book a new one.' }, { status: 409 });
    }

    // Only notify if the times actually changed
    const timesChanged = newStart !== existing.start_time || newEnd !== existing.end_time;

    if (timesChanged) {
      // Throw on each read so a transient blip doesn't silently drop
      // the change-notification fan-out after the row already updated.
      const { data: aircraft, error: acReadErr } = await supabaseAdmin
        .from('aft_aircraft')
        .select('tail_number')
        .eq('id', existing.aircraft_id)
        .single();
      if (acReadErr) throw acReadErr;

      const { data: assignedUsers, error: assignedErr } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('user_id')
        .eq('aircraft_id', existing.aircraft_id)
        .neq('user_id', user.id);
      if (assignedErr) throw assignedErr;

      if (assignedUsers && assignedUsers.length > 0 && aircraft) {
        const userIds = assignedUsers.map(u => u.user_id);

        const { data: mutedUsers, error: mutedErr } = await supabaseAdmin
          .from('aft_notification_preferences')
          .select('user_id')
          .in('user_id', userIds)
          .eq('notification_type', 'reservation_created')
          .eq('enabled', false);
        if (mutedErr) throw mutedErr;

        const mutedIds = new Set((mutedUsers || []).map(u => u.user_id));
        const notifyIds = userIds.filter(id => !mutedIds.has(id));

        if (notifyIds.length > 0) {
          const { data: notifyUsers, error: notifyUsersErr } = await supabaseAdmin
            .from('aft_user_roles')
            .select('email')
            .in('user_id', notifyIds);
          if (notifyUsersErr) throw notifyUsersErr;

          const emails = (notifyUsers || []).map(u => u.email).filter(Boolean) as string[];

          if (emails.length > 0) {
            const safeTail = escapeHtml(aircraft.tail_number);
            const safePilot = escapeHtml(existing.pilot_initials || 'A pilot');
            const newStartStr = formatInTimeZone(newStart, tz);
            const newEndStr = formatInTimeZone(newEnd, tz);

            const appUrl = getAppUrl(req);
            await resend.emails.send({
              from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
              to: emails,
              subject: `${safeTail} Reservation Updated: ${formatShortDateInTimeZone(newStart, tz)}`,
              html: emailShell({
                title: `${safeTail} Reservation Updated`,
                preheader: `${safePilot} moved their ${safeTail} reservation — ${newStartStr} → ${newEndStr}.`,
                body: `
                  ${heading('Reservation Updated', 'warning')}
                  ${paragraph(`<strong>${safePilot}</strong> has updated their reservation for <strong>${safeTail}</strong>:`)}
                  ${callout(keyValueBlock([
                    { label: 'New From', value: newStartStr },
                    { label: 'New To', value: newEndStr },
                  ]), { variant: 'warning' })}
                  ${button(appUrl, 'Open Skyward')}
                `,
                preferencesUrl: `${appUrl}#settings`,
              }),
            });
          }
        }
      }
    }

    const responseBody = { success: true };
    await idem.save(200, responseBody);
    return NextResponse.json(responseBody);
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

    // Double-tap protection. MUST run before the already-cancelled
    // guard below so a legitimate network-retry of a successful cancel
    // returns the cached 200 instead of 409. Without idempotency the
    // route also re-sent the "Reservation Cancelled" email to every
    // assigned pilot on each retry.
    const idem = idempotency(supabaseAdmin, user.id, req, 'reservations/DELETE');
    const cached = await idem.check();
    if (cached) return cached;

    // Cancel is terminal. A second cancel on an already-cancelled
    // reservation used to silently re-fire the cancellation email to
    // every assigned pilot.
    if (reservation.status === 'cancelled') {
      return NextResponse.json({ error: 'This reservation was already cancelled.' }, { status: 409 });
    }

    // Cancel the reservation (soft delete). Throw on update error so the
    // route never returns success while the row is still confirmed —
    // otherwise the caller's mutate() refetches the same row and the user
    // sees the "cancelled" booking reappear. Belt-and-suspenders scoping
    // by the existing row's aircraft_id so a race-window reassignment
    // can't slip the cancel onto a row the caller no longer has access to.
    //
    // status='confirmed' guard closes the TOCTOU: a concurrent PUT
    // landing between the cancelled-check above and this update would
    // otherwise let the cancel win on a row whose new times the PUT
    // had just written, fanning out a stale "cancellation" email for
    // a booking that was actually edited. count:'exact' lets us 200
    // the no-op when the race already cancelled the row.
    const { error: cancelErr, count: cancelCount } = await supabaseAdmin
      .from('aft_reservations')
      .update({ status: 'cancelled' }, { count: 'exact' })
      .eq('id', reservationId)
      .eq('aircraft_id', reservation.aircraft_id)
      .eq('status', 'confirmed');
    if (cancelErr) throw cancelErr;
    if (cancelCount === 0) {
      // Lost the race — someone else cancelled or edited it. Treat
      // as a successful cancel (the user's intent is satisfied) but
      // skip the notification fan-out so we don't email a stale state.
      const racedBody = { success: true, raced: true };
      await idem.save(200, racedBody);
      return NextResponse.json(racedBody);
    }

    // Notify other assigned users — throw on each read so a blip
    // doesn't silently drop the cancellation notification fan-out.
    const { data: aircraft, error: acReadErr } = await supabaseAdmin
      .from('aft_aircraft')
      .select('tail_number')
      .eq('id', reservation.aircraft_id)
      .single();
    if (acReadErr) throw acReadErr;

    const { data: assignedUsers, error: assignedErr } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('user_id')
      .eq('aircraft_id', reservation.aircraft_id)
      .neq('user_id', user.id);
    if (assignedErr) throw assignedErr;

    if (assignedUsers && assignedUsers.length > 0 && aircraft) {
      const userIds = assignedUsers.map(u => u.user_id);

      const { data: mutedUsers, error: mutedErr } = await supabaseAdmin
        .from('aft_notification_preferences')
        .select('user_id')
        .in('user_id', userIds)
        .eq('notification_type', 'reservation_cancelled')
        .eq('enabled', false);
      if (mutedErr) throw mutedErr;

      const mutedIds = new Set((mutedUsers || []).map(u => u.user_id));
      const notifyIds = userIds.filter(id => !mutedIds.has(id));

      if (notifyIds.length > 0) {
        const { data: notifyUsers, error: notifyUsersErr } = await supabaseAdmin
          .from('aft_user_roles')
          .select('email')
          .in('user_id', notifyIds);
        if (notifyUsersErr) throw notifyUsersErr;

        const emails = (notifyUsers || []).map(u => u.email).filter(Boolean) as string[];

        if (emails.length > 0) {
          // Prefer the booker's stored zone so an admin in a different zone
          // cancelling on someone's behalf still shows the original local time.
          const displayTz = safeTimeZone(reservation.time_zone || tz);
          const startStr = formatInTimeZone(reservation.start_time, displayTz);

          // Sanitize user-provided values
          const safeTail = escapeHtml(aircraft.tail_number);
          const safePilotName = escapeHtml(reservation.pilot_name);

          const appUrl = getAppUrl(req);
          await resend.emails.send({
            from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
            to: emails,
            subject: `${safeTail} Reservation Cancelled: ${formatShortDateInTimeZone(reservation.start_time, displayTz)}`,
            html: emailShell({
              title: `${safeTail} Reservation Cancelled`,
              preheader: `Reservation on ${safeTail} for ${startStr} has been cancelled.`,
              body: `
                ${heading('Reservation Cancelled', 'danger')}
                ${paragraph(`A reservation for <strong>${safeTail}</strong> on <strong>${startStr}</strong> has been cancelled.`)}
                ${safePilotName ? paragraph(`Originally booked by: ${safePilotName}`) : ''}
                ${button(appUrl, 'Open Skyward')}
              `,
              preferencesUrl: `${appUrl}#settings`,
            }),
          });
        }
      }
    }

    const responseBody = { success: true };
    await idem.save(200, responseBody);
    return NextResponse.json(responseBody);
  } catch (error) {
    return handleApiError(error);
  }
}

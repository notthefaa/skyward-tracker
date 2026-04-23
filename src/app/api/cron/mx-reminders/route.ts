import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient, handleApiError } from '@/lib/auth';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { computeMetrics } from '@/lib/math';
import { daysUntilDate } from '@/lib/pilotTime';
import { FLIGHT_DATA_LOOKBACK_DAYS, MX_AGGREGATION_WINDOW_DAYS } from '@/lib/constants';

// How many days to let an event sit in ready_for_pickup before nudging
// the primary contact. The cron will re-nudge at the same cadence until
// the owner closes the event.
const READY_PICKUP_NUDGE_DAYS = 3;
// Marker string we embed in the nudge message row so we can avoid
// re-nudging on every cron tick without needing a new DB column.
const READY_PICKUP_NUDGE_MARKER = '[NUDGE:ready_for_pickup]';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function GET(req: Request) {
  try {
    // Verify this is a legitimate Vercel CRON call
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = createAdminClient();

    const { data: aircraftList } = await supabaseAdmin.from('aft_aircraft').select('*').is('deleted_at', null);
    const { data: mxItems } = await supabaseAdmin.from('aft_maintenance_items').select('*').eq('is_required', true).is('deleted_at', null);

    if (!aircraftList || !mxItems) return NextResponse.json({ success: true, note: 'No data' });

    // Fetch Global Settings
    const { data: settings } = await supabaseAdmin.from('aft_system_settings').select('*').eq('id', 1).single();
    const reminder1 = settings?.reminder_1 ?? 30;
    const reminder2 = settings?.reminder_2 ?? 15;
    const reminder3 = settings?.reminder_3 ?? 5;
    const reminderHours1 = settings?.reminder_hours_1 ?? 30;
    const reminderHours2 = settings?.reminder_hours_2 ?? 15;
    const reminderHours3 = settings?.reminder_hours_3 ?? 5;
    const schedTime = settings?.sched_time ?? 10;
    const schedDays = settings?.sched_days ?? 30;
    const predictiveSchedDays = settings?.predictive_sched_days ?? 45;

    // Fetch Flight Logs from lookback window
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - FLIGHT_DATA_LOOKBACK_DAYS);
    const { data: recentLogs } = await supabaseAdmin
      .from('aft_flight_logs')
      .select('aircraft_id, ftt, tach, created_at')
      .gte('created_at', lookbackDate.toISOString())
      .order('created_at', { ascending: true });

    // Build set of MX items already in active events
    const { data: activeEventLines } = await supabaseAdmin
      .from('aft_event_line_items')
      .select('maintenance_item_id, event_id')
      .not('maintenance_item_id', 'is', null);

    const mxIdsInActiveEvents = new Set<string>();
    if (activeEventLines && activeEventLines.length > 0) {
      const eventIds = Array.from(new Set(activeEventLines.map((l: any) => l.event_id)));
      if (eventIds.length > 0) {
        const { data: activeEvents } = await supabaseAdmin
          .from('aft_maintenance_events')
          .select('id')
          .in('id', eventIds)
          .in('status', ['draft', 'scheduling', 'confirmed', 'in_progress']);

        if (activeEvents) {
          const activeEvIds = new Set(activeEvents.map((e: any) => e.id));
          for (const line of activeEventLines) {
            if (line.maintenance_item_id && activeEvIds.has(line.event_id)) {
              mxIdsInActiveEvents.add(line.maintenance_item_id);
            }
          }
        }
      }
    }

    // =====================================================
    // GROUP MX ITEMS BY AIRCRAFT
    // =====================================================
    const itemsByAircraft: Record<string, any[]> = {};
    for (const mx of (mxItems as any[])) {
      if (!itemsByAircraft[mx.aircraft_id]) itemsByAircraft[mx.aircraft_id] = [];
      itemsByAircraft[mx.aircraft_id].push(mx);
    }

    // Collect all MX item flag updates for batching
    const flagUpdates: { id: string; flags: Record<string, boolean> }[] = [];

    // =====================================================
    // PROCESS EACH AIRCRAFT
    // =====================================================
    for (const aircraft of (aircraftList as any[])) {
      const acMxItems = itemsByAircraft[aircraft.id];
      if (!acMxItems || acMxItems.length === 0) continue;

      const planeLogs = recentLogs?.filter(l => l.aircraft_id === aircraft.id) || [];
      const { burnRate, confidenceScore } = computeMetrics(aircraft, planeLogs);

      // ─────────────────────────────────────────────────
      // PHASE 1: Evaluate each item's status
      // ─────────────────────────────────────────────────
      interface EvaluatedItem {
        mx: any;
        remaining: number;
        projectedDays: number;
        // Per-dimension remaining, kept on the evaluated item so Phase 4
        // (internal reminders) can frame the "due in X hrs / Y days"
        // message correctly for 'both' items without recomputing.
        // Infinity when the dimension isn't configured or doesn't apply.
        hoursLeft: number;
        daysLeft: number;
        triggersScheduling: boolean;
        triggersHeadsUp: boolean;
        withinAggregationWindow: boolean;
      }

      const evaluated: EvaluatedItem[] = [];

      for (const mx of acMxItems) {
        // Skip items already in an active maintenance event
        if (mxIdsInActiveEvents.has(mx.id)) continue;

        // Which dimensions this item tracks + whether they're filled in.
        // 'both' items (annuals: tracking_type='both', time_interval=100,
        // date_interval_days=365) MUST fire on whichever deadline hits
        // first. Prior to this, the threshold-hit checks below only
        // matched 'time' or 'date' tracking_types — 'both' items
        // silently never triggered any reminder or scheduling email,
        // which is a safety-of-flight problem for annuals.
        const hasTimeDim = mx.tracking_type === 'time' || mx.tracking_type === 'both';
        const hasDateDim = mx.tracking_type === 'date' || mx.tracking_type === 'both';
        const hasTimeData = hasTimeDim && mx.due_time !== null && mx.due_time !== undefined;
        const hasDateData = hasDateDim && mx.due_date !== null && mx.due_date !== undefined;

        // Skip items that haven't been set up yet (no relevant due value
        // configured — a template insert that was never filled in).
        if (!hasTimeData && !hasDateData) continue;

        // Per-dimension remaining. Infinity when the dimension isn't
        // applicable or isn't configured, so the min() below naturally
        // picks the populated dimension.
        const hoursLeft = hasTimeData
          ? (mx.due_time as number) - (aircraft.total_engine_time || 0)
          : Infinity;
        const daysFromHours = hasTimeData && burnRate > 0 ? hoursLeft / burnRate : Infinity;
        // Compute "days to due_date" against today in the pilot's
        // timezone, not the Vercel UTC runtime. Without this, a
        // reminder email at the UTC day-boundary rounded a
        // tomorrow-for-the-pilot item to "due today".
        const daysLeftRaw = hasDateData ? daysUntilDate(mx.due_date, aircraft.time_zone) : Infinity;
        const daysLeft = hasDateData ? (Number.isFinite(daysLeftRaw) ? daysLeftRaw : 0) : Infinity;

        // Headline `remaining` + `projectedDays` for downstream sort
        // and aggregation window. For 'time'-only it's hours; for
        // 'date' / 'both' it's the nearer deadline in days.
        let remaining: number;
        let projectedDays: number;
        if (mx.tracking_type === 'time') {
          remaining = hoursLeft;
          projectedDays = daysFromHours;
        } else if (mx.tracking_type === 'date') {
          remaining = daysLeft;
          projectedDays = daysLeft;
        } else {
          // 'both' — pick whichever dimension is nearer in days.
          projectedDays = Math.min(daysLeft, daysFromHours);
          remaining = projectedDays;
        }

        // Does this item hit the scheduling threshold? Each dimension
        // is checked in its own units. 'both' fires on either.
        const mxThresholdHitTime = hasTimeData && hoursLeft <= schedTime;
        const mxThresholdHitPredictive = hasTimeData && daysFromHours <= predictiveSchedDays;
        const mxThresholdHitDate = hasDateData && daysLeft <= schedDays;

        const triggersScheduling = mx.automate_scheduling && !mx.mx_schedule_sent && (
          mxThresholdHitTime || mxThresholdHitDate || (mxThresholdHitPredictive && confidenceScore >= 80)
        );

        const triggersHeadsUp = mx.automate_scheduling && !mx.mx_schedule_sent && !triggersScheduling &&
          mxThresholdHitPredictive && confidenceScore < 80 && !mx.primary_heads_up_sent;

        const withinAggregationWindow = projectedDays <= MX_AGGREGATION_WINDOW_DAYS || remaining <= MX_AGGREGATION_WINDOW_DAYS;

        evaluated.push({
          mx,
          remaining,
          projectedDays,
          hoursLeft,
          daysLeft,
          triggersScheduling,
          triggersHeadsUp,
          withinAggregationWindow,
        });
      }

      // ─────────────────────────────────────────────────
      // PHASE 2: AGGREGATE SCHEDULING
      // ─────────────────────────────────────────────────
      const schedulingTriggers = evaluated.filter(e => e.triggersScheduling);
      const appUrl = new URL(req.url).origin;

      if (schedulingTriggers.length > 0) {
        const itemsForDraft = evaluated.filter(e =>
          e.triggersScheduling ||
          (e.withinAggregationWindow && e.mx.automate_scheduling && !e.mx.mx_schedule_sent)
        );

        const lineItemDescriptions = itemsForDraft.map(e => {
          let dueString: string;
          if (e.mx.tracking_type === 'time') {
            dueString = `at ${e.mx.due_time} hours`;
            if (burnRate > 0) dueString += ` (projected ~${Math.ceil(e.projectedDays)} days)`;
          } else if (e.mx.tracking_type === 'date') {
            dueString = `on ${e.mx.due_date}`;
          } else {
            // 'both' — show whichever dimension is actually configured,
            // and note "whichever first" so the shop understands the
            // item has two triggers.
            const bits: string[] = [];
            if (e.mx.due_time != null) bits.push(`at ${e.mx.due_time} hours`);
            if (e.mx.due_date != null) bits.push(`on ${e.mx.due_date}`);
            dueString = bits.length === 2 ? `${bits.join(' or ')} (whichever first)` : bits[0] || '—';
          }
          return { mx: e.mx, dueString };
        });

        // Create a single draft event
        const { data: draftEvent } = await supabaseAdmin
          .from('aft_maintenance_events')
          .insert({
            aircraft_id: aircraft.id,
            status: 'draft',
            addon_services: [],
            mx_contact_name: aircraft.mx_contact || null,
            mx_contact_email: aircraft.mx_contact_email || null,
            primary_contact_name: aircraft.main_contact || null,
            primary_contact_email: aircraft.main_contact_email || null,
          } as any)
          .select()
          .single();

        if (draftEvent) {
          // Insert all line items
          const lineItems = lineItemDescriptions.map(({ mx, dueString }) => ({
            event_id: draftEvent.id,
            item_type: 'maintenance',
            maintenance_item_id: mx.id,
            item_name: mx.item_name,
            item_description: `Due ${dueString}`,
          }));
          await supabaseAdmin.from('aft_event_line_items').insert(lineItems);

          // Build the system message
          const itemList = lineItemDescriptions.map(({ mx, dueString }) => `• ${mx.item_name}: ${dueString}`).join('\n');
          await supabaseAdmin.from('aft_event_messages').insert({
            event_id: draftEvent.id,
            sender: 'system',
            message_type: 'status_update',
            message: `Draft created automatically with ${lineItemDescriptions.length} item${lineItemDescriptions.length > 1 ? 's' : ''} approaching:\n${itemList}`,
          } as any);

          // Email the PRIMARY CONTACT to review and send. If the email
          // fails we still keep the draft (it's the authoritative record
          // the user acts on in-app) but we do NOT mark items as
          // "schedule sent", so the next cron run can retry.
          let emailOk = true;
          if (aircraft.main_contact_email) {
            const safeTail = escapeHtml(aircraft.tail_number);
            const safeMainContact = escapeHtml(aircraft.main_contact || 'Operations');
            const safeMxContact = escapeHtml(aircraft.mx_contact || 'your mechanic');

            const itemListHtml = lineItemDescriptions.map(({ mx, dueString }) =>
              `<li style="margin-bottom: 8px;"><strong>${escapeHtml(mx.item_name)}</strong><br/><span style="color: #525659; font-size: 13px;">Due ${escapeHtml(dueString)}</span></li>`
            ).join('');

            try {
              await resend.emails.send({
                from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
                replyTo: aircraft.main_contact_email,
                to: [aircraft.main_contact_email],
                subject: `Action Required: Review & Send Work Package for ${safeTail}`,
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
                    <h2 style="color: #091F3C; text-transform: uppercase; letter-spacing: 2px; border-bottom: 2px solid #091F3C; padding-bottom: 10px;">Maintenance Coming Due</h2>

                    <p style="color: #525659; font-size: 16px;">Hello ${safeMainContact},</p>
                    <p style="color: #525659; font-size: 16px;">The following maintenance item${lineItemDescriptions.length > 1 ? 's are' : ' is'} approaching for <strong>${safeTail}</strong>:</p>

                    <div style="background-color: #FFF7ED; padding: 20px; border-left: 4px solid #F08B46; margin: 25px 0; border-radius: 4px;">
                      <ul style="margin: 0; padding-left: 16px; list-style: none;">${itemListHtml}</ul>
                    </div>

                    <p style="color: #525659; font-size: 16px;">We've prepared a <strong>draft work package</strong> for you. Open the app to:</p>
                    <ul style="color: #525659; font-size: 14px; line-height: 2;">
                      <li>Add any open squawks you'd like addressed</li>
                      <li>Request additional services (wash, fluid top-off, nav update, etc.)</li>
                      <li>Propose a preferred service date</li>
                      <li>Send the complete package to ${safeMxContact}</li>
                    </ul>

                    <div style="margin-top: 25px; text-align: center;">
                      <a href="${appUrl}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; letter-spacing: 1px;">OPEN AIRCRAFT MANAGER</a>
                    </div>
                  </div>
                `
              });
            } catch (err: any) {
              emailOk = false;
              console.error(`[cron/mx-reminders] scheduling email failed for ${aircraft.tail_number}:`, err?.message || err);
            }
          }

          // Queue flag updates only if the email went through (or there
          // was no recipient configured — in that case the draft is the
          // only notification channel and we shouldn't re-loop).
          if (emailOk) {
            for (const { mx } of lineItemDescriptions) {
              flagUpdates.push({ id: mx.id, flags: { mx_schedule_sent: true } });
            }
          }
        }
      }

      // ─────────────────────────────────────────────────
      // PHASE 3: LOW-CONFIDENCE HEADS-UP
      // ─────────────────────────────────────────────────
      const headsUpItems = evaluated.filter(e => e.triggersHeadsUp);
      if (headsUpItems.length > 0 && aircraft.main_contact_email) {
        const safeTail = escapeHtml(aircraft.tail_number);
        const safeMainContact = escapeHtml(aircraft.main_contact || 'Operations');

        const itemListHtml = headsUpItems.map(e =>
          `<li style="margin-bottom: 8px;"><strong>${escapeHtml(e.mx.item_name)}</strong> — projected ~${Math.ceil(e.projectedDays)} days</li>`
        ).join('');

        try {
          await resend.emails.send({
            from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
            replyTo: aircraft.main_contact_email,
            to: [aircraft.main_contact_email],
            subject: `Heads Up: ${safeTail} MX Approaching (Low Confidence)`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #091F3C;">Predictive Maintenance Alert</h2>
                <p>Hello ${safeMainContact},</p>
                <p>Based on recent flight activity, we estimate the following item${headsUpItems.length > 1 ? 's' : ''} for ${safeTail} may be coming due:</p>
                <ul style="margin: 15px 0; padding-left: 16px;">${itemListHtml}</ul>
                <p>However, flight logs have been irregular (System Confidence: <strong>${confidenceScore}%</strong>), so ${headsUpItems.length > 1 ? 'these estimates' : 'this estimate'} may shift significantly.</p>
                <p style="margin-top: 20px;">No action is needed yet. We'll create a draft work package automatically when ${headsUpItems.length > 1 ? 'items get' : 'the item gets'} closer to ${headsUpItems.length > 1 ? 'their thresholds' : 'its threshold'}. You can also schedule service proactively from the Maintenance tab at any time.</p>
                <div style="margin-top: 25px; text-align: center;">
                  <a href="${appUrl}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; letter-spacing: 1px;">OPEN AIRCRAFT MANAGER</a>
                </div>
              </div>
            `
          });

          // Only mark heads-up as sent if the email actually went.
          for (const e of headsUpItems) {
            flagUpdates.push({ id: e.mx.id, flags: { primary_heads_up_sent: true } });
          }
        } catch (err: any) {
          console.error(`[cron/mx-reminders] heads-up email failed for ${aircraft.tail_number}:`, err?.message || err);
        }
      }

      // ─────────────────────────────────────────────────
      // PHASE 4: INTERNAL REMINDERS
      // ─────────────────────────────────────────────────
      for (const e of evaluated) {
        const mx = e.mx;
        const remaining = e.remaining;
        const projectedDays = e.projectedDays;

        let hitReminder3 = false, hitReminder2 = false, hitReminder1 = false;
        let internalTriggerTemplate: string | null = null;
        const flagToUpdate: Record<string, boolean> = {};

        if (mx.tracking_type === 'time') {
          hitReminder3 = remaining <= reminderHours3 || projectedDays <= reminder3;
          hitReminder2 = remaining <= reminderHours2 || projectedDays <= reminder2;
          hitReminder1 = remaining <= reminderHours1 || projectedDays <= reminder1;
        } else if (mx.tracking_type === 'date') {
          hitReminder3 = remaining <= reminder3;
          hitReminder2 = remaining <= reminder2;
          hitReminder1 = remaining <= reminder1;
        } else {
          // 'both' — fire if EITHER dimension crosses its reminder
          // threshold. Check hours directly (not via projected days)
          // so a burnRate=0 aircraft with hours-close items still
          // reminds. `remaining` here is already the nearer in days,
          // so the days-comparison picks up date-driven reminders
          // AND time-driven-via-projection reminders.
          hitReminder3 = e.hoursLeft <= reminderHours3 || remaining <= reminder3;
          hitReminder2 = e.hoursLeft <= reminderHours2 || remaining <= reminder2;
          hitReminder1 = e.hoursLeft <= reminderHours1 || remaining <= reminder1;
        }

        // New aircraft with no flights yet report projectedDays=Infinity
        // (no burn rate yet). Rendering "~Infinity DAYS" in a template
        // is nonsense — substitute a readable fallback so the email
        // still makes sense.
        const projectedDaysText = Number.isFinite(projectedDays) ? `~${Math.ceil(projectedDays)} DAYS` : 'PROJECTION UNAVAILABLE — NO RECENT FLIGHT DATA';
        // Frame the "due in" line to match what's actually tight. For
        // 'both' items, the whichever dimension triggered the reminder
        // drives the phrasing so the pilot sees "100 HRS" vs. "30 DAYS"
        // as appropriate, not a lossy conversion to a single unit.
        const triggerTemplate = (): string => {
          if (mx.tracking_type === 'time') {
            return `DUE IN ${remaining.toFixed(1)} HRS (${projectedDaysText})`;
          }
          if (mx.tracking_type === 'date') {
            return `DUE IN ${remaining} DAYS`;
          }
          // 'both' — lead with whichever dimension is actually closer.
          const timeIsTight = Number.isFinite(e.hoursLeft) && e.hoursLeft <= reminderHours1;
          const dateIsTight = Number.isFinite(e.daysLeft) && e.daysLeft <= reminder1;
          if (timeIsTight && (!dateIsTight || e.daysLeft > Math.ceil(e.hoursLeft / Math.max(burnRate, 0.01)))) {
            return `DUE IN ${e.hoursLeft.toFixed(1)} HRS (${projectedDaysText})`;
          }
          return `DUE IN ${Math.round(e.daysLeft)} DAYS`;
        };
        if (hitReminder3 && !mx.reminder_5_sent) {
          internalTriggerTemplate = triggerTemplate();
          flagToUpdate.reminder_5_sent = true; flagToUpdate.reminder_15_sent = true; flagToUpdate.reminder_30_sent = true;
        } else if (hitReminder2 && !mx.reminder_15_sent) {
          internalTriggerTemplate = triggerTemplate();
          flagToUpdate.reminder_15_sent = true; flagToUpdate.reminder_30_sent = true;
        } else if (hitReminder1 && !mx.reminder_30_sent) {
          internalTriggerTemplate = triggerTemplate();
          flagToUpdate.reminder_30_sent = true;
        }

        let reminderEmailOk = true;
        if (internalTriggerTemplate && aircraft.main_contact_email) {
          const safeTail = escapeHtml(aircraft.tail_number);
          const safeItemName = escapeHtml(mx.item_name);

          try {
            await resend.emails.send({
              from: `Skyward Alerts <${FROM_EMAIL}>`,
              to: [aircraft.main_contact_email],
              subject: `Maintenance Alert: ${safeTail} Due Soon`,
              html: `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6;">
                      <p>This is an automated reminder that required maintenance is coming due for ${safeTail}.</p>
                      <p style="margin-top: 20px;"><strong>Item:</strong> ${safeItemName}<br/><strong>Status:</strong> ${escapeHtml(internalTriggerTemplate)}</p>
                      <div style="margin-top: 25px; text-align: center;">
                        <a href="${appUrl}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; letter-spacing: 1px;">OPEN AIRCRAFT MANAGER</a>
                      </div>
                    </div>`
            });
          } catch (err: any) {
            reminderEmailOk = false;
            console.error(`[cron/mx-reminders] internal reminder email failed for ${aircraft.tail_number} / ${mx.item_name}:`, err?.message || err);
          }
        }

        // Don't flip the "sent" flag if the email bounced — the next
        // cron tick will retry the same reminder stage.
        if (reminderEmailOk && Object.keys(flagToUpdate).length > 0) {
          flagUpdates.push({ id: mx.id, flags: flagToUpdate });
        }
      }
    }

    // =====================================================
    // PHASE 5: READY_FOR_PICKUP STALE NUDGE
    // If the mechanic has marked an event ready but the owner
    // hasn't closed it out, the aircraft stays logically blocked
    // on the calendar. Ping the primary contact after N days,
    // and avoid spamming by checking for a marker message.
    // =====================================================
    {
      const appUrl = new URL(req.url).origin;
      const { data: pickupEvents } = await supabaseAdmin
        .from('aft_maintenance_events')
        .select('id, aircraft_id, primary_contact_email')
        .eq('status', 'ready_for_pickup');

      if (pickupEvents && pickupEvents.length > 0) {
        const eventIds = pickupEvents.map((e: any) => e.id);
        const { data: pickupMessages } = await supabaseAdmin
          .from('aft_event_messages')
          .select('event_id, sender, message_type, message, created_at')
          .in('event_id', eventIds)
          .order('created_at', { ascending: false });

        const now = Date.now();
        const nudgeWindowMs = READY_PICKUP_NUDGE_DAYS * 24 * 60 * 60 * 1000;

        for (const ev of pickupEvents as any[]) {
          if (!ev.primary_contact_email) continue;

          const eventMessages = (pickupMessages || []).filter((m: any) => m.event_id === ev.id);
          // The most recent mechanic status_update is the mark_ready event.
          const markReady = eventMessages.find(
            (m: any) => m.sender === 'mechanic' && m.message_type === 'status_update'
          );
          if (!markReady) continue;

          const markReadyTime = new Date(markReady.created_at).getTime();
          if (now - markReadyTime < nudgeWindowMs) continue; // not stale yet

          // Has a nudge already been sent within the current window?
          const existingNudge = eventMessages.find(
            (m: any) =>
              m.sender === 'system' &&
              typeof m.message === 'string' &&
              m.message.includes(READY_PICKUP_NUDGE_MARKER)
          );
          if (existingNudge) {
            const lastNudgeTime = new Date(existingNudge.created_at).getTime();
            if (now - lastNudgeTime < nudgeWindowMs) continue; // recently reminded
          }

          const aircraft = (aircraftList as any[]).find((a: any) => a.id === ev.aircraft_id);
          if (!aircraft) continue;
          const safeTail = escapeHtml(aircraft.tail_number);

          try {
            await resend.emails.send({
              from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
              to: [ev.primary_contact_email],
              subject: `Reminder: ${safeTail} Awaiting Logbook Entry`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h2 style="color: #F08B46;">Service Event Still Open</h2>
                  <p>Your mechanic marked <strong>${safeTail}</strong> as ready for pickup more than ${READY_PICKUP_NUDGE_DAYS} days ago, but the service event has not yet been closed.</p>
                  <p style="color: #525659;">Until you enter the logbook data, maintenance tracking won't reset and the aircraft may remain blocked on the calendar. Open the app to complete the event when you get a moment.</p>
                  <div style="margin-top: 25px; text-align: center;">
                    <a href="${appUrl}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; letter-spacing: 1px;">OPEN AIRCRAFT MANAGER</a>
                  </div>
                </div>
              `,
            });

            // Only insert the nudge marker if the email actually went
            // out — otherwise we'd suppress the retry on the next tick.
            await supabaseAdmin.from('aft_event_messages').insert({
              event_id: ev.id,
              sender: 'system',
              message_type: 'status_update',
              message: `${READY_PICKUP_NUDGE_MARKER} Reminder sent to primary contact — aircraft awaiting logbook entry.`,
            } as any);
          } catch (err: any) {
            console.error(`[cron/mx-reminders] pickup nudge email failed for event ${ev.id}:`, err?.message || err);
          }
        }
      }
    }

    // =====================================================
    // BATCH ALL FLAG UPDATES
    // Group by identical flag combinations for fewer DB calls
    // =====================================================
    const updateGroups: Record<string, string[]> = {};
    for (const { id, flags } of flagUpdates) {
      const key = JSON.stringify(flags);
      if (!updateGroups[key]) updateGroups[key] = [];
      updateGroups[key].push(id);
    }

    for (const [flagsJson, ids] of Object.entries(updateGroups)) {
      const flags = JSON.parse(flagsJson);
      // Batch in groups of 100 to avoid query size limits
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        await supabaseAdmin.from('aft_maintenance_items').update(flags).in('id', batch);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

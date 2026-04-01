import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient, handleApiError } from '@/lib/auth';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { computeMetrics } from '@/lib/math';
import { FLIGHT_DATA_LOOKBACK_DAYS, MX_AGGREGATION_WINDOW_DAYS } from '@/lib/constants';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function GET(req: Request) {
  try {
    // Verify this is a legitimate Vercel CRON call
    if (env.CRON_SECRET) {
      const authHeader = req.headers.get('authorization');
      if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const supabaseAdmin = createAdminClient();

    const { data: aircraftList } = await supabaseAdmin.from('aft_aircraft').select('*');
    const { data: mxItems } = await supabaseAdmin.from('aft_maintenance_items').select('*').eq('is_required', true);

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
        triggersScheduling: boolean;
        triggersHeadsUp: boolean;
        withinAggregationWindow: boolean;
      }

      const evaluated: EvaluatedItem[] = [];

      for (const mx of acMxItems) {
        // Skip items already in an active maintenance event
        if (mxIdsInActiveEvents.has(mx.id)) continue;

        // Skip items that haven't been set up yet (null due values from templates)
        if (mx.tracking_type === 'time' && (mx.due_time === null || mx.due_time === undefined)) continue;
        if (mx.tracking_type === 'date' && (mx.due_date === null || mx.due_date === undefined)) continue;

        let remaining = 0;
        let projectedDays = Infinity;

        if (mx.tracking_type === 'time') {
          remaining = (mx.due_time ?? 0) - (aircraft.total_engine_time || 0);
          if (burnRate > 0) projectedDays = remaining / burnRate;
        } else {
          const diffTime = new Date((mx.due_date ?? '') + 'T00:00:00').getTime() - new Date(new Date().setHours(0, 0, 0, 0)).getTime();
          remaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          projectedDays = remaining;
        }

        // Does this item hit the scheduling threshold?
        const mxThresholdHitTime = mx.tracking_type === 'time' && remaining <= schedTime;
        const mxThresholdHitPredictive = mx.tracking_type === 'time' && projectedDays <= predictiveSchedDays;
        const mxThresholdHitDate = mx.tracking_type === 'date' && remaining <= schedDays;

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
          let dueString = e.mx.tracking_type === 'time' ? `at ${e.mx.due_time} hours` : `on ${e.mx.due_date}`;
          if (e.mx.tracking_type === 'time' && burnRate > 0) {
            dueString += ` (projected ~${Math.ceil(e.projectedDays)} days)`;
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

          // Email the PRIMARY CONTACT to review and send
          if (aircraft.main_contact_email) {
            const safeTail = escapeHtml(aircraft.tail_number);
            const safeMainContact = escapeHtml(aircraft.main_contact || 'Operations');
            const safeMxContact = escapeHtml(aircraft.mx_contact || 'your mechanic');

            const itemListHtml = lineItemDescriptions.map(({ mx, dueString }) =>
              `<li style="margin-bottom: 8px;"><strong>${escapeHtml(mx.item_name)}</strong><br/><span style="color: #525659; font-size: 13px;">Due ${escapeHtml(dueString)}</span></li>`
            ).join('');

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
          }

          // Queue flag updates for all included items (batched below)
          for (const { mx } of lineItemDescriptions) {
            flagUpdates.push({ id: mx.id, flags: { mx_schedule_sent: true } });
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

        for (const e of headsUpItems) {
          flagUpdates.push({ id: e.mx.id, flags: { primary_heads_up_sent: true } });
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
        } else {
          hitReminder3 = remaining <= reminder3;
          hitReminder2 = remaining <= reminder2;
          hitReminder1 = remaining <= reminder1;
        }

        if (hitReminder3 && !mx.reminder_5_sent) {
          internalTriggerTemplate = mx.tracking_type === 'time' ? `DUE IN ${remaining.toFixed(1)} HRS (~${Math.ceil(projectedDays)} DAYS)` : `DUE IN ${remaining} DAYS`;
          flagToUpdate.reminder_5_sent = true; flagToUpdate.reminder_15_sent = true; flagToUpdate.reminder_30_sent = true;
        } else if (hitReminder2 && !mx.reminder_15_sent) {
          internalTriggerTemplate = mx.tracking_type === 'time' ? `DUE IN ${remaining.toFixed(1)} HRS (~${Math.ceil(projectedDays)} DAYS)` : `DUE IN ${remaining} DAYS`;
          flagToUpdate.reminder_15_sent = true; flagToUpdate.reminder_30_sent = true;
        } else if (hitReminder1 && !mx.reminder_30_sent) {
          internalTriggerTemplate = mx.tracking_type === 'time' ? `DUE IN ${remaining.toFixed(1)} HRS (~${Math.ceil(projectedDays)} DAYS)` : `DUE IN ${remaining} DAYS`;
          flagToUpdate.reminder_30_sent = true;
        }

        if (internalTriggerTemplate && aircraft.main_contact_email) {
          const safeTail = escapeHtml(aircraft.tail_number);
          const safeItemName = escapeHtml(mx.item_name);

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
        }

        if (Object.keys(flagToUpdate).length > 0) {
          flagUpdates.push({ id: mx.id, flags: flagToUpdate });
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

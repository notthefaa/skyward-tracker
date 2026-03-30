import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient, handleApiError } from '@/lib/auth';
import { env } from '@/lib/env';
import { computeMetrics } from '@/lib/math';

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

    // Fetch Flight Logs from last 180 days
    const oneEightyDaysAgo = new Date();
    oneEightyDaysAgo.setDate(oneEightyDaysAgo.getDate() - 180);
    const { data: recentLogs } = await supabaseAdmin
      .from('aft_flight_logs')
      .select('aircraft_id, ftt, tach, created_at')
      .gte('created_at', oneEightyDaysAgo.toISOString())
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
    // MAIN LOOP
    // =====================================================
    for (const mx of mxItems as any[]) {
      const aircraft = (aircraftList as any[]).find(a => a.id === mx.aircraft_id);
      if (!aircraft) continue;

      // SKIP items already in an active maintenance event
      if (mxIdsInActiveEvents.has(mx.id)) continue;

      const planeLogs = recentLogs?.filter(l => l.aircraft_id === aircraft.id) || [];
      const { burnRate, confidenceScore } = computeMetrics(aircraft, planeLogs);

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

      const flagToUpdate: Record<string, boolean> = {};

      // ---------------------------------------------------------
      // 1. SCHEDULING: Create DRAFT event & notify PRIMARY CONTACT
      // ---------------------------------------------------------
      const mxThresholdHitTime = mx.tracking_type === 'time' && remaining <= schedTime;
      const mxThresholdHitPredictive = mx.tracking_type === 'time' && projectedDays <= predictiveSchedDays;
      const mxThresholdHitDate = mx.tracking_type === 'date' && remaining <= schedDays;

      if (mx.automate_scheduling && !mx.mx_schedule_sent) {

        // SCENARIO A: Threshold hit (high confidence or hard limit) → Create draft
        if (mxThresholdHitTime || mxThresholdHitDate || (mxThresholdHitPredictive && confidenceScore >= 80)) {

          let dueString = mx.tracking_type === 'time' ? `at ${mx.due_time} hours` : `on ${mx.due_date}`;
          if (mx.tracking_type === 'time' && burnRate > 0) {
            dueString += ` (projected ~${Math.ceil(projectedDays)} days)`;
          }

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
            await supabaseAdmin.from('aft_event_line_items').insert({
              event_id: draftEvent.id,
              item_type: 'maintenance',
              maintenance_item_id: mx.id,
              item_name: mx.item_name,
              item_description: `Due ${dueString}`,
            } as any);

            await supabaseAdmin.from('aft_event_messages').insert({
              event_id: draftEvent.id,
              sender: 'system',
              message_type: 'status_update',
              message: `Draft created automatically. ${mx.item_name} is approaching: ${dueString}.`,
            } as any);

            // Email the PRIMARY CONTACT to review and send
            if (aircraft.main_contact_email) {
              const appUrl = new URL(req.url).origin;
              await resend.emails.send({
                from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
                replyTo: aircraft.main_contact_email,
                to: [aircraft.main_contact_email],
                subject: `Action Required: Review & Send Work Package for ${aircraft.tail_number}`,
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
                    <h2 style="color: #091F3C; text-transform: uppercase; letter-spacing: 2px; border-bottom: 2px solid #091F3C; padding-bottom: 10px;">Maintenance Coming Due</h2>
                    
                    <p style="color: #525659; font-size: 16px;">Hello ${aircraft.main_contact || 'Operations'},</p>
                    <p style="color: #525659; font-size: 16px;">The following maintenance item is approaching for <strong>${aircraft.tail_number}</strong>:</p>
                    
                    <div style="background-color: #FFF7ED; padding: 20px; border-left: 4px solid #F08B46; margin: 25px 0; border-radius: 4px;">
                      <p style="margin: 0 0 8px 0; color: #091F3C; font-size: 18px;"><strong>${mx.item_name}</strong></p>
                      <p style="margin: 0; color: #525659; font-size: 14px;">Due ${dueString}</p>
                    </div>

                    <p style="color: #525659; font-size: 16px;">We've prepared a <strong>draft work package</strong> for you. Open the app to:</p>
                    <ul style="color: #525659; font-size: 14px; line-height: 2;">
                      <li>Add any open squawks you'd like addressed</li>
                      <li>Request additional services (wash, fluid top-off, nav update, etc.)</li>
                      <li>Propose a preferred service date</li>
                      <li>Send the complete package to ${aircraft.mx_contact || 'your mechanic'}</li>
                    </ul>

                    <div style="margin-top: 25px; text-align: center;">
                      <a href="${appUrl}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; letter-spacing: 1px;">OPEN AIRCRAFT MANAGER</a>
                    </div>
                  </div>
                `
              });
            }
          }

          flagToUpdate.mx_schedule_sent = true;
        }
        // SCENARIO B: Low-confidence predictive → heads-up to owner only
        else if (mxThresholdHitPredictive && confidenceScore < 80 && !mx.primary_heads_up_sent) {
          if (aircraft.main_contact_email) {
            await resend.emails.send({
              from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
              replyTo: aircraft.main_contact_email,
              to: [aircraft.main_contact_email],
              subject: `Heads Up: ${aircraft.tail_number} MX Approaching (Low Confidence)`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h2 style="color: #091F3C;">Predictive Maintenance Alert</h2>
                  <p>Hello ${aircraft.main_contact || 'Operations'},</p>
                  <p>Based on recent flight activity, we estimate that <strong>${mx.item_name}</strong> for ${aircraft.tail_number} may come due in roughly <strong>${Math.ceil(projectedDays)} days</strong>.</p>
                  <p>However, flight logs have been irregular (System Confidence: <strong>${confidenceScore}%</strong>), so this estimate may shift significantly.</p>
                  <p style="margin-top: 20px;">No action is needed yet. We'll create a draft work package automatically when the item gets closer to its threshold. You can also schedule service proactively from the Maintenance tab at any time.</p>
                  <div style="margin-top: 25px; text-align: center;">
                    <a href="${new URL(req.url).origin}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; letter-spacing: 1px;">OPEN AIRCRAFT MANAGER</a>
                  </div>
                </div>
              `
            });
            flagToUpdate.primary_heads_up_sent = true;
          }
        }
      }

      // ---------------------------------------------------------
      // 2. INTERNAL MX REMINDER — Only to PRIMARY CONTACT
      // ---------------------------------------------------------
      let hitReminder3 = false, hitReminder2 = false, hitReminder1 = false;
      let internalTriggerTemplate: string | null = null;

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

      // FIX: Send only to primary contact, not all assigned pilots
      if (internalTriggerTemplate && aircraft.main_contact_email) {
        await resend.emails.send({
          from: `Skyward Alerts <${FROM_EMAIL}>`,
          to: [aircraft.main_contact_email],
          subject: `Maintenance Alert: ${aircraft.tail_number} Due Soon`,
          html: `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6;">
                  <p>This is an automated reminder that required maintenance is coming due for ${aircraft.tail_number}.</p>
                  <p style="margin-top: 20px;"><strong>Item:</strong> ${mx.item_name}<br/><strong>Status:</strong> ${internalTriggerTemplate}</p>
                  <div style="margin-top: 25px; text-align: center;">
                    <a href="${new URL(req.url).origin}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; letter-spacing: 1px;">OPEN AIRCRAFT MANAGER</a>
                  </div>
                </div>`
        });
      }

      if (Object.keys(flagToUpdate).length > 0) {
        await supabaseAdmin.from('aft_maintenance_items').update(flagToUpdate).eq('id', mx.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

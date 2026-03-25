import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function GET(req: Request) {
  try {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: aircraftList } = await supabaseAdmin.from('aft_aircraft').select('*');
    const { data: mxItems } = await supabaseAdmin.from('aft_maintenance_items').select('*').eq('is_required', true);
    
    if (!aircraftList || !mxItems) return NextResponse.json({ success: true, note: "No data" });

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

    const { data: allRoles } = await supabaseAdmin.from('aft_user_roles').select('*');
    const { data: allAccess } = await supabaseAdmin.from('aft_user_aircraft_access').select('*');

    // Fetch Flight Logs from last 180 days for Confidence & Burn Rate
    const oneEightyDaysAgo = new Date();
    oneEightyDaysAgo.setDate(oneEightyDaysAgo.getDate() - 180);
    const { data: recentLogs } = await supabaseAdmin
      .from('aft_flight_logs')
      .select('aircraft_id, ftt, tach, created_at')
      .gte('created_at', oneEightyDaysAgo.toISOString())
      .order('created_at', { ascending: true }); // Oldest first

    const admins = allRoles?.filter(r => r.role === 'admin').map(a => a.email).filter(Boolean) ||[];

    for (const mx of mxItems) {
      const aircraft = aircraftList.find(a => a.id === mx.aircraft_id);
      if (!aircraft) continue;

      let remaining = 0;
      let projectedDays = Infinity;
      let burnRate = 0;
      let confidenceScore = 0;

      // 1. BURN RATE & CONFIDENCE ALGORITHM
      const planeLogs = recentLogs?.filter(l => l.aircraft_id === aircraft.id) ||[];
      if (planeLogs.length > 0) {
        const isTurbine = aircraft.engine_type === 'Turbine';
        const currentTime = aircraft.total_engine_time || 0;
        
        // A. 60-Day Adaptive Burn Rate
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        const logs60 = planeLogs.filter(l => new Date(l.created_at) >= sixtyDaysAgo);
        if (logs60.length > 0) {
          const oldest60 = logs60[0];
          const oldestTime = isTurbine ? oldest60.ftt : oldest60.tach;
          const daysElapsed = Math.max(1, (new Date().getTime() - new Date(oldest60.created_at).getTime()) / (1000 * 60 * 60 * 24));
          if (oldestTime !== null && oldestTime !== undefined && currentTime > oldestTime) {
            burnRate = (currentTime - oldestTime) / daysElapsed;
          }
        }

        // B. 180-Day Reliability Score
        const oldestLog = planeLogs[0];
        const daysSpan = Math.max(1, (new Date().getTime() - new Date(oldestLog.created_at).getTime()) / (1000 * 60 * 60 * 24));
        const historyScore = Math.min(50, (daysSpan / 180) * 50); // Max 50 pts for history span
        const targetLogs = (daysSpan / 30) * 4; // Target 4 flights per month
        const densityScore = targetLogs > 0 ? Math.min(50, (planeLogs.length / targetLogs) * 50) : 0; // Max 50 pts for consistency
        confidenceScore = Math.round(historyScore + densityScore);
      }

      if (mx.tracking_type === 'time') {
        remaining = mx.due_time - (aircraft.total_engine_time || 0);
        if (burnRate > 0) projectedDays = remaining / burnRate;
      } else {
        const diffTime = new Date(mx.due_date + 'T00:00:00').getTime() - new Date(new Date().setHours(0,0,0,0)).getTime();
        remaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        projectedDays = remaining;
      }

      let flagToUpdate: any = {};
      let internalTriggerTemplate = null;

      // ---------------------------------------------------------
      // 2. AUTOMATED MECHANIC SCHEDULING (Predictive Logic)
      // ---------------------------------------------------------
      const mxThresholdHitTime = mx.tracking_type === 'time' && remaining <= schedTime;
      const mxThresholdHitPredictive = mx.tracking_type === 'time' && projectedDays <= predictiveSchedDays;
      const mxThresholdHitDate = mx.tracking_type === 'date' && remaining <= schedDays;
      
      if (mx.automate_scheduling && !mx.mx_schedule_sent) {
        
        // SCENARIO A: Auto-Send to Mechanic (Date MX, Hard Time MX, or High-Confidence Predictive)
        if (mxThresholdHitTime || mxThresholdHitDate || (mxThresholdHitPredictive && confidenceScore >= 80)) {
          if (aircraft.mx_contact_email) {
            const mxCc = aircraft.main_contact_email ? [aircraft.main_contact_email] :[];
            let dueString = mx.tracking_type === 'time' ? `at ${mx.due_time} hours` : `on ${mx.due_date}`;
            if (mx.tracking_type === 'time' && burnRate > 0) {
              dueString += ` (Projected to hit in ~${Math.ceil(projectedDays)} days)`;
            }

            await resend.emails.send({
              from: `Skyward Operations <${FROM_EMAIL}>`,
              to: [aircraft.mx_contact_email],
              cc: mxCc,
              subject: `Scheduling Request: ${aircraft.tail_number} Maintenance`,
              html: `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6;">
                      <p>Hello ${aircraft.mx_contact || ''},</p>
                      <p>The following maintenance item is coming due for ${aircraft.tail_number}. Please let us know when you are able to add this aircraft to your schedule.</p>
                      <p style="margin-top: 20px;"><strong>Item:</strong> ${mx.item_name}<br/><strong>Due:</strong> ${dueString}</p>
                      <p style="margin-top: 20px;">Thank you,<br/><strong>${aircraft.main_contact || 'Skyward Operations'}</strong></p>
                    </div>`
            });
            flagToUpdate.mx_schedule_sent = true;
          }
        } 
        // SCENARIO B: Heads-up to Primary Contact (Low-Confidence Predictive)
        else if (mxThresholdHitPredictive && confidenceScore < 80 && !mx.primary_heads_up_sent) {
          if (aircraft.main_contact_email) {
            await resend.emails.send({
              from: `Skyward System <${FROM_EMAIL}>`,
              to:[aircraft.main_contact_email],
              subject: `Action Required: ${aircraft.tail_number} MX Prediction`,
              html: `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6;">
                      <p>Hello ${aircraft.main_contact || 'Operations'},</p>
                      <p>We estimate that maintenance for <strong>${mx.item_name}</strong> is coming due in roughly ${Math.ceil(projectedDays)} days for ${aircraft.tail_number}.</p>
                      <p>However, because recent flight logs have been irregular (System Confidence: ${confidenceScore}%), we have paused the automated request to your mechanic.</p>
                      <p style="margin-top: 20px; font-weight: bold; color: #CE3732;">Please log into the Skyward Fleet Portal and navigate to the Maintenance tab to manually approve and dispatch the scheduling request.</p>
                    </div>`
            });
            flagToUpdate.primary_heads_up_sent = true;
          }
        }
      }

      // ---------------------------------------------------------
      // 3. INTERNAL PILOT/ADMIN ALERTS 
      // ---------------------------------------------------------
      let hitReminder3 = false, hitReminder2 = false, hitReminder1 = false;
      
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

      if (internalTriggerTemplate) {
        const assignedPilotsIds = allAccess?.filter(a => a.aircraft_id === aircraft.id).map(a => a.user_id) ||[];
        const assignedPilotsEmails = allRoles?.filter(r => assignedPilotsIds.includes(r.user_id)).map(r => r.email).filter(Boolean) ||[];
        
        const combinedEmails = admins.concat(assignedPilotsEmails);
        const recipients: string[] =[];
        for (let i = 0; i < combinedEmails.length; i++) {
          const email = combinedEmails[i];
          if (email && typeof email === 'string' && !recipients.includes(email)) recipients.push(email);
        }

        if (recipients.length > 0) {
          await resend.emails.send({
            from: `Skyward Alerts <${FROM_EMAIL}>`,
            to: recipients,
            subject: `Maintenance Alert: ${aircraft.tail_number} Due Soon`,
            html: `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6;">
                    <p>This is an automated reminder that required maintenance is coming due for ${aircraft.tail_number}.</p>
                    <p style="margin-top: 20px;"><strong>Item:</strong> ${mx.item_name}<br/><strong>Status:</strong> ${internalTriggerTemplate}</p>
                  </div>`
          });
        }
      }

      if (Object.keys(flagToUpdate).length > 0) {
        await supabaseAdmin.from('aft_maintenance_items').update(flagToUpdate).eq('id', mx.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
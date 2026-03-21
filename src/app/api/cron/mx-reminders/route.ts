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

    // Fetch Global Settings for Dynamic Triggers
    const { data: settings } = await supabaseAdmin.from('aft_system_settings').select('*').eq('id', 1).single();
    const reminder1 = settings?.reminder_1 ?? 30;
    const reminder2 = settings?.reminder_2 ?? 15;
    const reminder3 = settings?.reminder_3 ?? 5;
    const schedTime = settings?.sched_time ?? 10;
    const schedDays = settings?.sched_days ?? 30;

    const { data: allRoles } = await supabaseAdmin.from('aft_user_roles').select('*');
    const { data: allAccess } = await supabaseAdmin.from('aft_user_aircraft_access').select('*');

    const admins = allRoles?.filter(r => r.role === 'admin').map(a => a.email).filter(Boolean) ||[];

    for (const mx of mxItems) {
      const aircraft = aircraftList.find(a => a.id === mx.aircraft_id);
      if (!aircraft) continue;

      let remaining = 0;
      if (mx.tracking_type === 'time') {
        remaining = mx.due_time - (aircraft.total_engine_time || 0);
      } else {
        const diffTime = new Date(mx.due_date + 'T00:00:00').getTime() - new Date(new Date().setHours(0,0,0,0)).getTime();
        remaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }

      let flagToUpdate: any = {};
      let internalTriggerTemplate = null;

      // ---------------------------------------------------------
      // 1. AUTOMATED MECHANIC SCHEDULING (Dynamic Triggers)
      // ---------------------------------------------------------
      const mxThresholdHit = (mx.tracking_type === 'time' && remaining <= schedTime) || (mx.tracking_type === 'date' && remaining <= schedDays);
      
      if (mx.automate_scheduling && mxThresholdHit && !mx.mx_schedule_sent && aircraft.mx_contact_email) {
        
        const mxCc = aircraft.main_contact_email ? [aircraft.main_contact_email] :[];
        const dueString = mx.tracking_type === 'time' ? `at ${mx.due_time} hours` : `on ${mx.due_date}`;

        const mxGreeting = aircraft.mx_contact 
          ? `<p style="color: #525659; font-size: 16px; margin-bottom: 20px;">Hello ${aircraft.mx_contact},</p>` 
          : `<p style="color: #525659; font-size: 16px; margin-bottom: 20px;">Hello,</p>`;

        const mxSignature = `
          <p style="color: #525659; font-size: 16px; margin-top: 20px;">
            Thank you,<br/>
            <strong>${aircraft.main_contact || 'Skyward Operations'}</strong><br/>
            ${aircraft.main_contact_phone ? `${aircraft.main_contact_phone}<br/>` : ''}
            ${aircraft.main_contact_email ? `<a href="mailto:${aircraft.main_contact_email}" style="color: #525659;">${aircraft.main_contact_email}</a>` : ''}
          </p>
        `;

        await resend.emails.send({
          from: `Skyward Operations <${FROM_EMAIL}>`,
          to:[aircraft.mx_contact_email],
          cc: mxCc,
          subject: `Scheduling Request: ${aircraft.tail_number} Maintenance`,
          html: `
            <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6; max-w: 600px;">
              ${mxGreeting}
              
              <p>The following maintenance item is coming due for ${aircraft.tail_number}. Please let us know when you are able to add this aircraft to your schedule.</p>
              
              <p style="margin-top: 20px;"><strong>Maintenance Details:</strong><br/>
              Item: ${mx.item_name}<br/>
              Due: ${dueString}</p>
              
              ${mxSignature}
            </div>
          `
        });

        flagToUpdate.mx_schedule_sent = true;
      }

      // ---------------------------------------------------------
      // 2. INTERNAL PILOT/ADMIN ALERTS (Dynamic Triggers)
      // ---------------------------------------------------------
      if (remaining <= reminder3 && !mx.reminder_5_sent) {
        internalTriggerTemplate = `DUE IN ${remaining.toFixed(1)} ${mx.tracking_type === 'time' ? 'HOURS' : 'DAYS'}`;
        flagToUpdate.reminder_5_sent = true; flagToUpdate.reminder_15_sent = true; flagToUpdate.reminder_30_sent = true;
      } else if (remaining <= reminder2 && !mx.reminder_15_sent) {
        internalTriggerTemplate = `DUE IN ${remaining.toFixed(1)} ${mx.tracking_type === 'time' ? 'HOURS' : 'DAYS'}`;
        flagToUpdate.reminder_15_sent = true; flagToUpdate.reminder_30_sent = true;
      } else if (remaining <= reminder1 && !mx.reminder_30_sent) {
        internalTriggerTemplate = `DUE IN ${remaining.toFixed(1)} ${mx.tracking_type === 'time' ? 'HOURS' : 'DAYS'}`;
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
            html: `
              <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6; max-w: 600px;">
                <p>This is an automated reminder that required maintenance is coming due for ${aircraft.tail_number}.</p>
                <p style="margin-top: 20px;"><strong>Item:</strong> ${mx.item_name}<br/>
                <strong>Status:</strong> ${internalTriggerTemplate}</p>
                <p style="margin-top: 20px;">Log in to the fleet portal to manage maintenance scheduling.</p>
              </div>
            `
          });
        }
      }

      // ---------------------------------------------------------
      // 3. UPDATE THE DATABASE FLAGS SO WE DONT SPAM
      // ---------------------------------------------------------
      if (Object.keys(flagToUpdate).length > 0) {
        await supabaseAdmin.from('aft_maintenance_items').update(flagToUpdate).eq('id', mx.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
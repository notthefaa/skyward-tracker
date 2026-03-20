import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function GET(req: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, 
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Fetch Aircraft and MX Items
    const { data: aircraftList } = await supabaseAdmin.from('aft_aircraft').select('*');
    const { data: mxItems } = await supabaseAdmin.from('aft_maintenance_items').select('*').eq('is_required', true);

    if (!aircraftList || !mxItems) {
      return NextResponse.json({ success: true, note: "No data" });
    }

    // 2. Fetch Users
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

      // Check Thresholds
      let triggerTemplate = null;
      let flagToUpdate = null;
      let alertColor = "#F08B46"; // Orange for 30/15

      // 5 Days/Hours is RED
      if (remaining <= 5 && !mx.reminder_5_sent) {
        triggerTemplate = `DUE IN ${remaining.toFixed(1)} ${mx.tracking_type === 'time' ? 'HOURS' : 'DAYS'}`;
        flagToUpdate = { reminder_5_sent: true, reminder_15_sent: true, reminder_30_sent: true };
        alertColor = "#CE3732"; 
      } else if (remaining <= 15 && !mx.reminder_15_sent) {
        triggerTemplate = `DUE IN ${remaining.toFixed(1)} ${mx.tracking_type === 'time' ? 'HOURS' : 'DAYS'}`;
        flagToUpdate = { reminder_15_sent: true, reminder_30_sent: true };
      } else if (remaining <= 30 && !mx.reminder_30_sent) {
        triggerTemplate = `DUE IN ${remaining.toFixed(1)} ${mx.tracking_type === 'time' ? 'HOURS' : 'DAYS'}`;
        flagToUpdate = { reminder_30_sent: true };
      }

      if (triggerTemplate && flagToUpdate) {
        // Compile recipient list
        const assignedPilotsIds = allAccess?.filter(a => a.aircraft_id === aircraft.id).map(a => a.user_id) ||[];
        const assignedPilotsEmails = allRoles?.filter(r => assignedPilotsIds.includes(r.user_id)).map(r => r.email).filter(Boolean) ||[];
        
        // FIX: Manual deduplication loop to bypass the Set() and Array.from() TypeScript bugs
        const combinedEmails = admins.concat(assignedPilotsEmails);
        const recipients: string[] =[];
        for (let i = 0; i < combinedEmails.length; i++) {
          const email = combinedEmails[i];
          if (email && !recipients.includes(email)) {
            recipients.push(email);
          }
        }

        if (recipients.length > 0) {
          await resend.emails.send({
            from: `Skyward Alerts <${FROM_EMAIL}>`,
            to: recipients,
            subject: `URGENT: ${aircraft.tail_number} Maintenance Due`,
            html: `
              <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
                <h2 style="color: #1B4869; text-transform: uppercase; letter-spacing: 2px; border-bottom: 2px solid #1B4869; padding-bottom: 10px;">Skyward Fleet Alert</h2>
                <p style="color: #525659; font-size: 16px;">This is an automated reminder that required maintenance is coming due for <strong>${aircraft.tail_number}</strong>.</p>
                
                <div style="background-color: #FDFCF4; padding: 20px; border-left: 4px solid ${alertColor}; margin: 25px 0; border-radius: 4px;">
                  <p style="margin: 0 0 10px 0; color: #1B4869; font-size: 18px;"><strong>Item:</strong> ${mx.item_name}</p>
                  <p style="margin: 0; color: ${alertColor}; font-size: 16px; font-weight: bold;"><strong>Status:</strong> ${triggerTemplate}</p>
                </div>
                
                <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">Log in to the fleet portal to manage maintenance scheduling.</p>
              </div>
            `
          });
        }
        
        // Mark as sent so it doesn't fire again tomorrow
        await supabaseAdmin.from('aft_maintenance_items').update(flagToUpdate).eq('id', mx.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
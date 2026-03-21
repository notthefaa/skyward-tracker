import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    const { squawk, aircraft, notifyMx } = await req.json();
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: admins } = await supabaseAdmin.from('aft_user_roles').select('email').eq('role', 'admin');
    const { data: access } = await supabaseAdmin.from('aft_user_aircraft_access').select('user_id').eq('aircraft_id', aircraft.id);
    
    let pilotEmails: string[] =[];
    if (access && access.length > 0) {
      const userIds = access.map(a => a.user_id);
      const { data: pilots } = await supabaseAdmin.from('aft_user_roles').select('email').in('user_id', userIds);
      if (pilots) {
        for (let i = 0; i < pilots.length; i++) {
          if (pilots[i].email) pilotEmails.push(pilots[i].email);
        }
      }
    }

    const adminEmails = admins ? admins.map(a => a.email).filter(Boolean) :[];
    const combinedEmails = adminEmails.concat(pilotEmails);
    const internalEmails: string[] =[];
    
    for (let i = 0; i < combinedEmails.length; i++) {
      const email = combinedEmails[i];
      if (email && typeof email === 'string' && !internalEmails.includes(email)) {
        internalEmails.push(email);
      }
    }

    // 1. EMAIL TO MECHANIC (Unbranded & Professional)
    if (notifyMx && aircraft.mx_contact_email) {
      const mxCc = aircraft.main_contact_email ?[aircraft.main_contact_email] :[];
      
      const mxGreeting = aircraft.mx_contact 
        ? `<p style="margin-bottom: 20px;">Hello ${aircraft.mx_contact},</p>` 
        : `<p style="margin-bottom: 20px;">Hello,</p>`;

      const mxSignature = `
        <p style="margin-top: 20px;">
          Thank you,<br/>
          <strong>${aircraft.main_contact || 'Skyward Operations'}</strong><br/>
          ${aircraft.main_contact_phone ? `${aircraft.main_contact_phone}<br/>` : ''}
          ${aircraft.main_contact_email ? `<a href="mailto:${aircraft.main_contact_email}" style="color: #333333;">${aircraft.main_contact_email}</a>` : ''}
        </p>
      `;

      await resend.emails.send({
        from: `Skyward Operations <${FROM_EMAIL}>`,
        to: [aircraft.mx_contact_email],
        cc: mxCc,
        subject: `Service Request: ${aircraft.tail_number} Squawk`,
        html: `
          <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6; max-w: 600px;">
            ${mxGreeting}
            
            <p>A new squawk has been reported for ${aircraft.tail_number}. Please let us know when you are able to accommodate this aircraft in your schedule to address the issue.</p>
            
            <p style="margin-top: 20px;"><strong>Squawk Details:</strong><br/>
            Location: ${squawk.location}<br/>
            Status: ${squawk.affects_airworthiness ? 'AOG / GROUNDED' : 'Monitor'}<br/>
            Description: ${squawk.description}</p>
            
            <p style="margin-top: 20px;">You can view the full report and attached photos securely here:<br/>
            <a href="${new URL(req.url).origin}/squawk/${squawk.id}">${new URL(req.url).origin}/squawk/${squawk.id}</a></p>
            
            ${mxSignature}
          </div>
        `
      });
    }

    // 2. EMAIL TO INTERNAL TEAM (Unbranded)
    if (internalEmails.length > 0) {
      await resend.emails.send({
        from: `Skyward Alerts <${FROM_EMAIL}>`,
        to: internalEmails,
        subject: `New Squawk: ${aircraft.tail_number}`,
        html: `
          <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6; max-w: 600px;">
            <p>A new squawk was reported on ${aircraft.tail_number} by ${squawk.reporter_initials || 'a pilot'}.</p>
            
            <p style="margin-top: 20px;"><strong>Squawk Details:</strong><br/>
            Location: ${squawk.location}<br/>
            Grounded: ${squawk.affects_airworthiness ? 'YES' : 'NO'}<br/>
            Description: ${squawk.description}</p>
            
            <p style="margin-top: 20px;">Please log in to the fleet portal to view full details and any attached photos.</p>
          </div>
        `
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
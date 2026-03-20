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

    // FIX: ES5-safe array concatenation and deduplication to bypass TS2802 Vercel Error
    const adminEmails = admins ? admins.map(a => a.email).filter(Boolean) :[];
    const combinedEmails = adminEmails.concat(pilotEmails);
    const internalEmails: string[] =[];
    
    for (let i = 0; i < combinedEmails.length; i++) {
      const email = combinedEmails[i];
      if (email && typeof email === 'string' && !internalEmails.includes(email)) {
        internalEmails.push(email);
      }
    }

    // 1. EMAIL TO MECHANIC (If requested)
    if (notifyMx && aircraft.mx_contact_email) {
      const mxCc = aircraft.main_contact_email ? [aircraft.main_contact_email] :[];
      await resend.emails.send({
        from: `Skyward Maintenance <${FROM_EMAIL}>`,
        to:[aircraft.mx_contact_email],
        cc: mxCc,
        subject: `Service Request: ${aircraft.tail_number} Squawk`,
        html: `
          <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
            <h2 style="color: #1B4869; text-transform: uppercase; letter-spacing: 2px; border-bottom: 2px solid #1B4869; padding-bottom: 10px;">Skyward Society</h2>
            <p style="color: #525659; font-size: 16px;">Hello ${aircraft.mx_contact || 'Maintenance Team'},</p>
            <p style="color: #525659; font-size: 16px;">A new squawk has been reported for <strong>${aircraft.tail_number}</strong>. Please let us know when you are able to accommodate this aircraft in your schedule to address the issue.</p>
            
            <div style="background-color: #FDFCF4; padding: 20px; border-left: 4px solid #CE3732; margin: 25px 0; border-radius: 4px;">
              <p style="margin: 0 0 10px 0; color: #1B4869;"><strong>Location:</strong> ${squawk.location}</p>
              <p style="margin: 0 0 10px 0; color: #1B4869;"><strong>Status:</strong> <span style="color: ${squawk.affects_airworthiness ? '#CE3732' : '#F08B46'}; font-weight: bold;">${squawk.affects_airworthiness ? 'AOG / GROUNDED' : 'Monitor'}</span></p>
              <p style="margin: 0; color: #1B4869;"><strong>Description:</strong><br/><span style="color: #525659; line-height: 1.5;">${squawk.description}</span></p>
            </div>

            <div style="margin: 30px 0;">
              <a href="${new URL(req.url).origin}/squawk/${squawk.id}" style="background-color: #1B4869; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; text-transform: uppercase; font-size: 14px;">View Full Report & Photos</a>
            </div>
            <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">This is an automated service request from the Skyward Aircraft Tracker.</p>
          </div>
        `
      });
    }

    // 2. EMAIL TO INTERNAL TEAM (Pilots & Admins)
    if (internalEmails.length > 0) {
      await resend.emails.send({
        from: `Skyward Alerts <${FROM_EMAIL}>`,
        to: internalEmails,
        subject: `New Squawk: ${aircraft.tail_number}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
            <h2 style="color: #1B4869; text-transform: uppercase; letter-spacing: 2px; border-bottom: 2px solid #1B4869; padding-bottom: 10px;">Skyward Fleet Alert</h2>
            <p style="color: #525659; font-size: 16px;">A new squawk was reported on <strong>${aircraft.tail_number}</strong> by <strong>${squawk.reporter_initials || 'a pilot'}</strong>.</p>
            
            <div style="background-color: #FDFCF4; padding: 20px; border-left: 4px solid ${squawk.affects_airworthiness ? '#CE3732' : '#F08B46'}; margin: 25px 0; border-radius: 4px;">
              <p style="margin: 0 0 10px 0; color: #1B4869;"><strong>Location:</strong> ${squawk.location}</p>
              <p style="margin: 0 0 10px 0; color: #1B4869;"><strong>Grounded:</strong> <span style="color: ${squawk.affects_airworthiness ? '#CE3732' : '#56B94A'}; font-weight: bold;">${squawk.affects_airworthiness ? 'YES' : 'NO'}</span></p>
              <p style="margin: 0; color: #1B4869;"><strong>Description:</strong><br/><span style="color: #525659; line-height: 1.5;">${squawk.description}</span></p>
            </div>

            <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">Log in to the fleet portal to view full details.</p>
          </div>
        `
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
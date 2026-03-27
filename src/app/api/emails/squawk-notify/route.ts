import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireAuth, handleApiError } from '@/lib/auth';
import { env } from '@/lib/env';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    // SECURITY: Require authentication
    const { supabaseAdmin } = await requireAuth(req);
    const { squawk, aircraft, notifyMx } = await req.json();

    if (!squawk || !aircraft) {
      return NextResponse.json({ error: 'Squawk and aircraft data are required.' }, { status: 400 });
    }

    const { data: admins } = await supabaseAdmin.from('aft_user_roles').select('email').eq('role', 'admin');
    const { data: access } = await supabaseAdmin.from('aft_user_aircraft_access').select('user_id').eq('aircraft_id', aircraft.id);

    let pilotEmails: string[] = [];
    if (access && access.length > 0) {
      const userIds = access.map(a => a.user_id);
      const { data: pilots } = await supabaseAdmin.from('aft_user_roles').select('email').in('user_id', userIds);
      if (pilots) {
        for (const p of pilots) {
          if (p.email) pilotEmails.push(p.email);
        }
      }
    }

    const adminEmails = admins ? admins.map(a => a.email).filter(Boolean) as string[] : [];
    const combinedEmails = [...adminEmails, ...pilotEmails];
    const internalEmails = Array.from(new Set(combinedEmails)); // Deduplicate

    // 1. EMAIL TO MECHANIC (Unbranded & Professional)
    if (notifyMx && aircraft.mx_contact_email) {
      const mxCc = aircraft.main_contact_email ? [aircraft.main_contact_email] : [];

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
          <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6; max-width: 600px;">
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

    // 2. EMAIL TO INTERNAL TEAM
    if (internalEmails.length > 0) {
      await resend.emails.send({
        from: `Skyward Alerts <${FROM_EMAIL}>`,
        to: internalEmails,
        subject: `New Squawk: ${aircraft.tail_number}`,
        html: `
          <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6; max-width: 600px;">
            <p>A new squawk was reported on ${aircraft.tail_number} by ${squawk.reporter_initials || 'a pilot'}.</p>
            
            <p style="margin-top: 20px;"><strong>Squawk Details:</strong><br/>
            Location: ${squawk.location}<br/>
            Grounded: ${squawk.affects_airworthiness ? 'YES' : 'NO'}<br/>
            Description: ${squawk.description}</p>
            
            <div style="margin-top: 25px; text-align: center;">
              <a href="${new URL(req.url).origin}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; letter-spacing: 1px;">OPEN SKYWARD TRACKER</a>
            </div>
          </div>
        `
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

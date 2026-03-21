import { NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function POST(req: Request) {
  try {
    const { aircraft, mxItem } = await req.json();
    
    if (aircraft.mx_contact_email) {
      const mxCc = aircraft.main_contact_email ? [aircraft.main_contact_email] :[];
      
      let dueString = mxItem.tracking_type === 'time' 
        ? `at ${mxItem.due_time} hours` 
        : `on ${mxItem.due_date}`;

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
        from: `Skyward Maintenance <${FROM_EMAIL}>`,
        to: [aircraft.mx_contact_email],
        cc: mxCc,
        subject: `Scheduling Request: ${aircraft.tail_number} Maintenance`,
        html: `
          <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
            <h2 style="color: #1B4869; text-transform: uppercase; letter-spacing: 2px; border-bottom: 2px solid #1B4869; padding-bottom: 10px;">Skyward Society</h2>
            
            ${mxGreeting}
            
            <p style="color: #525659; font-size: 16px;">The following maintenance item is coming due for <strong>${aircraft.tail_number}</strong>. Please let us know when you are able to add this aircraft to your schedule.</p>
            
            <div style="background-color: #FDFCF4; padding: 20px; border-left: 4px solid #F08B46; margin: 25px 0; border-radius: 4px;">
              <p style="margin: 0 0 10px 0; color: #1B4869; font-size: 18px;"><strong>Item:</strong> ${mxItem.item_name}</p>
              <p style="margin: 0; color: #1B4869; font-size: 16px;"><strong>Due:</strong> ${dueString}</p>
            </div>

            ${mxSignature}
            
            <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">This is an automated scheduling request from the Skyward Aircraft Tracker.</p>
          </div>
        `
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
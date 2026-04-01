import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient, handleApiError } from '@/lib/auth';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { PORTAL_EXPIRY_DAYS } from '@/lib/constants';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const accessToken = formData.get('accessToken') as string;
    const description = formData.get('description') as string || '';
    const files = formData.getAll('files') as File[];

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required.' }, { status: 400 });
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'At least one file is required.' }, { status: 400 });
    }

    if (files.length > 5) {
      return NextResponse.json({ error: 'Maximum 5 files per upload.' }, { status: 400 });
    }

    const supabaseAdmin = createAdminClient();
    const baseUrl = new URL(req.url).origin;

    // Validate the access token
    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events')
      .select('*')
      .eq('access_token', accessToken)
      .single();

    if (evErr || !event) {
      return NextResponse.json({ error: 'Service event not found.' }, { status: 404 });
    }

    // Token expiry: reject uploads on events completed more than PORTAL_EXPIRY_DAYS ago
    if (event.status === 'complete' && event.completed_at) {
      const expiryDate = new Date(new Date(event.completed_at).getTime() + PORTAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      if (new Date() > expiryDate) {
        return NextResponse.json({ error: 'This service portal link has expired.' }, { status: 403 });
      }
    }

    if (event.status === 'complete' || event.status === 'cancelled') {
      return NextResponse.json({ error: 'Cannot upload to a completed or cancelled event.' }, { status: 400 });
    }

    // Process and upload each file
    const attachments: { url: string; filename: string; size: number; type: string }[] = [];

    for (const file of files) {
      // Validate size
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File "${file.name}" exceeds the 10MB limit.` },
          { status: 400 }
        );
      }

      // Validate type
      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json(
          { error: `File type "${file.type}" is not supported. Accepted: images, PDF, Word documents.` },
          { status: 400 }
        );
      }

      // Generate a unique filename: eventId_timestamp_originalName
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileName = `${event.id}_${Date.now()}_${safeName}`;

      const buffer = Buffer.from(await file.arrayBuffer());

      const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
        .from('aft_event_attachments')
        .upload(fileName, buffer, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadErr) {
        console.error('Upload error:', uploadErr);
        return NextResponse.json(
          { error: `Failed to upload "${file.name}".` },
          { status: 500 }
        );
      }

      const { data: urlData } = supabaseAdmin.storage
        .from('aft_event_attachments')
        .getPublicUrl(uploadData.path);

      attachments.push({
        url: urlData.publicUrl,
        filename: file.name,
        size: file.size,
        type: file.type,
      });
    }

    // Create a message with the attachments
    const messageText = description
      ? `Attached ${attachments.length} file${attachments.length > 1 ? 's' : ''}: ${description}`
      : `Attached ${attachments.length} file${attachments.length > 1 ? 's' : ''}.`;

    await supabaseAdmin.from('aft_event_messages').insert({
      event_id: event.id,
      sender: 'mechanic',
      message_type: 'comment',
      message: messageText,
      attachments: attachments,
    } as any);

    // Notify the owner
    if (event.primary_contact_email) {
      const appUrl = baseUrl;
      const safeMxName = escapeHtml(event.mx_contact_name || 'Your mechanic');
      const safeDescription = escapeHtml(description);

      const fileList = attachments
        .map(a => {
          const isImage = a.type.startsWith('image/');
          const safeFilename = escapeHtml(a.filename);
          return `<li style="margin-bottom: 4px;">${isImage ? '📷' : '📎'} ${safeFilename}</li>`;
        })
        .join('');

      await resend.emails.send({
        from: `Skyward Operations <${FROM_EMAIL}>`,
        to: [event.primary_contact_email],
        subject: `${safeMxName} uploaded files to your work package`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #091F3C;">Files Uploaded</h2>
            <p>${safeMxName} has uploaded ${attachments.length} file${attachments.length > 1 ? 's' : ''} to your service event:</p>
            ${safeDescription ? `<p style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-left: 4px solid #3AB0FF; border-radius: 4px;"><em>${safeDescription}</em></p>` : ''}
            <ul style="margin-top: 15px; font-size: 14px; color: #333;">${fileList}</ul>
            <p style="margin-top: 15px; color: #666;">Open the app to view the full details.</p>
            <div style="margin-top: 25px; text-align: center;">
              <a href="${appUrl}" style="display: inline-block; background-color: #091F3C; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; letter-spacing: 1px;">OPEN AIRCRAFT MANAGER</a>
            </div>
          </div>
        `,
      });
    }

    return NextResponse.json({ success: true, attachments });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient, handleApiError } from '@/lib/auth';
import { checkEmailRateLimit } from '@/lib/submitRateLimit';
import { idempotency } from '@/lib/idempotency';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { isPortalLinkExpired } from '@/lib/portalExpiry';
import { loadMutedRecipients, isRecipientMuted } from '@/lib/notificationMutes';
import { emailShell, heading, paragraph, callout, bulletList, button } from '@/lib/email/layout';
import { getAppUrl } from '@/lib/email/appUrl';
import { fileBytesMatchType } from '@/lib/fileMagic';

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
    const baseUrl = getAppUrl(req);

    // Validate the access token — reject if the owner already soft-deleted
    // the event (matches the respond route).
    const { data: event, error: evErr } = await supabaseAdmin
      .from('aft_maintenance_events')
      .select('*')
      .eq('access_token', accessToken)
      .is('deleted_at', null)
      .maybeSingle();

    if (evErr || !event) {
      return NextResponse.json({ error: 'Service event not found.' }, { status: 404 });
    }

    // Token expiry: reject uploads on events completed more than PORTAL_EXPIRY_DAYS ago.
    if (isPortalLinkExpired(event)) {
      return NextResponse.json({ error: 'This service portal link has expired.' }, { status: 403 });
    }

    if (event.status === 'complete' || event.status === 'cancelled') {
      return NextResponse.json({ error: 'Cannot upload to a completed or cancelled event.' }, { status: 400 });
    }

    // Idempotency — same X-Idempotency-Key replays cached
    // {success:true, attachments:[...]} without re-uploading the
    // bytes / re-inserting the message row / re-emailing the owner.
    // Skipped on legacy events with no created_by; the FK to
    // auth.users is NOT NULL on the cache row.
    const idem = event.created_by
      ? idempotency(supabaseAdmin, event.created_by, req, 'mx-events/upload-attachment')
      : null;
    if (idem) {
      const cached = await idem.check();
      if (cached) return cached;
    }

    // Per-event attachment cap. A leaked mechanic token could
    // otherwise be used to upload 5 × 10MB files unbounded times,
    // filling storage. Real service events rarely accumulate more
    // than 30 files; the cap is well above that and prevents
    // runaway accumulation. The 5-files-per-call limit + 10MB-per-
    // file limit upstream means the worst case here is 50 × 10MB =
    // 500MB per event (still bounded, no longer unbounded).
    //
    // Pre-fix this counted MESSAGES with attachments, not FILES —
    // each message can carry up to 5 files, so the cap was 5×
    // looser than the comment claimed. Sum the actual array
    // lengths instead.
    const MAX_ATTACHMENTS_PER_EVENT = 50;
    const { data: existingMessageAttachments } = await supabaseAdmin
      .from('aft_event_messages')
      .select('attachments')
      .eq('event_id', event.id)
      .not('attachments', 'is', null);
    const existingFileCount = (existingMessageAttachments || []).reduce(
      (sum: number, m: any) => sum + (Array.isArray(m.attachments) ? m.attachments.length : 0),
      0,
    );
    if (existingFileCount + files.length > MAX_ATTACHMENTS_PER_EVENT) {
      return NextResponse.json(
        { error: `This event already has ${existingFileCount} files attached. Cap is ${MAX_ATTACHMENTS_PER_EVENT} per event — ask the owner to close it and create a follow-up.` },
        { status: 413 },
      );
    }

    // Process and upload each file
    const attachments: { url: string; filename: string; size: number; type: string }[] = [];
    // Track storage paths landed in this request so we can roll them
    // back on a mid-loop failure. Pre-fix, file 1 succeeded, file 2's
    // type-check failed, and file 1 stayed in the bucket forever with
    // no message row referencing it — silent storage leak.
    const uploadedPaths: string[] = [];
    const cleanupOnFailure = async () => {
      if (uploadedPaths.length === 0) return;
      try {
        await supabaseAdmin.storage.from('aft_event_attachments').remove(uploadedPaths);
      } catch (e) {
        console.error('[upload-attachment] cleanup failed:', e);
      }
    };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Validate size
      if (file.size > MAX_FILE_SIZE) {
        await cleanupOnFailure();
        return NextResponse.json(
          { error: `File "${file.name}" exceeds the 10MB limit.` },
          { status: 400 }
        );
      }

      // Validate type
      if (!ALLOWED_TYPES.includes(file.type)) {
        await cleanupOnFailure();
        return NextResponse.json(
          { error: `File type "${file.type}" is not supported. Accepted: images, PDF, Word documents.` },
          { status: 400 }
        );
      }

      // Generate a unique filename: eventId_timestamp_index_originalName.
      // Index breaks ms-collisions when the same client uploads two
      // files with the same name in a single multipart request — without
      // it, file 2's `upload({ upsert: false })` would 409 on the same
      // storage key.
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileName = `${event.id}_${Date.now()}_${i}_${safeName}`;

      const buffer = Buffer.from(await file.arrayBuffer());

      // Verify the bytes actually match the claimed MIME type. Client-reported
      // types are easy to spoof (e.g. an .exe renamed with a fake PDF header),
      // so a magic-byte check is the real gate.
      if (!fileBytesMatchType(buffer.subarray(0, 16), file.type, file.name)) {
        await cleanupOnFailure();
        return NextResponse.json(
          { error: `File "${file.name}" doesn't match its declared type. Re-upload a valid ${file.type} file.` },
          { status: 400 }
        );
      }

      const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
        .from('aft_event_attachments')
        .upload(fileName, buffer, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadErr) {
        console.error('Upload error:', uploadErr);
        await cleanupOnFailure();
        return NextResponse.json(
          { error: `Failed to upload "${file.name}".` },
          { status: 500 }
        );
      }

      uploadedPaths.push(uploadData.path);

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

    // Throw on insert failure: storage already has the bytes and the
    // owner email is about to go out — without the message row the
    // owner opens the event and sees nothing referencing the files.
    const { error: msgInsertErr } = await supabaseAdmin.from('aft_event_messages').insert({
      event_id: event.id,
      sender: 'mechanic',
      message_type: 'comment',
      message: messageText,
      attachments: attachments,
    } as any);
    if (msgInsertErr) throw msgInsertErr;

    // Notify the owner — rate-limited against the owner's email budget
    // so a leaked mechanic token can't be replayed to flood the owner.
    // Token-gated routes have no auth user_id; we charge the owner
    // (event.created_by) since the email goes to them anyway and a
    // legitimate mechanic uploads ≤ a few times per event.
    //
    // service_update mute: skip the email if the primary contact has
    // opted out. The files + message row are already saved, so the
    // owner sees the upload next time they open the event in-app.
    const serviceUpdateMuted = await loadMutedRecipients(
      supabaseAdmin,
      [event.primary_contact_email],
      'service_update',
    );
    const ownerMuted = isRecipientMuted(event.primary_contact_email, serviceUpdateMuted);
    if (event.primary_contact_email && event.created_by && !ownerMuted) {
      const rl = await checkEmailRateLimit(supabaseAdmin, event.created_by);
      if (!rl.allowed) {
        // Files already saved + message row already inserted, so the
        // mechanic upload itself is preserved. We just skip the email
        // to protect the owner's quota; the owner will see the message
        // next time they open the event.
        const skippedBody = {
          success: true,
          attachments,
          email_skipped: 'Owner has reached today\'s email-notification limit. Files are saved.',
        };
        if (idem) await idem.save(200, skippedBody);
        return NextResponse.json(skippedBody);
      }
      const appUrl = baseUrl;
      const safeMxName = escapeHtml(event.mx_contact_name || 'Your mechanic');
      const safeDescription = escapeHtml(description);

      const fileLines = attachments.map(a => {
        const isImage = a.type.startsWith('image/');
        const safeFilename = escapeHtml(a.filename);
        return `${isImage ? '📷' : '📎'} ${safeFilename}`;
      });

      await resend.emails.send({
        from: `Skyward Operations <${FROM_EMAIL}>`,
        to: [event.primary_contact_email],
        subject: `${safeMxName} uploaded files to your work package`,
        html: emailShell({
          title: `Files Uploaded`,
          preheader: `${safeMxName} uploaded ${attachments.length} file${attachments.length > 1 ? 's' : ''} to your service event.`,
          body: `
            ${heading('Files Uploaded', 'note')}
            ${paragraph(`${safeMxName} has uploaded ${attachments.length} file${attachments.length > 1 ? 's' : ''} to your service event:`)}
            ${safeDescription ? callout(safeDescription, { variant: 'note' }) : ''}
            ${bulletList(fileLines)}
            ${button(appUrl, 'Open Skyward')}
          `,
          preferencesUrl: `${appUrl}#settings`,
        }),
      });
    }

    const responseBody = { success: true, attachments };
    if (idem) await idem.save(200, responseBody);
    return NextResponse.json(responseBody);
  } catch (error) {
    return handleApiError(error, req);
  }
}

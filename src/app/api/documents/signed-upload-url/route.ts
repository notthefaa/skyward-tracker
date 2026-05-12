import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';

// 30 MB cap — typical POH/AFM is 10–20 MB; PT6 supplements occasionally
// reach 25 MB. Above 30 MB the client should split the doc anyway so
// chunks remain searchable.
const MAX_FILE_SIZE = 30 * 1024 * 1024;

/**
 * Step 1 of the direct-upload flow.
 *
 * The Vercel serverless platform caps inbound request bodies at ~4.5 MB
 * (underlying AWS Lambda sync invocation limit). Routine aircraft
 * docs are 10–20 MB, so they can't be streamed through this function.
 *
 * Instead the client:
 *   1. POSTs metadata here → server returns a Supabase Storage signed
 *      upload URL + token + path.
 *   2. PUTs the PDF bytes directly to Supabase Storage with that URL.
 *      Bytes never touch Vercel.
 *   3. POSTs `{ storagePath, ... }` to /api/documents to register the
 *      row, kick off pdf-parse + OpenAI embeddings, and flip status
 *      from 'processing' to 'ready'.
 *
 * Auth: the caller must have aircraft access. The storage path is
 * `${aircraftId}_${timestamp}_${safeName}` — the prefix lets the
 * register step (in /api/documents POST) verify the path matches the
 * aircraft the user claims to be uploading for.
 */
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, filename, size } = await req.json();

    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    if (!filename || typeof filename !== 'string') return NextResponse.json({ error: 'Filename required.' }, { status: 400 });
    if (typeof size !== 'number' || size <= 0) return NextResponse.json({ error: 'Valid file size required.' }, { status: 400 });
    if (size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB).` },
        { status: 400 },
      );
    }

    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    // Sanitize the filename portion of the storage path. The original
    // filename is sent separately in step 3 (register) so the doc row
    // can carry the user's original name even when the storage object
    // uses a scrubbed version.
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${aircraftId}_${Date.now()}_${safeName}`;

    const { data, error } = await supabaseAdmin.storage
      .from('aft_aircraft_documents')
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      throw error || new Error('Failed to create signed upload URL.');
    }

    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      storagePath,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}

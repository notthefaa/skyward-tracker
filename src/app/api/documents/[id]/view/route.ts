import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

/**
 * Authed signed-URL redirect for a single document.
 *
 * Howard's search_documents results include a `file_url` of
 * `/api/documents/<id>/view?page=N` — a STABLE, never-expiring link
 * Claude can render in markdown. When the user clicks it:
 *   1. Cookie auth (same-origin, browser carries it automatically).
 *   2. Access check: requireAircraftAccess on the doc's aircraft.
 *   3. Fresh signed URL from Supabase Storage (1 h TTL).
 *   4. 302 redirect to the signed URL, with `#page=N` appended if
 *      `?page=N` was on the request. Chromium / PDF.js / Safari all
 *      honor the `#page=N` fragment and open the PDF at that page.
 *
 * Why this exists: storing the raw signed URL in chat is fragile
 * (60 min TTL → dead link by tomorrow). The bucket is private, so
 * the `aft_documents.file_url` (a `getPublicUrl()` value) 400s on
 * direct fetch. This redirect route is the durable middle layer.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Document ID required.' }, { status: 400 });
    }

    const { data: doc, error: docErr } = await supabaseAdmin
      .from('aft_documents')
      .select('aircraft_id, file_url, filename, status')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (docErr) throw docErr;
    if (!doc) {
      return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
    }

    await requireAircraftAccess(supabaseAdmin, user.id, (doc as { aircraft_id: string }).aircraft_id);

    // Refuse rendering for error/processing rows — their storage
    // objects may be gone (failDocument removed them) or partially
    // written. Surface a clear message instead of a confusing 404.
    const status = (doc as { status: string }).status;
    if (status === 'error') {
      return NextResponse.json({ error: 'This document failed to index — re-upload it.' }, { status: 410 });
    }
    if (status === 'processing') {
      return NextResponse.json({ error: 'This document is still being indexed — try again shortly.' }, { status: 409 });
    }

    const fileUrl = (doc as { file_url: string }).file_url;
    const m = fileUrl?.match(/\/aft_aircraft_documents\/(.+)$/);
    if (!m) {
      return NextResponse.json({ error: 'Document has no resolvable storage path.' }, { status: 500 });
    }
    const storagePath = m[1];

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('aft_aircraft_documents')
      .createSignedUrl(storagePath, 60 * 60); // 1 h — Chromium caches the redirect target so this needs headroom for read time
    if (signErr || !signed?.signedUrl) {
      console.error('[documents/view] sign failed', signErr);
      return NextResponse.json({ error: 'Could not generate a signed URL for this document.' }, { status: 500 });
    }

    const reqUrl = new URL(req.url);
    const page = reqUrl.searchParams.get('page');
    // Append #page=N if the caller asked for a specific page. Chromium /
    // Safari / Firefox built-in PDF viewers all honor this. Strip any
    // pre-existing fragment from the signed URL first so we don't end
    // up with double-hashes.
    const baseSigned = signed.signedUrl.split('#')[0];
    const target = page && /^\d+$/.test(page)
      ? `${baseSigned}#page=${page}`
      : signed.signedUrl;

    return NextResponse.redirect(target, 302);
  } catch (error) {
    return handleApiError(error, req);
  }
}

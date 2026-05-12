import { NextResponse, after } from 'next/server';
import { createHash } from 'crypto';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { idempotency } from '@/lib/idempotency';
import { ocrPdfWithClaude } from '@/lib/documents/ocr';
import OpenAI from 'openai';

// 5-minute ceiling — even though parse + embed now runs in `after()`
// after the response is sent, Vercel keeps the function alive only
// until maxDuration. A 20 MB POH with 1000+ chunks needs that whole
// budget for OpenAI embeddings.
export const maxDuration = 300;

// Window after which a non-'ready' row of the same SHA is considered
// stale and reclaimed. MUST exceed `maxDuration` (300 s) plus a margin
// so a still-running `after()` from a previous upload can't be torn
// out from under itself. A bare 30 s window would clobber legitimate
// large-PDF processing.
const RECLAIM_PROCESSING_AGE_MS = 360_000; // 6 min

// OpenAI is imported at module top (cheap — no env reads happen here)
// but the client itself is instantiated lazily inside the function
// that uses it. Module-level `new OpenAI()` was crashing the route on
// Vercel's runtime (worked in local prod build via `next start`).
// pdf-parse is dynamic-imported inside the after() callback for the
// same reason.

const CHUNK_SIZE = 1500; // chars (~375 tokens)
const CHUNK_OVERLAP = 200;
// 30 MB ceiling — matches /api/documents/signed-upload-url. Routine
// POH/AFM are 10–20 MB; PT6 supplements occasionally hit 25 MB.
const MAX_FILE_SIZE = 30 * 1024 * 1024;

type TaggedChunk = { content: string; page_number: number | null };

function chunkText(text: string): TaggedChunk[] {
  return chunkTextPages([{ page: null, text }]);
}

/**
 * Chunk per-page so each chunk knows which PDF page it came from.
 * Pages are chunked independently — a chunk never spans a page
 * boundary, which keeps citations accurate. Short pages (< 50 chars)
 * are skipped (headers, blank pages, etc.).
 */
function chunkTextPages(pages: Array<{ page: number | null; text: string }>): TaggedChunk[] {
  const chunks: TaggedChunk[] = [];
  for (const { page, text } of pages) {
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + CHUNK_SIZE, text.length);
      const slice = text.slice(start, end);
      if (slice.trim().length > 50) {
        chunks.push({ content: slice, page_number: page });
      }
      start += CHUNK_SIZE - CHUNK_OVERLAP;
      if (start >= text.length) break;
    }
  }
  return chunks;
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  // Static import at module top; instantiate inside the function so
  // module load doesn't depend on OPENAI_API_KEY at Vercel cold-start.
  // Matches the working pattern in src/lib/howard/toolHandlers.ts.
  const openai = new OpenAI();
  const batchSize = 100;
  const allEmbeddings: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
    });
    for (const item of response.data) {
      allEmbeddings.push(item.embedding);
    }
  }
  return allEmbeddings;
}

/**
 * Runs after the POST response has been sent. Parses the PDF, embeds
 * the chunks, flips the document row to 'ready' (or 'error' on
 * failure). The route's response already returned `status='processing'`
 * to the client, which polls via /api/documents and surfaces a toast
 * on the transition.
 *
 * Wrapped in a top-level try/catch so an unhandled throw inside
 * `after()` can't leave a doc row stuck at 'processing' forever.
 */
async function indexDocumentInBackground(
  supabaseAdmin: ReturnType<typeof import('@/lib/auth').createAdminClient>,
  userId: string,
  doc: { id: string; aircraft_id: string },
  storagePath: string,
): Promise<void> {
  const failDocument = async (reason: string, userFacingReason?: string) => {
    console.error(`[documents] background index failed for doc=${doc.id}: ${reason}`);
    // Status flip is the critical step — without it the row stays at
    // 'processing' and the watcher polls indefinitely. Retry up to 3×
    // with backoff. If it still fails the hourly sweep-stuck-processing
    // cron is the final safety net.
    // `last_error_reason` is the user-facing string that surfaces in
    // the toast + the docs list row. The internal `reason` stays in
    // the function logs (greppable by requestId).
    const persistedReason = userFacingReason || reason;
    // Fail-soft on the column: if migration 065 hasn't been applied
    // yet, the UPDATE returns 42703 (undefined_column) / PGRST204
    // (schema cache missing column). Retry without the column so the
    // status flip — the critical part — still happens. Pattern mirrors
    // the idempotency.ts PGRST205 fail-soft.
    let flipped = false;
    let includeReason = true;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const payload = includeReason
          ? { status: 'error', last_error_reason: persistedReason }
          : { status: 'error' };
        const { error } = await supabaseAdmin
          .from('aft_documents')
          .update(payload)
          .eq('id', doc.id);
        if (!error) { flipped = true; break; }
        const code = (error as { code?: string }).code;
        if (includeReason && (code === '42703' || code === 'PGRST204')) {
          console.warn('[documents] last_error_reason column missing — apply migration 065. Retrying status flip without it.');
          includeReason = false;
          continue;
        }
        console.error(`[documents] status flip attempt ${attempt + 1} failed:`, error.message);
      } catch (e) {
        console.error(`[documents] status flip attempt ${attempt + 1} threw:`, e);
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
    if (!flipped) {
      console.error(`[documents] CRITICAL: status flip permanently failed for doc=${doc.id} — sweep-stuck-processing will catch it.`);
    }
    try {
      await supabaseAdmin.storage.from('aft_aircraft_documents').remove([storagePath]);
    } catch (e) {
      console.error('[documents] failed to remove orphan storage object:', e);
    }
    // Chunks too — a partial-insert failure path leaves them behind.
    try {
      await supabaseAdmin.from('aft_document_chunks').delete().eq('document_id', doc.id);
    } catch (e) {
      console.error('[documents] failed to clear partial chunks:', e);
    }
  };

  // Re-stamp the audit user. `setAppUser` writes a Postgres session
  // variable and the after() continuation may run on a different
  // connection than the request handler, so the variable doesn't
  // automatically carry over. If it fails, audit triggers on the
  // status-flip UPDATEs below would attribute changes to NULL —
  // fail-closed instead, so the audit trail stays clean.
  try {
    await setAppUser(supabaseAdmin, userId);
  } catch (e) {
    console.error('[documents] setAppUser failed in after():', e);
    return await failDocument('audit user re-stamp failed', 'Server error before indexing started. Try uploading again.');
  }

  // Re-download bytes inside the background fn instead of capturing
  // the outer buffer in the after() closure. The outer 30 MB pin
  // would otherwise stay in memory for up to maxDuration=300 s per
  // in-flight upload — multiply by concurrent uploads and it becomes
  // a real memory-pressure vector on the function.
  let buffer: Buffer;
  try {
    const { data: blob, error: dlError } = await supabaseAdmin.storage
      .from('aft_aircraft_documents')
      .download(storagePath);
    if (dlError || !blob) {
      return await failDocument(`background re-download failed: ${dlError?.message || 'no blob'}`, "Couldn't re-read the uploaded file. Try uploading again.");
    }
    buffer = Buffer.from(await blob.arrayBuffer());
  } catch (err: any) {
    return await failDocument(`background re-download threw: ${err?.message || err}`, "Couldn't re-read the uploaded file. Try uploading again.");
  }

  try {
    let pageCount = 0;
    let taggedChunks: TaggedChunk[] = [];

    // PDF parse-bomb guard. Was 25 s on the old synchronous shape;
    // bumped to 60 s now that the embed call sits behind it inside
    // the same function budget (maxDuration=300 s).
    const PARSE_DEADLINE_MS = 60_000;
    const parseDeadline = Date.now() + PARSE_DEADLINE_MS;
    const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('pdf_timeout')), ms)),
      ]);

    try {
      // Dynamic import — pdf-parse is heavy and was potentially
      // contributing to Vercel runtime init failures when imported at
      // module top. Loaded inside the after() callback now, well after
      // the response has been sent.
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const fullResult = await withTimeout(parser.getText(), PARSE_DEADLINE_MS);
      pageCount = fullResult.total || 0;

      if (pageCount > 0) {
        const pages: Array<{ page: number; text: string }> = [];
        for (let p = 1; p <= pageCount; p++) {
          if (Date.now() > parseDeadline) break;
          try {
            const remaining = Math.max(1_000, parseDeadline - Date.now());
            const pageResult = await withTimeout(parser.getText({ partial: [p] }), remaining);
            if (pageResult.text?.trim()) {
              pages.push({ page: p, text: pageResult.text });
            }
          } catch {
            // Page-level parse failed — skip silently, the fallback
            // full-text path below will still produce chunks.
          }
        }
        if (pages.length > 0) {
          taggedChunks = chunkTextPages(pages);
        }
      }

      if (taggedChunks.length === 0 && fullResult.text?.trim()) {
        taggedChunks = chunkText(fullResult.text);
      }

      await parser.destroy();
    } catch (err: any) {
      if (err?.message === 'pdf_timeout') {
        return await failDocument('PDF took too long to parse.', 'PDF parsing took too long. Try a smaller or simpler PDF.');
      }
      // pdf-parse can throw on scanned/password/malformed PDFs.
      // Don't fail yet — fall through to the OCR fallback below.
      console.warn('[documents] pdf-parse threw, will try OCR fallback:', err?.message || err);
    }

    // OCR fallback for scanned PDFs (the common case for older
    // aviation manuals — POH, AFM, PIM for piston singles often only
    // exist as scans). Claude Haiku Vision reads the PDF directly
    // and returns per-page text we can chunk and embed.
    // Triggered when text extraction yielded nothing OR the per-page
    // pass returned text from < 30% of pages (mixed scan/text PDFs
    // would otherwise lose the scanned pages silently).
    const textCoverage = pageCount > 0 ? taggedChunks.length / pageCount : 0;
    const shouldOcr = taggedChunks.length === 0 || (pageCount > 0 && textCoverage < 0.3);
    if (shouldOcr) {
      console.log(`[documents] OCR fallback: pageCount=${pageCount}, chunks=${taggedChunks.length}, coverage=${textCoverage.toFixed(2)}`);
      try {
        const ocrPages = await ocrPdfWithClaude(buffer, { knownPageCount: pageCount || undefined });
        if (ocrPages.length === 0) {
          return await failDocument('OCR returned no pages.', 'Could not extract any readable text from this PDF. The scan quality may be too low.');
        }
        // Replace whatever pdf-parse gave us with the OCR output —
        // for a partial-scan PDF, OCR'd pages also contain the
        // pdf-parse-readable text, so this avoids duplicate chunks.
        taggedChunks = chunkTextPages(ocrPages);
        // Use OCR's page count when pdf-parse didn't give us one
        // (some scans report pageCount=0 despite having pages).
        if (pageCount === 0) {
          pageCount = Math.max(...ocrPages.map(p => p.page));
        }
        console.log(`[documents] OCR success: ${ocrPages.length} pages, ${taggedChunks.length} chunks`);
      } catch (err: any) {
        console.error('[documents] OCR fallback threw:', err);
        // If we have SOMETHING from pdf-parse, keep it rather than
        // discarding partial progress.
        if (taggedChunks.length === 0) {
          const msg = err?.message || String(err);
          const userFacing = msg.includes('rate') || msg.includes('quota') || err?.status === 429
            ? 'OCR service is busy or rate-limited. Try uploading again in a few minutes.'
            : "Couldn't read the PDF — text extraction and OCR both failed. The scan quality may be too low or the file is corrupt.";
          return await failDocument(`OCR fallback failed: ${msg}`, userFacing);
        }
      }
    }

    if (taggedChunks.length === 0) {
      return await failDocument('No readable text found in PDF.', 'No readable text found — looks like a scan or image-only PDF. Try a different file.');
    }

    try {
      const embeddings = await generateEmbeddings(taggedChunks.map(c => c.content));
      const chunkRows = taggedChunks.map((chunk, i) => ({
        document_id: doc.id,
        chunk_index: i,
        content: chunk.content,
        page_number: chunk.page_number,
        embedding: JSON.stringify(embeddings[i]),
      }));
      for (let i = 0; i < chunkRows.length; i += 50) {
        const batch = chunkRows.slice(i, i + 50);
        const { error: chunkError } = await supabaseAdmin
          .from('aft_document_chunks')
          .insert(batch);
        if (chunkError) throw chunkError;
      }
    } catch (err: any) {
      // Distinguish OpenAI failures from chunk-insert DB failures —
      // they need different user actions. Network/quota errors are
      // usually transient; DB errors should escalate.
      const msg = err?.message || String(err);
      const isOpenAI = msg.includes('OpenAI') || msg.includes('rate limit') || msg.includes('quota') || err?.status === 429 || err?.status === 503;
      const userFacing = isOpenAI
        ? "Indexing service is busy or rate-limited. Try uploading again in a few minutes."
        : "Couldn't save the document's index. Try uploading again.";
      return await failDocument(`embed/chunk insert failed: ${msg}`, userFacing);
    }

    const { error: readyErr } = await supabaseAdmin
      .from('aft_documents')
      .update({ status: 'ready', page_count: pageCount })
      .eq('id', doc.id);
    if (readyErr) {
      return await failDocument(`status flip to ready failed: ${readyErr.message}`, "Indexing finished but the final save failed. Try uploading again.");
    }

    console.log(`[documents] background index complete doc=${doc.id} chunks=${taggedChunks.length} pages=${pageCount}`);
  } catch (err: any) {
    console.error('[documents] background index unexpected error:', err);
    await failDocument(`unhandled: ${err?.message || err}`, "Something unexpected happened during indexing. Try uploading again.");
  }
}

// GET — list documents for aircraft
export async function GET(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const aircraftId = searchParams.get('aircraftId');
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    const { data: docs } = await supabaseAdmin
      .from('aft_documents')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    return NextResponse.json({ documents: docs || [] });
  } catch (error) { return handleApiError(error); }
}

// POST — register a PDF document that's already in Supabase Storage.
// The client uploads bytes directly to storage via a signed URL from
// /api/documents/signed-upload-url, then calls here with the storage
// path to kick off parse + embed. Bytes never flow through Vercel —
// this route only downloads them server-to-server from storage, which
// is not subject to the 4.5 MB inbound body limit.
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const body = await req.json().catch(() => null);
    const aircraftId = body?.aircraftId as string | undefined;
    const docType = body?.docType as string | undefined;
    const storagePath = body?.storagePath as string | undefined;
    const filename = body?.filename as string | undefined;

    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    if (!docType) return NextResponse.json({ error: 'Document type required.' }, { status: 400 });
    if (!storagePath) return NextResponse.json({ error: 'Storage path required.' }, { status: 400 });
    if (!filename) return NextResponse.json({ error: 'Filename required.' }, { status: 400 });

    // Path ownership: the signed-upload-url route prefixes every path
    // with `${aircraftId}_`. Re-checking it here means a user with
    // access to A can't register an upload made against B's path by
    // swapping IDs in this call.
    if (!storagePath.startsWith(`${aircraftId}_`)) {
      return NextResponse.json({ error: 'Storage path does not match aircraft.' }, { status: 400 });
    }

    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);
    await setAppUser(supabaseAdmin, user.id);

    // Idempotency — same X-Idempotency-Key replays the cached
    // {document, chunks} body without re-running pdf-parse or
    // re-charging OpenAI for embeddings. An iOS-suspended retry of
    // step 3 would otherwise double-embed even though step 2 (the
    // storage upload) is idempotent. The SHA-256 dup-check below
    // handles "same file content, different submission"; this
    // handles "same submission, retried."
    const idem = idempotency(supabaseAdmin, user.id, req, 'documents/POST');
    const cached = await idem.check();
    if (cached) return cached;

    // Pull the freshly-uploaded bytes server-to-server. This is the
    // step that bypasses Vercel's inbound body cap — egress from
    // storage to the function is unbounded by that limit.
    const { data: blob, error: dlError } = await supabaseAdmin.storage
      .from('aft_aircraft_documents')
      .download(storagePath);
    if (dlError || !blob) {
      return NextResponse.json(
        { error: 'Uploaded file not found in storage. Try uploading again.' },
        { status: 404 },
      );
    }
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_FILE_SIZE) {
      // Defense in depth — the signed-upload route already enforces
      // this client-side, but a manual signed-URL hit could land
      // larger bytes. Reject and clean up.
      try { await supabaseAdmin.storage.from('aft_aircraft_documents').remove([storagePath]); } catch {}
      return NextResponse.json(
        { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB).` },
        { status: 400 },
      );
    }

    // Magic-byte check — `%PDF` (0x25 0x50 0x44 0x46). Confirms the
    // bytes actually start like a PDF before we hand them to pdf-parse.
    if (buffer.length < 4 || !buffer.subarray(0, 4).equals(Buffer.from([0x25, 0x50, 0x44, 0x46]))) {
      try { await supabaseAdmin.storage.from('aft_aircraft_documents').remove([storagePath]); } catch {}
      return NextResponse.json({ error: 'File does not appear to be a valid PDF.' }, { status: 400 });
    }

    // SHA-256 tamper-evidence hash — computed from the bytes we just
    // pulled from storage so it reflects what's actually there.
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    // Reject / reclaim a same-SHA row.
    // Throw on read error so a transient DB failure isn't treated as
    // "no duplicate found" (which would let us land a second copy).
    const { data: dup, error: dupErr } = await supabaseAdmin
      .from('aft_documents')
      .select('id, filename, file_url, status, created_at')
      .eq('aircraft_id', aircraftId)
      .eq('sha256', sha256)
      .is('deleted_at', null)
      .maybeSingle();
    if (dupErr) throw dupErr;
    if (dup) {
      // 'ready' → real duplicate, block the upload and tell the user.
      if (dup.status === 'ready') {
        try { await supabaseAdmin.storage.from('aft_aircraft_documents').remove([storagePath]); } catch {}
        return NextResponse.json(
          { error: `This exact file is already uploaded as "${dup.filename}".` },
          { status: 409 }
        );
      }
      // 'processing' < RECLAIM_PROCESSING_AGE_MS → genuine concurrent
      // upload in flight; let it finish. (Threshold must exceed
      // maxDuration=300 s so we never tear out a still-running `after()`
      // from under itself — a 30 s threshold previously did exactly
      // that for legitimately-large PDFs.)
      if (dup.status === 'processing') {
        const ageMs = Date.now() - Date.parse(dup.created_at);
        if (ageMs < RECLAIM_PROCESSING_AGE_MS) {
          try { await supabaseAdmin.storage.from('aft_aircraft_documents').remove([storagePath]); } catch {}
          return NextResponse.json(
            { error: 'A previous upload of this file is still being indexed. Wait a minute and try again.' },
            { status: 409 }
          );
        }
      }
      // Reclaim: 'error' (any age — failed attempts unblock re-upload
      // immediately) OR 'processing' older than RECLAIM_PROCESSING_AGE_MS
      // (Vercel almost certainly killed the after() — the
      // sweep-stuck-processing cron will catch these if we don't).
      console.log(`[documents] reclaiming row ${dup.id} (status=${dup.status}, age=${Math.round((Date.now() - Date.parse(dup.created_at)) / 1000)}s)`);
      // Remove the OLD storagePath too — without this, every reclaim
      // leaves an orphaned PDF in the bucket that the daily orphan
      // sweep has to mop up >24 h later.
      const oldPath = dup.file_url?.match(/\/aft_aircraft_documents\/(.+)$/)?.[1];
      if (oldPath && oldPath !== storagePath) {
        try { await supabaseAdmin.storage.from('aft_aircraft_documents').remove([oldPath]); } catch (e) {
          console.error('[documents] failed to remove reclaimed storage object:', e);
        }
      }
      await supabaseAdmin.from('aft_document_chunks').delete().eq('document_id', dup.id);
      await supabaseAdmin.from('aft_documents').delete().eq('id', dup.id);
    }

    const uploadData = { path: storagePath };
    const { data: urlData } = supabaseAdmin.storage
      .from('aft_aircraft_documents')
      .getPublicUrl(uploadData.path);

    // Create document record (status: processing). The maybeSingle()
    // pre-check above is a defense-in-depth race: a concurrent upload
    // of the same bytes could pass the SELECT before either row
    // commits. Migration 056 makes (aircraft_id, sha256) WHERE
    // deleted_at IS NULL a UNIQUE partial index — handle the 23505
    // here so the late submitter sees a friendly 409 instead of 500.
    const { data: doc, error: docError } = await supabaseAdmin
      .from('aft_documents')
      .insert({
        aircraft_id: aircraftId,
        user_id: user.id,
        filename,
        file_url: urlData.publicUrl,
        doc_type: docType,
        status: 'processing',
        sha256,
        file_size: buffer.length,
      })
      .select()
      .single();
    if (docError) {
      // 23505 = unique-violation; the partial index for live rows
      // means the racing upload landed first.
      if ((docError as any).code === '23505') {
        // Best-effort cleanup of the freshly-uploaded storage object —
        // we can't surface the existing filename here without a second
        // SELECT, but the 409 message gives the user a clear retry
        // path.
        try {
          await supabaseAdmin.storage.from('aft_aircraft_documents').remove([uploadData.path]);
        } catch (e) {
          console.error('[documents] cleanup after 23505 failed:', e);
        }
        return NextResponse.json(
          { error: 'Another upload of this exact file just landed. Refresh the documents list.' },
          { status: 409 },
        );
      }
      throw docError;
    }

    // Hand the response back to the client immediately. The heavy
    // parse + embed + chunk-insert work continues inside `after()` so
    // a 20 MB POH with 1000+ chunks doesn't have to hold an HTTP
    // connection open for 2-3 minutes (which on mobile means iOS
    // suspends the request and the upload appears to hang forever).
    // The client polls for status via /api/documents and surfaces a
    // toast when this background work flips the row to 'ready'.
    const immediateBody = {
      success: true,
      document: doc,
      status: 'processing' as const,
      chunks: 0,
    };

    // Schedule the background work FIRST. If we did `idem.save()` first
    // and it threw (transient supabase blip), the catch below would
    // leave the row at 'processing' with no after() scheduled — the
    // watcher would poll forever. With after() first, the row always
    // has a worker assigned to flip it to ready/error.
    after(async () => {
      // Note: NOT capturing `buffer` here — the background function
      // re-downloads from storage so the outer buffer can be GC'd as
      // soon as the response is sent. See indexDocumentInBackground.
      await indexDocumentInBackground(supabaseAdmin, user.id, { id: doc.id, aircraft_id: aircraftId }, storagePath);
    });

    // Idempotency cache save is best-effort — a failure here just
    // means a retried request will go through the same path and a
    // second `after()` would be scheduled. The SHA-256 dup-check would
    // then reclaim the just-inserted row OR (if the after() is still
    // mid-flight) 409 with "still in progress". Either way the user
    // sees a sensible message.
    try { await idem.save(200, immediateBody); } catch (e) {
      console.error('[documents] idempotency save failed (non-fatal):', e);
    }

    return NextResponse.json(immediateBody);
  } catch (error) { return handleApiError(error, req); }
}

// DELETE — soft-delete document (admin only). Chunks are hard-deleted so
// RAG search doesn't hit removed content; the parent document row stays
// for retention/history.
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { documentId, aircraftId } = await req.json();
    if (!documentId || !aircraftId) return NextResponse.json({ error: 'Document ID and Aircraft ID required.' }, { status: 400 });
    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    // Verify the document actually belongs to this aircraft — without
    // this, an admin on Aircraft A could delete B's docs by sending
    // A's id + B's documentId. Matches the VOR/Tire/Oil DELETE pattern.
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('aft_documents')
      .select('aircraft_id, deleted_at')
      .eq('id', documentId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing || existing.aircraft_id !== aircraftId || existing.deleted_at) {
      return NextResponse.json({ error: 'Document not found for this aircraft.' }, { status: 404 });
    }

    await setAppUser(supabaseAdmin, user.id);
    // Both writes throw on failure — without this, the route returns
    // success while chunks remain (Howard's RAG keeps citing the
    // deleted doc) or the parent row never gets soft-deleted.
    const { error: chunkDelErr } = await supabaseAdmin.from('aft_document_chunks').delete().eq('document_id', documentId);
    if (chunkDelErr) throw chunkDelErr;
    const { error: docDelErr } = await supabaseAdmin
      .from('aft_documents')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', documentId)
      .eq('aircraft_id', aircraftId);
    if (docDelErr) throw docDelErr;
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

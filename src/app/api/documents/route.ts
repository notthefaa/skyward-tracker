import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { idempotency } from '@/lib/idempotency';
import { PDFParse } from 'pdf-parse';
import OpenAI from 'openai';

const openai = new OpenAI();

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

    // Reject duplicate uploads (same aircraft, same bytes). Throw on
    // read error so a transient failure isn't treated as "no
    // duplicate found" and cause us to land a second copy of the
    // identical PDF (and pay for embedding it again).
    const { data: dup, error: dupErr } = await supabaseAdmin
      .from('aft_documents')
      .select('id, filename')
      .eq('aircraft_id', aircraftId)
      .eq('sha256', sha256)
      .is('deleted_at', null)
      .maybeSingle();
    if (dupErr) throw dupErr;
    if (dup) {
      // Clean up the orphaned storage upload so the bucket doesn't
      // collect duplicate copies.
      try { await supabaseAdmin.storage.from('aft_aircraft_documents').remove([storagePath]); } catch {}
      return NextResponse.json(
        { error: `This exact file is already uploaded as "${dup.filename}".` },
        { status: 409 }
      );
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

    // Extract text from PDF — parse per-page so chunks carry their
    // source page number, enabling Howard to cite "POH page 47".
    let pageCount = 0;
    let taggedChunks: TaggedChunk[] = [];

    // Parse-bomb guard: an adversarial PDF (deeply nested compression,
    // circular references, password-protected structures) can make
    // pdf-parse hang indefinitely, eating the whole serverless budget.
    // 25s ceiling for the full parse + per-page loop keeps us inside
    // Vercel's 30s pro-tier default with margin for the embeddings call.
    const PARSE_DEADLINE_MS = 25_000;
    const parseDeadline = Date.now() + PARSE_DEADLINE_MS;
    const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('pdf_timeout')), ms)),
      ]);

    // Roll back a doc that failed somewhere after the storage upload +
    // doc-row insert. Without this, every parse / embedding / chunk
    // failure left the PDF orphaned in the bucket AND the doc row
    // stuck at status='processing' (UI has no recovery affordance).
    // Marks the row as 'error' for visibility, then deletes the
    // storage object so we don't pay to host bytes nobody will read.
    const failDocument = async (errorMessage: string, httpStatus: number) => {
      try {
        await supabaseAdmin.from('aft_documents').update({ status: 'error' }).eq('id', doc.id);
      } catch (e) {
        console.error('[documents] failed to set status=error:', e);
      }
      try {
        await supabaseAdmin.storage.from('aft_aircraft_documents').remove([uploadData.path]);
      } catch (e) {
        console.error('[documents] failed to remove orphan storage object:', e);
      }
      return NextResponse.json({ error: errorMessage }, { status: httpStatus });
    };

    try {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      // First pass: get total page count from the full parse.
      const fullResult = await withTimeout(parser.getText(), PARSE_DEADLINE_MS);
      pageCount = fullResult.total || 0;

      // Second pass: extract per-page text so chunks are page-tagged.
      // For each page, getText({ partial: [p] }) returns only that
      // page's content. Falls back to un-paged chunking if per-page
      // parsing fails (some PDFs have non-standard page structures).
      if (pageCount > 0) {
        const pages: Array<{ page: number; text: string }> = [];
        for (let p = 1; p <= pageCount; p++) {
          // If we've already used up the parse budget, bail out and
          // fall back to the (already-computed) full-text chunks so
          // the user at least gets something indexable.
          if (Date.now() > parseDeadline) break;
          try {
            const remaining = Math.max(1_000, parseDeadline - Date.now());
            const pageResult = await withTimeout(parser.getText({ partial: [p] }), remaining);
            if (pageResult.text?.trim()) {
              pages.push({ page: p, text: pageResult.text });
            }
          } catch {
            // Page-level parse failed — skip this page silently;
            // its content was already in the full-text fallback.
          }
        }
        if (pages.length > 0) {
          taggedChunks = chunkTextPages(pages);
        }
      }

      // Fallback: if per-page extraction yielded nothing (malformed
      // PDF, single-stream text), chunk the full text without page tags.
      if (taggedChunks.length === 0 && fullResult.text?.trim()) {
        taggedChunks = chunkText(fullResult.text);
      }

      await parser.destroy();
    } catch (err: any) {
      if (err?.message === 'pdf_timeout') {
        return await failDocument('PDF took too long to parse. Try a smaller or simpler file.', 400);
      }
      return await failDocument("Couldn't read the PDF — it might be a scan or image-based file that we can't extract text from.", 400);
    }

    if (taggedChunks.length === 0) {
      return await failDocument('No readable text found in PDF.', 400);
    }

    // Generate embeddings + insert chunks. Both can fail (OpenAI 5xx,
    // DB transient error). On either failure roll the document back so
    // the bucket doesn't keep an unreachable PDF and the UI doesn't
    // see a permanent 'processing' row.
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
      // Leftover chunks from a partial insert would still be readable
      // by Howard — wipe them before flipping the doc to 'error'.
      await supabaseAdmin.from('aft_document_chunks').delete().eq('document_id', doc.id);
      console.error('[documents] embedding/chunk insert failed:', err?.message || err);
      return await failDocument("Couldn't index the document. Try again — if it keeps failing, the file may be too large or malformed.", 502);
    }

    // Update document status. Throw on failure: embeddings + chunks
    // already landed; the user retries thinking it failed and we'd
    // double-embed.
    const { error: readyErr } = await supabaseAdmin.from('aft_documents')
      .update({ status: 'ready', page_count: pageCount })
      .eq('id', doc.id);
    if (readyErr) throw readyErr;

    const responseBody = { success: true, document: { ...doc, status: 'ready', page_count: pageCount }, chunks: taggedChunks.length };
    await idem.save(200, responseBody);
    return NextResponse.json(responseBody);
  } catch (error) { return handleApiError(error); }
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

import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { PDFParse } from 'pdf-parse';
import OpenAI from 'openai';

const openai = new OpenAI();

const CHUNK_SIZE = 1500; // chars (~375 tokens)
const CHUNK_OVERLAP = 200;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

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

// POST — upload and process a PDF document
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const aircraftId = formData.get('aircraftId') as string | null;
    const docType = formData.get('docType') as string | null;

    if (!file) return NextResponse.json({ error: 'File is required.' }, { status: 400 });
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    if (!docType) return NextResponse.json({ error: 'Document type required.' }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'File too large (max 20MB).' }, { status: 400 });
    if (file.type !== 'application/pdf') return NextResponse.json({ error: 'Only PDF files are supported.' }, { status: 400 });

    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);
    await setAppUser(supabaseAdmin, user.id);

    // Upload PDF to Supabase Storage
    const fileName = `${aircraftId}_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Magic-byte check — `%PDF` (0x25 0x50 0x44 0x46). The `file.type`
    // header is client-supplied and can be spoofed; this confirms the
    // bytes actually start like a PDF before we hand them to pdf-parse.
    if (buffer.length < 4 || !buffer.subarray(0, 4).equals(Buffer.from([0x25, 0x50, 0x44, 0x46]))) {
      return NextResponse.json({ error: 'File does not appear to be a valid PDF.' }, { status: 400 });
    }

    // SHA-256 tamper-evidence hash — computed before upload so we can
    // detect post-upload mutation of the storage object.
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    // Reject duplicate uploads (same aircraft, same bytes).
    const { data: dup } = await supabaseAdmin
      .from('aft_documents')
      .select('id, filename')
      .eq('aircraft_id', aircraftId)
      .eq('sha256', sha256)
      .is('deleted_at', null)
      .maybeSingle();
    if (dup) {
      return NextResponse.json(
        { error: `This exact file is already uploaded as "${dup.filename}".` },
        { status: 409 }
      );
    }

    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('aft_aircraft_documents')
      .upload(fileName, buffer, { contentType: 'application/pdf' });
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const { data: urlData } = supabaseAdmin.storage
      .from('aft_aircraft_documents')
      .getPublicUrl(uploadData.path);

    // Create document record (status: processing)
    const { data: doc, error: docError } = await supabaseAdmin
      .from('aft_documents')
      .insert({
        aircraft_id: aircraftId,
        user_id: user.id,
        filename: file.name,
        file_url: urlData.publicUrl,
        doc_type: docType,
        status: 'processing',
        sha256,
        file_size: file.size,
      })
      .select()
      .single();
    if (docError) throw docError;

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
      await supabaseAdmin.from('aft_documents').update({ status: 'error' }).eq('id', doc.id);
      if (err?.message === 'pdf_timeout') {
        return NextResponse.json({ error: 'PDF took too long to parse. Try a smaller or simpler file.' }, { status: 400 });
      }
      return NextResponse.json({ error: "Couldn't read the PDF — it might be a scan or image-based file that we can't extract text from." }, { status: 400 });
    }

    if (taggedChunks.length === 0) {
      await supabaseAdmin.from('aft_documents').update({ status: 'error' }).eq('id', doc.id);
      return NextResponse.json({ error: 'No readable text found in PDF.' }, { status: 400 });
    }

    // Generate embeddings
    const embeddings = await generateEmbeddings(taggedChunks.map(c => c.content));

    // Store chunks with embeddings + page number
    const chunkRows = taggedChunks.map((chunk, i) => ({
      document_id: doc.id,
      chunk_index: i,
      content: chunk.content,
      page_number: chunk.page_number,
      embedding: JSON.stringify(embeddings[i]),
    }));

    // Insert in batches of 50
    for (let i = 0; i < chunkRows.length; i += 50) {
      const batch = chunkRows.slice(i, i + 50);
      const { error: chunkError } = await supabaseAdmin
        .from('aft_document_chunks')
        .insert(batch);
      if (chunkError) throw chunkError;
    }

    // Update document status
    await supabaseAdmin.from('aft_documents')
      .update({ status: 'ready', page_count: pageCount })
      .eq('id', doc.id);

    return NextResponse.json({ success: true, document: { ...doc, status: 'ready', page_count: pageCount }, chunks: taggedChunks.length });
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
    const { data: existing } = await supabaseAdmin
      .from('aft_documents')
      .select('aircraft_id, deleted_at')
      .eq('id', documentId)
      .maybeSingle();
    if (!existing || existing.aircraft_id !== aircraftId || existing.deleted_at) {
      return NextResponse.json({ error: 'Document not found for this aircraft.' }, { status: 404 });
    }

    await setAppUser(supabaseAdmin, user.id);
    await supabaseAdmin.from('aft_document_chunks').delete().eq('document_id', documentId);
    await supabaseAdmin
      .from('aft_documents')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', documentId)
      .eq('aircraft_id', aircraftId);
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

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

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
    if (start >= text.length) break;
  }
  return chunks.filter(c => c.trim().length > 50);
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

    // Extract text from PDF
    let fullText = '';
    let pageCount = 0;
    try {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const textResult = await parser.getText();
      fullText = textResult.text || '';
      pageCount = textResult.total || 0;
      await parser.destroy();
    } catch {
      await supabaseAdmin.from('aft_documents').update({ status: 'error' }).eq('id', doc.id);
      return NextResponse.json({ error: 'Failed to parse PDF. The file may be scanned/image-based.' }, { status: 400 });
    }

    // Chunk the text
    const chunks = chunkText(fullText);
    if (chunks.length === 0) {
      await supabaseAdmin.from('aft_documents').update({ status: 'error' }).eq('id', doc.id);
      return NextResponse.json({ error: 'No readable text found in PDF.' }, { status: 400 });
    }

    // Generate embeddings
    const embeddings = await generateEmbeddings(chunks);

    // Store chunks with embeddings
    const chunkRows = chunks.map((content, i) => ({
      document_id: doc.id,
      chunk_index: i,
      content,
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

    return NextResponse.json({ success: true, document: { ...doc, status: 'ready', page_count: pageCount }, chunks: chunks.length });
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

    await setAppUser(supabaseAdmin, user.id);
    await supabaseAdmin.from('aft_document_chunks').delete().eq('document_id', documentId);
    await supabaseAdmin
      .from('aft_documents')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', documentId);
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

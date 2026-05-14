import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { env } from '@/lib/env';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

export const maxDuration = 30;

/**
 * Admin diagnostic for the Howard search_documents pipeline.
 *
 * Usage:
 *   GET /api/admin/document-search-diag?aircraftId=<uuid>&q=<query>
 *     [&threshold=0.3] [&count=10]
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * Returns:
 *   - all documents on that aircraft (id, filename, status, page_count, chunk_count)
 *   - the test query's match_document_chunks results with similarity scores
 *   - timings for embed + RPC
 *
 * Helps diagnose "Howard returns no results" / "Howard times out" by
 * showing exactly what the RAG layer sees. Locked to the CRON_SECRET
 * — same boundary used by the sweep routes — so no auth session needed
 * to debug from a codespace.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  let aircraftId = url.searchParams.get('aircraftId');
  const tail = url.searchParams.get('tail');
  const q = url.searchParams.get('q') || 'maximum gross weight';
  const threshold = parseFloat(url.searchParams.get('threshold') || '0.2');
  const count = parseInt(url.searchParams.get('count') || '10', 10);

  const supabaseAdmin = createAdminClient();

  // Allow lookup by tail for easier debugging from the codespace.
  if (!aircraftId && tail) {
    const { data: ac } = await supabaseAdmin
      .from('aft_aircraft')
      .select('id, tail_number')
      .ilike('tail_number', tail.replace(/^N/i, 'N'))
      .is('deleted_at', null)
      .maybeSingle();
    if (ac) aircraftId = (ac as { id: string }).id;
  }

  if (!aircraftId) {
    // Return a list of aircraft + their tails so the caller knows what
    // to query for next.
    const { data: list } = await supabaseAdmin
      .from('aft_aircraft')
      .select('id, tail_number')
      .is('deleted_at', null)
      .order('tail_number');
    return NextResponse.json({
      error: 'aircraftId or tail required',
      available_aircraft: list,
    }, { status: 400 });
  }

  // 1) Inventory: all docs on this aircraft + per-doc chunk count.
  const { data: docs, error: docsErr } = await supabaseAdmin
    .from('aft_documents')
    .select('id, filename, doc_type, status, page_count, last_error_reason, created_at')
    .eq('aircraft_id', aircraftId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (docsErr) {
    return NextResponse.json({ error: 'docs select failed', detail: docsErr.message }, { status: 500 });
  }

  const docsWithChunks: Array<Record<string, unknown>> = [];
  for (const d of docs || []) {
    const { count: chunkCount } = await supabaseAdmin
      .from('aft_document_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', d.id);
    let sampleChunk: { chunk_index: number; page_number: number | null; preview: string } | null = null;
    const { data: sample } = await supabaseAdmin
      .from('aft_document_chunks')
      .select('chunk_index, page_number, content')
      .eq('document_id', d.id)
      .limit(1);
    if (sample && sample.length > 0) {
      sampleChunk = {
        chunk_index: (sample[0] as { chunk_index: number }).chunk_index,
        page_number: (sample[0] as { page_number: number | null }).page_number,
        preview: ((sample[0] as { content: string }).content || '').slice(0, 160).replace(/\s+/g, ' '),
      };
    }
    docsWithChunks.push({ ...d, chunk_count: chunkCount, sample_chunk: sampleChunk });
  }

  // 2) Embed the test query.
  const tEmbStart = Date.now();
  const openai = new OpenAI();
  let queryEmbedding: number[];
  try {
    const embResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: q,
    });
    queryEmbedding = embResponse.data[0].embedding;
  } catch (err: any) {
    return NextResponse.json({
      docs: docsWithChunks,
      query: q,
      embedError: err?.message || String(err),
    });
  }
  const embedMs = Date.now() - tEmbStart;

  // 3) Run the RPC at the requested threshold.
  const tRpcStart = Date.now();
  const { data: matches, error: rpcErr } = await supabaseAdmin.rpc('match_document_chunks', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_aircraft_id: aircraftId,
    match_count: count,
    match_threshold: threshold,
  });
  const rpcMs = Date.now() - tRpcStart;

  // 4) Also run at threshold=0 to see what scores the chunks DO get,
  // even if they're filtered out at the production threshold.
  const tRpc0Start = Date.now();
  const { data: matchesNoFilter } = await supabaseAdmin.rpc('match_document_chunks', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_aircraft_id: aircraftId,
    match_count: count,
    match_threshold: 0,
  });
  const rpc0Ms = Date.now() - tRpc0Start;

  return NextResponse.json({
    project_url: env.SUPABASE_URL,
    docs: docsWithChunks,
    query: q,
    threshold,
    count,
    embed_ms: embedMs,
    rpc_ms: rpcMs,
    rpc_zero_threshold_ms: rpc0Ms,
    rpc_error: rpcErr?.message,
    matches_at_threshold: (matches || []).map((m: { document_id: string; chunk_index: number; page_number: number | null; similarity: number; content: string }) => ({
      document_id: m.document_id,
      chunk_index: m.chunk_index,
      page_number: m.page_number,
      similarity: m.similarity?.toFixed(4),
      content_preview: (m.content || '').slice(0, 200).replace(/\s+/g, ' '),
    })),
    matches_unfiltered: (matchesNoFilter || []).slice(0, count).map((m: { document_id: string; chunk_index: number; page_number: number | null; similarity: number; content: string }) => ({
      document_id: m.document_id,
      chunk_index: m.chunk_index,
      page_number: m.page_number,
      similarity: m.similarity?.toFixed(4),
      content_preview: (m.content || '').slice(0, 200).replace(/\s+/g, ' '),
    })),
  });
}

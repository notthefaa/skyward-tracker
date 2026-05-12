import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5-20251001';
// Output cap per chunk. Haiku 4.5 supports much more if needed but
// 16K is plenty for ~50 pages of dense aviation manual text.
const MAX_OUTPUT_TOKENS = 16_000;

// PDFs up to this many pages are sent to Claude in a single call.
// Anthropic's published per-PDF safe page limit is ~100; we leave a
// generous margin so a 100-page request doesn't get truncated by
// the 16K output budget. Above this threshold we split.
const SINGLE_CALL_PAGE_THRESHOLD = 50;

// When splitting, this many pages per chunk. Tuned to keep each
// chunk's expected output under MAX_OUTPUT_TOKENS — a dense aviation
// manual averages ~300 output tokens per page, so 50 pages × 300 =
// 15 K, just inside the cap.
const PAGES_PER_CHUNK = 50;

// How many chunk OCRs to run in parallel. Anthropic Haiku rate limits
// (50+ RPM on tier 1) are well above this; 3 lets a 400-page PDF
// finish in ~3 rounds (≈ 90–120 s) instead of 8 (≈ 240 s) while
// staying gentle on the per-token rate.
const PARALLEL_CHUNKS = 3;

/**
 * Run OCR on a scanned PDF using Claude's vision-capable PDF
 * document-input. Used when `pdf-parse` returns no extractable text
 * (older aviation manuals — POH, AFM, PIM for piston singles — often
 * exist only as scans).
 *
 * For PDFs larger than `SINGLE_CALL_PAGE_THRESHOLD`, splits the PDF
 * into chunks via `pdf-lib` and processes them in parallel. Page
 * numbers are offset to remain accurate across the original document.
 *
 * Returns `Array<{ page, text }>`. Pages with no extractable content
 * are dropped before chunking so they don't pollute embeddings.
 */
export async function ocrPdfWithClaude(
  buffer: Buffer,
  opts?: { knownPageCount?: number },
): Promise<Array<{ page: number; text: string }>> {
  // Determine page count if we don't already have one. pdf-lib reads
  // PDFs that pdf-parse choked on (image-only scans), so this is the
  // reliable source for OCR's split decisions.
  let pageCount = opts?.knownPageCount || 0;
  if (!pageCount || pageCount <= 0) {
    pageCount = await getPdfPageCount(buffer);
  }

  if (pageCount <= SINGLE_CALL_PAGE_THRESHOLD) {
    console.log(`[ocr] single-call: ${pageCount} pages`);
    return ocrSingleChunk(buffer, 0);
  }

  // Split + parallel OCR for large PDFs.
  console.log(`[ocr] splitting ${pageCount}-page PDF into ${PAGES_PER_CHUNK}-page chunks`);
  const chunks = await splitPdf(buffer, PAGES_PER_CHUNK);
  console.log(`[ocr] ${chunks.length} chunks; processing ${PARALLEL_CHUNKS} in parallel`);

  // Process with a fixed concurrency window. Promise.all without
  // throttling would hammer Anthropic; we want bounded parallelism.
  const allPages: Array<{ page: number; text: string }> = [];
  for (let i = 0; i < chunks.length; i += PARALLEL_CHUNKS) {
    const batch = chunks.slice(i, i + PARALLEL_CHUNKS);
    const results = await Promise.all(
      batch.map((c, idx) => {
        const overallIdx = i + idx + 1;
        console.log(`[ocr] chunk ${overallIdx}/${chunks.length} starting (pages ${c.startPage + 1}-${c.startPage + c.pageCount})`);
        return ocrSingleChunk(c.buffer, c.startPage)
          .then((pages) => {
            console.log(`[ocr] chunk ${overallIdx}/${chunks.length} done: ${pages.length} pages with text`);
            return pages;
          })
          .catch((err) => {
            // Don't fail the whole document for one bad chunk —
            // we'd rather index 350/400 pages than none. Log loudly so
            // the partial-coverage is visible.
            console.error(`[ocr] chunk ${overallIdx}/${chunks.length} failed: ${err?.message || err}`);
            return [] as Array<{ page: number; text: string }>;
          });
      }),
    );
    for (const pages of results) allPages.push(...pages);
  }

  // Sort by page number — parallel completion order is not guaranteed.
  allPages.sort((a, b) => a.page - b.page);
  return allPages;
}

/**
 * OCR a single PDF (or PDF chunk) in one Claude call. `pageOffset` is
 * added to each parsed page number so chunk results map back to the
 * original document's pagination.
 */
async function ocrSingleChunk(
  buffer: Buffer,
  pageOffset: number,
): Promise<Array<{ page: number; text: string }>> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: buffer.toString('base64'),
            },
          },
          {
            type: 'text',
            text: [
              'Extract ALL readable text from this aviation manual PDF, page by page.',
              '',
              'Output format — strict:',
              '• Begin each page with a marker on its own line: `--- PAGE N ---` where N is the 1-indexed page number WITHIN THIS PDF (not the original document — we handle the offset).',
              '• Follow the marker with the extracted text for that page.',
              '• Preserve tables as plain text with consistent spacing — pilots will be searching for V-speeds, weights, and procedures.',
              '• Preserve checklists, bullet points, and section headings as written.',
              '• If a page is blank or purely a figure/diagram with no readable text, still emit its `--- PAGE N ---` marker followed by "[no extractable text on this page]".',
              '• Do NOT add any commentary, summary, or explanation. Output ONLY page markers and extracted text.',
              '',
              'This is a scanned PDF — read carefully and transcribe accurately. The text will be indexed for semantic search; accuracy matters more than formatting.',
            ].join('\n'),
          },
        ],
      },
    ],
  });

  let raw = '';
  for (const block of response.content) {
    if (block.type === 'text') raw += block.text;
  }

  if (response.stop_reason === 'max_tokens') {
    console.warn(
      `[ocr] chunk hit max_tokens (${MAX_OUTPUT_TOKENS}); partial output. Pages parsed: ${(raw.match(/^--- PAGE \d+ ---/gm) || []).length}.`,
    );
  }

  const pages = parsePages(raw);
  // Apply the chunk's page offset so chunk-2 page 1 becomes page 51
  // in the original document.
  return pages.map((p) => ({ page: p.page + pageOffset, text: p.text }));
}

/**
 * Page count via pdf-lib — works on scanned/image-only PDFs that
 * pdf-parse can't read. Pure-JS so it runs fine on Vercel.
 */
export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch (e) {
    console.warn('[ocr] pdf-lib could not load PDF for page count:', e);
    return 0;
  }
}

/**
 * Split a PDF into chunks of `pagesPerChunk` pages each. Returns each
 * chunk's bytes plus the 0-indexed page-number offset to apply when
 * mapping its OCR'd pages back to the original document.
 */
export async function splitPdf(
  buffer: Buffer,
  pagesPerChunk: number,
): Promise<Array<{ startPage: number; pageCount: number; buffer: Buffer }>> {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const totalPages = src.getPageCount();
  const chunks: Array<{ startPage: number; pageCount: number; buffer: Buffer }> = [];

  for (let start = 0; start < totalPages; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk, totalPages);
    const dst = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const pages = await dst.copyPages(src, indices);
    pages.forEach((p) => dst.addPage(p));
    const bytes = await dst.save();
    chunks.push({
      startPage: start,
      pageCount: end - start,
      buffer: Buffer.from(bytes),
    });
  }
  return chunks;
}

/**
 * Parse Claude's OCR output into per-page entries. Drops empty-page
 * placeholders so we don't generate worthless embeddings.
 */
export function parsePages(raw: string): Array<{ page: number; text: string }> {
  if (!raw.trim()) return [];

  const markers: Array<{ index: number; page: number }> = [];
  const re = /^--- PAGE (\d+) ---\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    markers.push({ index: m.index + m[0].length, page: parseInt(m[1], 10) });
  }

  if (markers.length === 0) {
    // Whole-doc fallback: Claude ignored markers. Better than dropping
    // the OCR output entirely.
    const trimmed = raw.trim();
    if (!trimmed) return [];
    return [{ page: 1, text: trimmed }];
  }

  const pages: Array<{ page: number; text: string }> = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index;
    const end = i + 1 < markers.length ? markers[i + 1].index : raw.length;
    let text = raw.slice(start, end).trim();
    text = text.replace(/\n--- PAGE \d+ ---\s*$/, '').trim();
    if (!text) continue;
    if (text.toLowerCase().includes('no extractable text on this page')) continue;
    pages.push({ page: markers[i].page, text });
  }
  return pages;
}

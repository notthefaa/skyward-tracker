import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5-20251001';
// Haiku 4.5 supports much more than this in a single call; cap at 16K
// to leave headroom for very long PDFs. If a page-heavy document
// truncates we log it loudly — the user still gets the leading pages
// indexed.
const MAX_OUTPUT_TOKENS = 16_000;
// Anthropic accepts PDFs up to 32 MB; our route caps uploads at 30 MB
// already, so a single-call OCR is fine for the common case.
// Anthropic's per-PDF page limit is ~100; we WARN past that since
// the API may truncate or error.
const SAFE_PAGE_HINT_LIMIT = 100;

const PAGE_MARKER = /^--- PAGE (\d+) ---/m;
const PAGE_SPLIT_REGEX = /^--- PAGE \d+ ---\s*\n?/m;

/**
 * Run OCR on a scanned PDF using Claude's vision-capable PDF
 * document-input. Used when `pdf-parse` returns no extractable text,
 * which is the common case for older aviation manuals (POH, AFM, PIM
 * for piston singles) that only exist as scans.
 *
 * Returns an array of `{ page, text }`. Pages with no content are
 * dropped before chunking so they don't pollute embeddings.
 */
export async function ocrPdfWithClaude(
  buffer: Buffer,
  opts?: { knownPageCount?: number },
): Promise<Array<{ page: number; text: string }>> {
  const client = new Anthropic();

  if (opts?.knownPageCount && opts.knownPageCount > SAFE_PAGE_HINT_LIMIT) {
    console.warn(
      `[ocr] PDF has ${opts.knownPageCount} pages — past Anthropic's safe single-call limit (${SAFE_PAGE_HINT_LIMIT}). May truncate.`,
    );
  }

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
              '• Begin each page with a marker on its own line: `--- PAGE N ---` (where N is the 1-indexed page number from the PDF).',
              '• Follow the marker with the extracted text for that page.',
              '• Preserve tables as plain text with consistent spacing — pilots will be searching for V-speeds, weights, and procedures.',
              '• Preserve checklists, bullet points, and section headings as written.',
              '• If a page is blank or purely a figure/diagram with no readable text, still emit its `--- PAGE N ---` marker followed by "[no extractable text on this page]".',
              '• Do NOT add any commentary, summary, or explanation. Output ONLY the page markers and the extracted text.',
              '',
              'This is a scanned PDF — read carefully and transcribe accurately. The text will be indexed for semantic search, so accuracy matters more than formatting flourish.',
            ].join('\n'),
          },
        ],
      },
    ],
  });

  // Concatenate any text content blocks.
  let raw = '';
  for (const block of response.content) {
    if (block.type === 'text') raw += block.text;
  }

  if (response.stop_reason === 'max_tokens') {
    console.warn(
      `[ocr] Claude hit max_tokens (${MAX_OUTPUT_TOKENS}). PDF may be truncated. ` +
        `Indexed pages: ${(raw.match(/^--- PAGE \d+ ---/gm) || []).length}.`,
    );
  }

  return parsePages(raw);
}

/**
 * Parse the OCR output into per-page entries. The model emits
 * `--- PAGE N ---` markers; we split on those and pair each with its
 * page number. Pages with `[no extractable text on this page]` are
 * dropped so they don't generate empty embeddings.
 */
export function parsePages(raw: string): Array<{ page: number; text: string }> {
  if (!raw.trim()) return [];

  // Find each page marker's position + page number.
  const markers: Array<{ index: number; page: number }> = [];
  const re = /^--- PAGE (\d+) ---\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    markers.push({ index: m.index + m[0].length, page: parseInt(m[1], 10) });
  }

  // Whole-doc fallback: if Claude ignored the marker format, treat the
  // entire response as page 1. Better than dropping the OCR output.
  if (markers.length === 0) {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    return [{ page: 1, text: trimmed }];
  }

  const pages: Array<{ page: number; text: string }> = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index;
    const end = i + 1 < markers.length ? markers[i + 1].index - 0 : raw.length;
    // Trim AND strip a leading marker if our regex split left one.
    let text = raw.slice(start, end).trim();
    // Drop trailing marker for the next page if it bled in.
    text = text.replace(/\n--- PAGE \d+ ---\s*$/, '').trim();
    if (!text) continue;
    if (text.toLowerCase().includes('no extractable text on this page')) continue;
    pages.push({ page: markers[i].page, text });
  }
  return pages;
}

// Suppress the unused-vars warning for the un-used regex constants —
// they're kept for documentation of the format the prompt enforces.
void PAGE_MARKER;
void PAGE_SPLIT_REGEX;

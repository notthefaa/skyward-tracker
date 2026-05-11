import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { checkEmailRateLimit } from '@/lib/submitRateLimit';
import { fileBytesMatchType } from '@/lib/fileMagic';

const client = new Anthropic();

/**
 * POST /api/maintenance-items/scan-logentry
 *
 * Reads a scanned aircraft-logbook entry and extracts an array of
 * distinct recurring maintenance items the pilot might want to
 * track. Unlike the sibling /api/mx-events/scan-logentry route
 * (which assumes one line item is being closed out), this route is
 * classification-first: each returned item carries a suggested
 * tracking_type + interval so the Track New Item form can prefill.
 *
 * A single logbook entry can cover multiple items (e.g. "Annual
 * C/W, oil change, transponder cert renewed"). The prompt is
 * carefully worded to avoid over-decomposing — a single inspection
 * stays as one item, not one per sub-task. The UI shows a picker
 * for multi-item scans so the pilot chooses which ones to track.
 *
 * Body: multipart/form-data with:
 *   - image: File (JPEG/PNG/WebP, max 10MB)
 *   - aircraftId: string (for access check)
 *
 * Response: { items: [...], raw_text: string }
 */
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    // Rate limit — Anthropic vision is expensive; a fast-tap on the
    // scan button could rack up hundreds of calls / dollars before any
    // UI feedback. Reuses the email-budget bucket (per-user expensive
    // operations live there).
    const rl = await checkEmailRateLimit(supabaseAdmin, user.id);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many scans. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.` },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const formData = await req.formData();
    const image = formData.get('image') as File | null;
    const aircraftId = formData.get('aircraftId') as string | null;

    if (!image) return NextResponse.json({ error: 'Image file is required.' }, { status: 400 });
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID is required.' }, { status: 400 });
    if (image.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Image too large (max 10MB).' }, { status: 400 });

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(image.type)) {
      return NextResponse.json({ error: 'Only JPEG, PNG, or WebP images are accepted.' }, { status: 400 });
    }

    await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);

    const buffer = Buffer.from(await image.arrayBuffer());
    // Magic-byte check — the multipart File's `type` is a Content-Type
    // header echoed from the client and trivial to spoof. Renaming
    // anything.exe to anything.jpg would otherwise reach Anthropic's
    // vision endpoint and burn tokens producing garbage.
    if (!fileBytesMatchType(buffer, image.type, image.name)) {
      return NextResponse.json({ error: `File contents don't match the declared type (${image.type}).` }, { status: 400 });
    }
    const base64 = buffer.toString('base64');
    const mediaType = image.type as 'image/jpeg' | 'image/png' | 'image/webp';

    // 30s deadline so a stalled Anthropic vision call doesn't hold
    // the function open until Vercel's platform timeout.
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: `You are reading a scanned aircraft maintenance logbook entry. The pilot wants to start TRACKING distinct recurring items from this entry on their own schedules.

Return a JSON array of items the pilot would track SEPARATELY. One logbook entry can contain several; do NOT over-decompose.

  - "Annual inspection C/W" is ONE item — do NOT list each sub-task (landing-gear lube, cable tension, etc.) as its own item. Those are part of the Annual.
  - "Annual C/W, oil change C/W, transponder cert renewed" is THREE items (each has its own schedule).
  - A one-off squawk repair with no recurring interval can still be returned (set time_interval and date_interval_days to null); the pilot decides whether to track it.

Typical intervals (use these unless the entry contradicts them):
  - Annual = tracking_type 'both', time_interval 100, date_interval_days 365 (the 100 hr is for commercial ops; leave null if clearly private-only)
  - 100-hour = 'time', time_interval 100
  - Oil change = 'time', time_interval 50 unless the entry states otherwise
  - Pitot-Static 91.411 = 'date', date_interval_days 730 (24 months)
  - Transponder 91.413 = 'date', date_interval_days 730
  - ELT battery = 'date', date_interval_days 365 (check manufacturer for exact)
  - Magneto 500hr = 'time', time_interval 500

Return ONLY a JSON object in this exact shape. No prose outside the JSON, no markdown fences:

{
  "items": [
    {
      "item_name": "Annual Inspection",
      "tracking_type": "time" | "date" | "both",
      "time_interval": number | null,
      "date_interval_days": number | null,
      "is_required": boolean,
      "last_completed_date": "YYYY-MM-DD" | null,
      "last_completed_time": number | null,
      "work_description": "short note from the logbook + any uncertainty you want to flag, <300 chars"
    }
  ]
}

Rules:
- Be precise with numbers — don't round.
- If you can't read a field, use null for that field (don't guess numbers).
- is_required = true for regulatory items (Annual, Pitot-Static, Transponder, ELT, 100hr for commercial); false for discretionary items.
- If the page is blank, unreadable, or not a logbook entry, return { "items": [] }.`,
            },
          ],
        },
      ],
    }, { signal: AbortSignal.timeout(30_000) });

    const textBlock = response.content.find((b: any) => b.type === 'text');
    const rawText = textBlock?.type === 'text' ? (textBlock as any).text : '';

    let parsed: any = {};
    try {
      const cleaned = rawText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({
        items: [],
        raw_text: rawText,
        warning: 'Could not parse structured fields from the scan. The raw text is included for manual reference.',
      });
    }

    // Accept either the new { items: [...] } shape or a legacy single-object
    // response (which earlier iterations of this route returned) — wrap the
    // legacy shape in an array so callers only need to handle one path.
    const items = Array.isArray(parsed?.items)
      ? parsed.items
      : parsed && typeof parsed === 'object' && parsed.item_name
        ? [parsed]
        : [];

    return NextResponse.json({ items, raw_text: rawText });
  } catch (error) {
    return handleApiError(error);
  }
}

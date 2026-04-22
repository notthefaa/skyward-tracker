import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';

const client = new Anthropic();

/**
 * POST /api/maintenance-items/scan-logentry
 *
 * Reads a scanned aircraft-logbook entry and extracts fields that
 * pre-fill the "Track New Item" form. Unlike the existing
 * /api/mx-events/scan-logentry route (which assumes an item is
 * already being tracked and the user is closing it out), this route
 * also asks the model to *classify* the work — so we can propose a
 * tracking_type + time_interval / date_interval_days for the new
 * item. The user always confirms before anything saves.
 *
 * Body: multipart/form-data with:
 *   - image: File (JPEG/PNG/WebP, max 10MB)
 *   - aircraftId: string (for access check)
 *
 * Response: { fields: { ... }, raw_text: string }
 */
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
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
    const base64 = buffer.toString('base64');
    const mediaType = image.type as 'image/jpeg' | 'image/png' | 'image/webp';

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250514',
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
              text: `You are reading a scanned aircraft maintenance logbook entry. The pilot wants to start TRACKING this item on a recurring schedule. Classify the work and return the fields below as JSON (use null when you can't read a value or the page doesn't give you enough to guess).

{
  "item_name": "short name for the recurring item (e.g. 'Annual Inspection', '100-hour Inspection', 'Oil Change', 'Pitot-Static 91.411', 'Transponder 91.413', 'ELT Battery', 'Magneto Inspection (500hr)') or null",
  "tracking_type": "'time' | 'date' | 'both' — use 'time' for hour-based items (100hr, 50hr oil), 'date' for calendar-only (ELT battery, pitot-static, transponder), 'both' for items with a calendar OR hours limit (Annual: 12 mo or 100 hr for commercial)",
  "time_interval": "interval in engine hours, or null if tracking_type is 'date'. Common: 100hr = 100, Oil = 50 or as specified, magneto 500hr = 500",
  "date_interval_days": "interval in days, or null if tracking_type is 'time'. Common: Annual = 365, Pitot-Static/Transponder = 730 (24 months), ELT battery = typically 365 or per manufacturer",
  "is_required": "true if this is a regulatory/required item (Annual, Pitot-Static, Transponder, ELT, 100hr for commercial), false otherwise (oil change, inspections beyond regs)",
  "last_completed_date": "YYYY-MM-DD — the date the work was just completed (from the logbook entry), or null",
  "last_completed_time": "engine/tach hours at completion (number) or null",
  "work_description": "short prose from the logbook, plus any classification uncertainty you want to flag to the pilot (e.g. 'Looks like an Annual — couldn't read the hours clearly'). Keep under 300 chars."
}

Rules:
- Be precise with numbers — don't round.
- If the work looks like a one-off repair (squawk fix) rather than a recurring scheduled item, set item_name to a descriptive name and set tracking_type to 'time' with time_interval null — the pilot can decide whether to track it or discard.
- If you genuinely can't tell what recurring interval applies (e.g. a non-standard inspection), leave the interval fields null and say so in work_description.
- Return raw JSON only, no markdown fences.`,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b: any) => b.type === 'text');
    const rawText = textBlock?.type === 'text' ? (textBlock as any).text : '';

    let fields: any = {};
    try {
      const cleaned = rawText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      fields = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({
        fields: {},
        raw_text: rawText,
        warning: 'Could not parse structured fields from the scan. The raw text is included for manual reference.',
      });
    }

    return NextResponse.json({ fields, raw_text: rawText });
  } catch (error) {
    return handleApiError(error);
  }
}

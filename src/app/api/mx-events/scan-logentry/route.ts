import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { fileBytesMatchType } from '@/lib/fileMagic';

const client = new Anthropic();

/**
 * POST /api/mx-events/scan-logentry
 *
 * Accepts a scanned image of a maintenance logbook entry and uses
 * Claude vision to extract structured completion fields. Returns
 * pre-filled data that the UI can drop into the line-item completion
 * form for review before the user submits.
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
    // Magic-byte check — the multipart File's `type` is client-controlled.
    // Without this an attacker could rename anything.exe → .jpg and burn
    // Anthropic vision tokens parsing arbitrary bytes for free.
    if (!fileBytesMatchType(buffer, image.type, image.name)) {
      return NextResponse.json({ error: `File contents don't match the declared type (${image.type}).` }, { status: 400 });
    }
    const base64 = buffer.toString('base64');
    const mediaType = image.type as 'image/jpeg' | 'image/png' | 'image/webp';

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
              text: `You are reading a scanned aircraft maintenance logbook entry. Extract the following fields from the image. Return ONLY a JSON object with these keys (use null for any field you can't read or that isn't present):

{
  "completion_date": "YYYY-MM-DD or null",
  "completion_time": "engine hours at completion (number) or null",
  "completed_by_name": "mechanic/IA name or null",
  "cert_type": "A&P or IA or Repairman or null",
  "cert_number": "certificate number or null",
  "cert_expiry": "YYYY-MM-DD or null",
  "tach_at_completion": "tach reading (number) or null",
  "hobbs_at_completion": "hobbs reading (number) or null",
  "work_description": "description of work performed or null",
  "logbook_ref": "logbook page/entry reference or null"
}

Be precise with numbers — don't round. If handwriting is ambiguous, pick the most likely reading and note the uncertainty in work_description. Return raw JSON only, no markdown fences.`,
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

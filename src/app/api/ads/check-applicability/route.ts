import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { computeVerdict, type ParsedApplicability } from '@/lib/adApplicability';

export const maxDuration = 60;

const client = new Anthropic();
const MODEL = 'claude-haiku-4-5-20251001';

const TOOL_SCHEMA: Anthropic.Tool = {
  name: 'report_applicability',
  description: 'Report the structured applicability of this AD — what serial numbers, engine makes/models, and propeller makes/models it applies to.',
  input_schema: {
    type: 'object',
    properties: {
      serial_ranges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            start: { type: 'number', description: 'Lower bound of the serial range (inclusive unless noted).' },
            end: { type: 'number', description: 'Upper bound of the serial range (inclusive unless noted).' },
            inclusive: { type: 'boolean' },
            openEnd: { type: 'boolean', description: 'True if the range is "X and subsequent" — no upper bound.' },
            openStart: { type: 'boolean', description: 'True if the range is "prior to X" — no lower bound.' },
          },
        },
      },
      specific_serials: {
        type: 'array',
        items: { type: 'number' },
        description: 'Individual serial numbers called out explicitly (not part of a range).',
      },
      engine_references: {
        type: 'array',
        items: { type: 'string' },
        description: 'Engine makes and models the AD applies to (e.g. "Lycoming IO-390"). Empty array if the AD is not engine-specific.',
      },
      prop_references: {
        type: 'array',
        items: { type: 'string' },
        description: 'Propeller makes and models the AD applies to. Empty array if not prop-specific.',
      },
      notes: {
        type: 'string',
        description: 'One-sentence summary of applicability scope, and any qualifiers (e.g. "applies only to aircraft equipped with X autopilot"). Keep under 200 chars.',
      },
    },
    required: ['serial_ranges', 'specific_serials', 'engine_references', 'prop_references', 'notes'],
  },
};

// computeVerdict + serial helpers live in src/lib/adApplicability.ts so
// the matcher is unit-testable. Next.js App Router only allows HTTP
// method exports + a small allowlist of metadata exports from a
// route file.

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { adId } = await req.json();
    if (!adId) return NextResponse.json({ error: 'AD ID required.' }, { status: 400 });

    // Look up the AD and its aircraft.
    const { data: ad, error: adErr } = await supabaseAdmin
      .from('aft_airworthiness_directives')
      .select('id, aircraft_id, ad_number, subject, applicability, source_url, sync_hash')
      .eq('id', adId)
      .is('deleted_at', null)
      .maybeSingle();
    if (adErr) throw adErr;
    if (!ad) return NextResponse.json({ error: 'AD not found.' }, { status: 404 });

    await requireAircraftAdmin(supabaseAdmin, user.id, ad.aircraft_id);
    await setAppUser(supabaseAdmin, user.id);

    const { data: aircraft } = await supabaseAdmin
      .from('aft_aircraft')
      .select('id, serial_number')
      .eq('id', ad.aircraft_id)
      .maybeSingle();
    const { data: equipmentData } = await supabaseAdmin
      .from('aft_aircraft_equipment')
      .select('category, make, model')
      .eq('aircraft_id', ad.aircraft_id)
      .is('deleted_at', null)
      .is('removed_at', null);
    const equipment = equipmentData || [];

    const sourceHash = ad.sync_hash || 'unknown';

    // Cache check first.
    let parsed: ParsedApplicability | null = null;
    let fromCache = false;

    const { data: cached } = await supabaseAdmin
      .from('aft_ad_applicability_cache')
      .select('parsed')
      .eq('ad_number', ad.ad_number)
      .eq('source_hash', sourceHash)
      .maybeSingle();

    if (cached?.parsed) {
      parsed = cached.parsed as ParsedApplicability;
      fromCache = true;
    } else {
      // Build prompt. We feed the subject + abstract; the abstract
      // is where applicability language lives (engines, serials).
      const adText = [
        `AD number: ${ad.ad_number}`,
        `Subject: ${ad.subject}`,
        '',
        'Abstract:',
        ad.applicability || '(no abstract)',
        '',
        ad.source_url ? `Source: ${ad.source_url}` : '',
      ].filter(Boolean).join('\n');

      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        tools: [TOOL_SCHEMA],
        tool_choice: { type: 'tool', name: 'report_applicability' },
        messages: [
          {
            role: 'user',
            content: `Parse the applicability of the following FAA Airworthiness Directive. Report structured applicability via the report_applicability tool. If the AD text does not narrow applicability to specific serials, engines, or props, return empty arrays — do NOT guess.\n\n${adText}`,
          },
        ],
      });

      const toolBlock = msg.content.find(b => b.type === 'tool_use');
      if (!toolBlock || toolBlock.type !== 'tool_use') {
        return NextResponse.json({ error: 'Haiku did not produce structured output.' }, { status: 502 });
      }
      parsed = toolBlock.input as ParsedApplicability;

      // Cache the parse globally.
      await supabaseAdmin
        .from('aft_ad_applicability_cache')
        .insert({ ad_number: ad.ad_number, source_hash: sourceHash, parsed });
    }

    const verdict = computeVerdict(parsed, aircraft || {}, equipment);

    const now = new Date().toISOString();
    await supabaseAdmin
      .from('aft_airworthiness_directives')
      .update({
        applicability_status: verdict.status,
        applicability_reason: verdict.reason,
        applicability_checked_at: now,
      })
      .eq('id', ad.id);

    return NextResponse.json({
      status: verdict.status,
      reason: verdict.reason,
      parsed,
      fromCache,
    });
  } catch (error) { return handleApiError(error); }
}

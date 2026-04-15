import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

// Claude Sonnet 4.6 pricing (USD per million tokens)
const PRICE_PER_MTOK = {
  input: 3,
  output: 15,
  cache_read: 0.3,
  cache_create: 3.75,
};

function costUsd(tokens: { input: number; output: number; cache_read: number; cache_create: number }) {
  return (
    (tokens.input * PRICE_PER_MTOK.input) / 1_000_000 +
    (tokens.output * PRICE_PER_MTOK.output) / 1_000_000 +
    (tokens.cache_read * PRICE_PER_MTOK.cache_read) / 1_000_000 +
    (tokens.cache_create * PRICE_PER_MTOK.cache_create) / 1_000_000
  );
}

function dayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

export async function GET(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    const { data: threads, error: tErr } = await supabaseAdmin
      .from('aft_chuck_threads')
      .select('id, aircraft_id')
      .eq('user_id', user.id);
    if (tErr) throw tErr;

    if (!threads || threads.length === 0) {
      return NextResponse.json({
        totals: { input: 0, output: 0, cache_read: 0, cache_create: 0, messages: 0, cost_usd: 0 },
        perDay: [],
        perAircraft: [],
        range_days: 30,
      });
    }

    const threadIds = threads.map(t => t.id);
    const threadToAircraft = new Map<string, string>(threads.map(t => [t.id, t.aircraft_id]));

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: messages, error: mErr } = await supabaseAdmin
      .from('aft_chuck_messages')
      .select('thread_id, created_at, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens')
      .in('thread_id', threadIds)
      .eq('role', 'assistant')
      .gte('created_at', thirtyDaysAgo);
    if (mErr) throw mErr;

    // Fetch aircraft tail numbers for labeling
    const aircraftIds = Array.from(new Set(threads.map(t => t.aircraft_id)));
    const { data: aircraft } = await supabaseAdmin
      .from('aft_aircraft')
      .select('id, tail_number')
      .in('id', aircraftIds);
    const tailById = new Map<string, string>((aircraft || []).map(a => [a.id, a.tail_number]));

    const totals = { input: 0, output: 0, cache_read: 0, cache_create: 0, messages: 0, cost_usd: 0 };
    const perDay = new Map<string, { input: number; output: number; cache_read: number; cache_create: number; messages: number }>();
    const perAircraft = new Map<string, { aircraft_id: string; tail_number: string; input: number; output: number; cache_read: number; cache_create: number; messages: number }>();

    for (const m of messages || []) {
      const input = m.input_tokens || 0;
      const output = m.output_tokens || 0;
      const cacheRead = m.cache_read_tokens || 0;
      const cacheCreate = m.cache_create_tokens || 0;

      totals.input += input;
      totals.output += output;
      totals.cache_read += cacheRead;
      totals.cache_create += cacheCreate;
      totals.messages += 1;

      const d = dayKey(m.created_at);
      const dayBucket = perDay.get(d) || { input: 0, output: 0, cache_read: 0, cache_create: 0, messages: 0 };
      dayBucket.input += input;
      dayBucket.output += output;
      dayBucket.cache_read += cacheRead;
      dayBucket.cache_create += cacheCreate;
      dayBucket.messages += 1;
      perDay.set(d, dayBucket);

      const aId = threadToAircraft.get(m.thread_id);
      if (aId) {
        const acBucket = perAircraft.get(aId) || {
          aircraft_id: aId,
          tail_number: tailById.get(aId) || aId,
          input: 0, output: 0, cache_read: 0, cache_create: 0, messages: 0,
        };
        acBucket.input += input;
        acBucket.output += output;
        acBucket.cache_read += cacheRead;
        acBucket.cache_create += cacheCreate;
        acBucket.messages += 1;
        perAircraft.set(aId, acBucket);
      }
    }

    totals.cost_usd = costUsd(totals);

    const perDayArr = Array.from(perDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({ day, ...v, cost_usd: costUsd(v) }));

    const perAircraftArr = Array.from(perAircraft.values())
      .map(v => ({ ...v, cost_usd: costUsd(v) }))
      .sort((a, b) => b.cost_usd - a.cost_usd);

    return NextResponse.json({
      totals,
      perDay: perDayArr,
      perAircraft: perAircraftArr,
      range_days: 30,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

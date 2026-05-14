import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Claude Haiku 4.5 pricing (USD per million tokens)
const PRICE_PER_MTOK = {
  input: 1,
  output: 5,
  cache_read: 0.1,
  cache_create: 1.25,
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

    // Howard is per-user now (migration 017). One thread per user;
    // aircraft_id is no longer on the threads table.
    const { data: threads, error: tErr } = await supabaseAdmin
      .from('aft_howard_threads')
      .select('id')
      .eq('user_id', user.id);
    if (tErr) throw tErr;

    if (!threads || threads.length === 0) {
      return NextResponse.json({
        totals: { input: 0, output: 0, cache_read: 0, cache_create: 0, messages: 0, cost_usd: 0 },
        perDay: [],
        range_days: 30,
      });
    }

    const threadIds = threads.map(t => t.id);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: messages, error: mErr } = await supabaseAdmin
      .from('aft_howard_messages')
      .select('thread_id, created_at, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens')
      .in('thread_id', threadIds)
      .eq('role', 'assistant')
      .gte('created_at', thirtyDaysAgo);
    if (mErr) throw mErr;

    const totals = { input: 0, output: 0, cache_read: 0, cache_create: 0, messages: 0, cost_usd: 0 };
    const perDay = new Map<string, { input: number; output: number; cache_read: number; cache_create: number; messages: number }>();

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
    }

    totals.cost_usd = costUsd(totals);

    const perDayArr = Array.from(perDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({ day, ...v, cost_usd: costUsd(v) }));

    return NextResponse.json({
      totals,
      perDay: perDayArr,
      range_days: 30,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}

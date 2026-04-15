import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { syncAdsForAircraft } from '@/lib/drs';
import { env } from '@/lib/env';

export const maxDuration = 300; // Vercel cron — up to 5 min

// Vercel cron hits this endpoint on schedule. Secured by CRON_SECRET
// (same pattern as /api/cron/mx-reminders).
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: aircraft } = await supabaseAdmin
    .from('aft_aircraft')
    .select('id, make, model, aircraft_type, engine_type')
    .is('deleted_at', null);

  if (!aircraft || aircraft.length === 0) {
    return NextResponse.json({ success: true, note: 'No aircraft to sync' });
  }

  const results: Array<{ tail: string; inserted: number; updated: number; skipped: number; error?: string }> = [];

  // Sequential — keeps the load on the FAA feed gentle and avoids
  // running out of Vercel cron execution time.
  for (const ac of aircraft) {
    const r = await syncAdsForAircraft(supabaseAdmin, ac);
    results.push({ tail: (ac as any).tail_number || ac.id, ...r });
  }

  const totals = results.reduce(
    (acc, r) => ({
      inserted: acc.inserted + r.inserted,
      updated: acc.updated + r.updated,
      skipped: acc.skipped + r.skipped,
      errors: acc.errors + (r.error ? 1 : 0),
    }),
    { inserted: 0, updated: 0, skipped: 0, errors: 0 }
  );

  return NextResponse.json({ success: true, totals, results });
}

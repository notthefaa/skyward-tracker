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

  const { data: aircraft, error: fleetErr } = await supabaseAdmin
    .from('aft_aircraft')
    .select('id, tail_number, make, model, aircraft_type, engine_type')
    .is('deleted_at', null);

  if (fleetErr) {
    // Don't return success when we never even loaded the fleet — the cron
    // dashboard would otherwise show green while no aircraft was synced.
    console.error('[cron/ads-sync] failed to load fleet', fleetErr);
    return NextResponse.json({ error: 'Failed to load fleet', detail: fleetErr.message }, { status: 500 });
  }
  if (!aircraft || aircraft.length === 0) {
    return NextResponse.json({ success: true, note: 'No aircraft to sync' });
  }

  const results: Array<{ tail: string; inserted: number; updated: number; skipped: number; error?: string }> = [];

  // Sequential — keeps the load on the FAA feed gentle and avoids
  // running out of Vercel cron execution time. Wrapped in try/catch so
  // a single aircraft blowing up (e.g. DRS endpoint HTML-ing out) can't
  // kill the run for the rest of the fleet.
  for (const ac of aircraft) {
    try {
      const r = await syncAdsForAircraft(supabaseAdmin, ac);
      results.push({ tail: (ac as any).tail_number || ac.id, ...r });
    } catch (err: any) {
      results.push({
        tail: (ac as any).tail_number || ac.id,
        inserted: 0,
        updated: 0,
        skipped: 0,
        error: err?.message || 'Sync threw an uncaught exception',
      });
    }
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

  // Errors went to results[] but would otherwise be invisible until the
  // next operator reads the response. Log them so Vercel captures them
  // in the cron run output / log drain.
  if (totals.errors > 0) {
    const failures = results.filter(r => r.error).map(r => `${r.tail}: ${r.error}`);
    console.error(`[cron/ads-sync] ${totals.errors} aircraft failed to sync:`, failures);
  }

  return NextResponse.json({ success: true, totals, results });
}

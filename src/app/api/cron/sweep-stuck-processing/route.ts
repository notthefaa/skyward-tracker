import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { env } from '@/lib/env';

// Small ceiling — this cron just runs an UPDATE, no embedding work.
export const maxDuration = 60;
export const runtime = 'nodejs';

// Rows older than this that are still `status='processing'` are
// considered stuck. Must exceed `maxDuration` on /api/documents (300 s
// = 5 min) by a safety margin so we never flip a row whose `after()`
// is legitimately still running.
const STUCK_THRESHOLD_MS = 6 * 60 * 1000; // 6 min

/**
 * Watchdog for the document-indexing pipeline.
 *
 * The /api/documents POST route schedules pdf-parse + OpenAI
 * embeddings inside Next's `after()`, bounded by `maxDuration=300 s`.
 * Most of the time the work finishes inside that window and flips
 * the row to 'ready' / 'error' via `failDocument`. But:
 *   • Vercel can reclaim the function container mid-`after()` (cold
 *     restart, region migration) — there's no resumability and the
 *     row stays at 'processing' forever.
 *   • `failDocument`'s own status-flip can transient-error out (with
 *     its 3× retry exhausted), same outcome.
 * Without this sweep, the client-side watcher polls those rows
 * forever and the user sees a permanent spinner.
 *
 * Behaviour: SELECT rows with `status='processing'` and
 * `created_at < now() - 6 min`, UPDATE them to `status='error'`,
 * remove their storage object. The watcher will then surface the
 * 'processing → error' toast on its next poll, prompting the user to
 * re-upload. The user's re-upload of the same SHA hits the dup-check
 * reclaim path which lets them through cleanly.
 *
 * Schedule: every hour. Worst-case stuck-to-visible window is
 * `STUCK_THRESHOLD_MS + 1 h ≈ 66 min` — bounded and recoverable.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get('dry') === '1';
  const supabaseAdmin = createAdminClient();
  const cutoffIso = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();

  const { data: stuck, error: selectErr } = await supabaseAdmin
    .from('aft_documents')
    .select('id, filename, file_url, aircraft_id, created_at')
    .eq('status', 'processing')
    .lt('created_at', cutoffIso)
    .is('deleted_at', null);

  if (selectErr) {
    console.error('[cron/sweep-stuck-processing] SELECT failed:', selectErr.message);
    return NextResponse.json(
      { error: 'SELECT failed', detail: selectErr.message },
      { status: 500 },
    );
  }

  const rows = stuck || [];
  let flipped = 0;
  let storageCleaned = 0;
  const errors: string[] = [];

  if (!dryRun) {
    for (const row of rows) {
      const { error: updErr } = await supabaseAdmin
        .from('aft_documents')
        .update({ status: 'error' })
        .eq('id', row.id)
        // Defense-in-depth: only flip rows still at 'processing'.
        // If a row finished between SELECT and UPDATE, the additional
        // status filter makes the UPDATE no-op instead of clobbering.
        .eq('status', 'processing');
      if (updErr) {
        console.error('[cron/sweep-stuck-processing] flip failed for', row.id, updErr.message);
        errors.push(`flip ${row.id}: ${updErr.message}`);
        continue;
      }
      flipped++;

      // Remove the storage object. Extract path from file_url.
      const oldPath = (row as { file_url?: string }).file_url?.match(/\/aft_aircraft_documents\/(.+)$/)?.[1];
      if (oldPath) {
        const { error: rmErr } = await supabaseAdmin.storage.from('aft_aircraft_documents').remove([oldPath]);
        if (rmErr) {
          console.error('[cron/sweep-stuck-processing] storage remove failed for', oldPath, rmErr.message);
          errors.push(`storage ${row.id}: ${rmErr.message}`);
        } else {
          storageCleaned++;
        }
      }

      // Partial chunks may exist. Clear them so Howard's RAG doesn't
      // serve incomplete content.
      const { error: chunkErr } = await supabaseAdmin
        .from('aft_document_chunks')
        .delete()
        .eq('document_id', row.id);
      if (chunkErr) {
        console.error('[cron/sweep-stuck-processing] chunk delete failed for', row.id, chunkErr.message);
        errors.push(`chunks ${row.id}: ${chunkErr.message}`);
      }
    }
  }

  const summary = {
    success: true,
    dryRun,
    cutoffIso,
    foundStuck: rows.length,
    flipped,
    storageCleaned,
    errors: errors.length ? errors : undefined,
    docs: rows.map((r) => ({
      id: r.id,
      filename: (r as { filename: string }).filename,
      aircraft_id: (r as { aircraft_id: string }).aircraft_id,
      ageMin: Math.round((Date.now() - Date.parse((r as { created_at: string }).created_at)) / 60_000),
    })),
  };
  console.log('[cron/sweep-stuck-processing]', summary);
  return NextResponse.json(summary);
}

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { logError } from '@/lib/requestId';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

// 5 minute ceiling — a fleet with thousands of docs would otherwise let
// the next scheduled tick overlap. The work is naturally idempotent
// (re-running can only catch more orphans), so a Vercel kill mid-run
// just defers the rest to tomorrow.
export const maxDuration = 300;

const BUCKET = 'aft_aircraft_documents';
// 24 h grace period — generous enough to cover the slow tail of a
// step-2 upload + step-3 register flow, plus any user who closes the
// tab between steps and re-opens later. Even a 60s-cellular upload of
// a 30 MB PDF + the parse + embed loop on the server finishes well
// inside an hour; 24h gives users with stalled retries time to recover.
const ORPHAN_WINDOW_MS = 24 * 60 * 60 * 1000;
const LIST_PAGE_SIZE = 1000;
const SELECT_PAGE_SIZE = 1000;
const DELETE_BATCH_SIZE = 100;

/**
 * Sweep orphan storage objects in `aft_aircraft_documents`.
 *
 * The direct-upload flow (browser → Supabase Storage → register) leaves
 * an orphan PDF in the bucket whenever a user closes the tab between
 * step 2 (storage upload) and step 3 (register). This cron runs once a
 * day and removes any storage object that:
 *   • has no matching aft_documents row (live OR soft-deleted — we
 *     keep storage for soft-deleted rows so an admin can audit), AND
 *   • was created more than ORPHAN_WINDOW_MS ago.
 *
 * Safety: if we somehow load zero document rows but the bucket has
 * objects, refuse to delete anything — that's a strong "your SELECT
 * is broken" signal, not a legitimate empty state. Without this guard,
 * a transient DB failure would wipe the whole bucket.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get('dry') === '1';
  const supabaseAdmin = createAdminClient();

  // ── Build the set of known storage paths from aft_documents ──
  // Paginated SELECT — Supabase's default page is 1000 rows; for any
  // fleet that's already accumulated more docs than that we'd otherwise
  // false-orphan everything past row 1000.
  const knownPaths = new Set<string>();
  let knownLoadedRows = 0;
  let docOffset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: docs, error: docsErr } = await supabaseAdmin
      .from('aft_documents')
      .select('file_url')
      .range(docOffset, docOffset + SELECT_PAGE_SIZE - 1);
    if (docsErr) {
      logError('[cron/sweep-document-orphans] failed to load docs', docsErr, { route: 'cron/sweep-document-orphans' });
      return NextResponse.json(
        { error: 'Failed to load docs', detail: docsErr.message },
        { status: 500 },
      );
    }
    if (!docs || docs.length === 0) break;
    for (const row of docs) {
      knownLoadedRows++;
      const url = (row as { file_url: string | null }).file_url;
      if (!url) continue;
      // file_url shape: `https://<project>.supabase.co/storage/v1/object/public/aft_aircraft_documents/<path>`.
      // Extract everything after the bucket name; that's what
      // Storage.list() returns in the `name` field.
      const m = url.match(/\/aft_aircraft_documents\/(.+)$/);
      if (m) knownPaths.add(m[1]);
    }
    if (docs.length < SELECT_PAGE_SIZE) break;
    docOffset += SELECT_PAGE_SIZE;
  }

  // ── Walk the bucket, identify orphans ──
  const cutoff = Date.now() - ORPHAN_WINDOW_MS;
  const orphansToDelete: string[] = [];
  let scanned = 0;
  let tooYoung = 0;
  let listOffset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: objects, error: listErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .list('', { limit: LIST_PAGE_SIZE, offset: listOffset });
    if (listErr) {
      logError('[cron/sweep-document-orphans] list failed', listErr, { route: 'cron/sweep-document-orphans' });
      return NextResponse.json(
        { error: 'List failed', detail: listErr.message, scanned, found_orphans: orphansToDelete.length },
        { status: 500 },
      );
    }
    if (!objects || objects.length === 0) break;

    for (const obj of objects) {
      scanned++;
      if (!obj.name) continue;
      if (knownPaths.has(obj.name)) continue;
      const createdAt = obj.created_at ? Date.parse(obj.created_at) : NaN;
      if (!Number.isFinite(createdAt) || createdAt > cutoff) {
        tooYoung++;
        continue;
      }
      orphansToDelete.push(obj.name);
    }

    if (objects.length < LIST_PAGE_SIZE) break;
    listOffset += LIST_PAGE_SIZE;
  }

  // ── Safety: don't wipe the bucket on a broken SELECT ──
  // If we loaded zero document rows but the bucket has more than a few
  // objects, something's wrong. Refuse the run.
  if (knownLoadedRows === 0 && scanned > 5) {
    logError(
      '[cron/sweep-document-orphans] aborting: loaded 0 doc rows but bucket has objects — refusing to delete',
      new Error('zero doc rows / non-empty bucket'),
      { route: 'cron/sweep-document-orphans', extra: { scanned } },
    );
    return NextResponse.json(
      {
        error: 'Refused to delete: zero document rows loaded but bucket has objects. Likely a SELECT failure.',
        scanned,
        found_orphans: orphansToDelete.length,
      },
      { status: 500 },
    );
  }

  // ── Delete in batches ──
  let deleted = 0;
  const deleteErrors: string[] = [];
  if (!dryRun) {
    for (let i = 0; i < orphansToDelete.length; i += DELETE_BATCH_SIZE) {
      const batch = orphansToDelete.slice(i, i + DELETE_BATCH_SIZE);
      const { error: rmErr } = await supabaseAdmin.storage.from(BUCKET).remove(batch);
      if (rmErr) {
        logError('[cron/sweep-document-orphans] remove batch failed', rmErr, { route: 'cron/sweep-document-orphans' });
        deleteErrors.push(rmErr.message);
      } else {
        deleted += batch.length;
      }
    }
  }

  const summary = {
    success: true,
    dryRun,
    docRowsLoaded: knownLoadedRows,
    knownPaths: knownPaths.size,
    scanned,
    tooYoung,
    found_orphans: orphansToDelete.length,
    deleted,
    deleteErrors: deleteErrors.length ? deleteErrors : undefined,
  };
  console.log('[cron/sweep-document-orphans]', summary);
  return NextResponse.json(summary);
}

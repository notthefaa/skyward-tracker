import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';
import {
  READ_RECEIPT_RETENTION_DAYS,
  NOTE_RETENTION_MONTHS,
  FLIGHT_LOG_RETENTION_YEARS,
  MX_COMPLETE_RETENTION_MONTHS,
  MX_CANCELLED_RETENTION_MONTHS,
} from '@/lib/constants';
import { ORPHAN_SWEEP_MIN_AGE_MS, shouldDeferOrphanSweep } from '@/lib/orphanSweeper';

export const dynamic = 'force-dynamic';

/**
 * Lists ALL files in a storage bucket using pagination.
 * Supabase limits `.list()` to 1000 items, so we page through.
 */
async function listAllFiles(
  supabaseAdmin: any,
  bucket: string
) {
  const allFiles: { name: string; created_at?: string | null }[] = [];
  const pageSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data } = await supabaseAdmin.storage.from(bucket).list('', {
      limit: pageSize,
      offset,
    });
    if (data && data.length > 0) {
      allFiles.push(...data);
      offset += data.length;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  return allFiles;
}

/**
 * Sweeps a storage bucket for orphaned files not referenced in the
 * active URLs set. Files newer than ORPHAN_SWEEP_MIN_AGE_MS are
 * deferred to the next sweep so an upload-in-progress isn't deleted
 * before its row commits.
 */
async function sweepBucket(
  supabaseAdmin: any,
  bucket: string,
  activeUrls: Set<string>
) {
  const files = await listAllFiles(supabaseAdmin, bucket);
  const filesToDelete: string[] = [];
  const now = Date.now();

  for (const f of files) {
    if (f.name === '.emptyFolderPlaceholder') continue;
    if (shouldDeferOrphanSweep(f.created_at, now, ORPHAN_SWEEP_MIN_AGE_MS)) continue;
    const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(f.name);
    if (!activeUrls.has(data.publicUrl)) {
      filesToDelete.push(f.name);
    }
  }

  if (filesToDelete.length > 0) {
    for (let i = 0; i < filesToDelete.length; i += 1000) {
      const batch = filesToDelete.slice(i, i + 1000);
      await supabaseAdmin.storage.from(bucket).remove(batch);
    }
  }

  return filesToDelete.length;
}

// GET — read-only stats. Returns row counts for the same tables the
// POST cleanup tracks, so the admin UI can show a live picture
// before deciding to run a destructive purge. No writes, still
// requires global admin.
export async function GET(req: Request) {
  try {
    const { supabaseAdmin } = await requireAuth(req, 'admin');
    const tables = [
      'aft_aircraft', 'aft_flight_logs', 'aft_maintenance_items',
      'aft_squawks', 'aft_notes', 'aft_note_reads',
      'aft_maintenance_events', 'aft_event_line_items', 'aft_event_messages',
      'aft_user_roles', 'aft_user_aircraft_access',
      'aft_reservations', 'aft_notification_preferences',
    ];
    const countResults = await Promise.all(
      tables.map(async (table) => {
        const { count } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
        return { table, count: count || 0 };
      }),
    );
    const counts: Record<string, number> = {};
    for (const { table, count } of countResults) counts[table] = count;
    return NextResponse.json({ table_row_counts: counts });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: Request) {
  try {
    const { supabaseAdmin } = await requireAuth(req, 'admin');

    const results: Record<string, any> = {};

    // ==========================================
    // 1. PURGE OLD READ RECEIPTS
    // ==========================================
    const readReceiptCutoff = new Date();
    readReceiptCutoff.setDate(readReceiptCutoff.getDate() - READ_RECEIPT_RETENTION_DAYS);
    const { count: readReceiptsPurged } = await supabaseAdmin
      .from('aft_note_reads')
      .delete({ count: 'exact' })
      .lt('read_at', readReceiptCutoff.toISOString());
    results.read_receipts_purged = readReceiptsPurged || 0;

    // ==========================================
    // 2. PURGE OLD NOTES
    // ==========================================
    const noteCutoff = new Date();
    noteCutoff.setMonth(noteCutoff.getMonth() - NOTE_RETENTION_MONTHS);
    const { count: notesPurged } = await supabaseAdmin
      .from('aft_notes')
      .delete({ count: 'exact' })
      .lt('created_at', noteCutoff.toISOString());
    results.notes_purged = notesPurged || 0;

    // ==========================================
    // 3. SQUAWKS — kept forever (no purge)
    // ==========================================
    results.resolved_squawks_purged = 0;

    // ==========================================
    // 4. PURGE OLD COMPLETED MX EVENTS + CANCELLED EVENTS
    // ==========================================
    const completedCutoff = new Date();
    completedCutoff.setMonth(completedCutoff.getMonth() - MX_COMPLETE_RETENTION_MONTHS);
    const cancelledCutoff = new Date();
    cancelledCutoff.setMonth(cancelledCutoff.getMonth() - MX_CANCELLED_RETENTION_MONTHS);

    const [{ data: oldCompletedEvents }, { data: oldCancelledEvents }] = await Promise.all([
      supabaseAdmin
        .from('aft_maintenance_events')
        .select('id')
        .eq('status', 'complete')
        .lt('completed_at', completedCutoff.toISOString()),
      supabaseAdmin
        .from('aft_maintenance_events')
        .select('id')
        .eq('status', 'cancelled')
        .lt('created_at', cancelledCutoff.toISOString()),
    ]);

    const eventIdsToClean = [
      ...(oldCompletedEvents || []).map((e: any) => e.id),
      ...(oldCancelledEvents || []).map((e: any) => e.id),
    ];

    let lineItemsPurged = 0;
    let messagesPurged = 0;
    let eventsPurged = 0;

    if (eventIdsToClean.length > 0) {
      // Delete children first, then events — all in parallel where safe
      const [liResult, msgResult] = await Promise.all([
        supabaseAdmin
          .from('aft_event_line_items')
          .delete({ count: 'exact' })
          .in('event_id', eventIdsToClean),
        supabaseAdmin
          .from('aft_event_messages')
          .delete({ count: 'exact' })
          .in('event_id', eventIdsToClean),
      ]);
      lineItemsPurged = liResult.count || 0;
      messagesPurged = msgResult.count || 0;

      const { count: evCount } = await supabaseAdmin
        .from('aft_maintenance_events')
        .delete({ count: 'exact' })
        .in('id', eventIdsToClean);
      eventsPurged = evCount || 0;
    }

    results.mx_events_purged = eventsPurged;
    results.mx_line_items_purged = lineItemsPurged;
    results.mx_messages_purged = messagesPurged;

    // ==========================================
    // 5. PURGE ORPHANED CHILD RECORDS (SQL-based)
    // Use LEFT JOIN via RPC or filter approach to avoid
    // loading entire tables into memory
    // ==========================================

    // Orphaned messages: messages whose event_id no longer exists
    // We use a two-step approach: get event IDs, then find messages not in that set.
    //
    // SAFETY: throw on any read error before the destructive batch. A
    // bare destructure here would let a transient supabase blip make
    // `validEventIds` empty, and the next step would delete every
    // message in the table because none of them would match.
    const { data: allEventIds, error: allEventIdsErr } = await supabaseAdmin
      .from('aft_maintenance_events')
      .select('id');
    if (allEventIdsErr) throw allEventIdsErr;
    const validEventIds = new Set((allEventIds || []).map((e: any) => e.id));

    // For orphan detection, only fetch IDs (not full rows)
    const { data: messageEventIds, error: messageEventIdsErr } = await supabaseAdmin
      .from('aft_event_messages')
      .select('id, event_id');
    if (messageEventIdsErr) throw messageEventIdsErr;

    const orphanedMessageIds = (messageEventIds || [])
      .filter((m: any) => !validEventIds.has(m.event_id))
      .map((m: any) => m.id);

    if (orphanedMessageIds.length > 0) {
      for (let i = 0; i < orphanedMessageIds.length; i += 100) {
        const batch = orphanedMessageIds.slice(i, i + 100);
        await supabaseAdmin.from('aft_event_messages').delete().in('id', batch);
      }
    }
    results.orphaned_messages_purged = orphanedMessageIds.length;

    const { data: lineItemEventIds, error: lineItemEventIdsErr } = await supabaseAdmin
      .from('aft_event_line_items')
      .select('id, event_id');
    if (lineItemEventIdsErr) throw lineItemEventIdsErr;

    const orphanedLineIds = (lineItemEventIds || [])
      .filter((li: any) => !validEventIds.has(li.event_id))
      .map((li: any) => li.id);

    if (orphanedLineIds.length > 0) {
      for (let i = 0; i < orphanedLineIds.length; i += 100) {
        const batch = orphanedLineIds.slice(i, i + 100);
        await supabaseAdmin.from('aft_event_line_items').delete().in('id', batch);
      }
    }
    results.orphaned_line_items_purged = orphanedLineIds.length;

    // ==========================================
    // 6. PURGE ORPHANED ACCESS RECORDS
    // ==========================================
    const { data: allAircraft, error: allAircraftErr } = await supabaseAdmin
      .from('aft_aircraft')
      .select('id');
    if (allAircraftErr) throw allAircraftErr;
    const validAircraftIds = new Set((allAircraft || []).map((a: any) => a.id));

    const { data: allAccess, error: allAccessErr } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('id, aircraft_id');
    if (allAccessErr) throw allAccessErr;

    const orphanedAccessIds = (allAccess || [])
      .filter((a: any) => !validAircraftIds.has(a.aircraft_id))
      .map((a: any) => a.id);

    if (orphanedAccessIds.length > 0) {
      for (let i = 0; i < orphanedAccessIds.length; i += 100) {
        const batch = orphanedAccessIds.slice(i, i + 100);
        await supabaseAdmin.from('aft_user_aircraft_access').delete().in('id', batch);
      }
    }
    results.orphaned_access_purged = orphanedAccessIds.length;

    // ==========================================
    // 7. PURGE OLD FLIGHT LOGS
    // ==========================================
    const flightLogCutoff = new Date();
    flightLogCutoff.setFullYear(flightLogCutoff.getFullYear() - FLIGHT_LOG_RETENTION_YEARS);
    const { count: flightLogsPurged } = await supabaseAdmin
      .from('aft_flight_logs')
      .delete({ count: 'exact' })
      .lt('created_at', flightLogCutoff.toISOString());
    results.flight_logs_purged = flightLogsPurged || 0;

    // ==========================================
    // 8. ORPHANED IMAGE SWEEPER (with pagination)
    // ==========================================

    // SAFETY for the four bucket sweepers below: throw on any read
    // error before we hand the active-set into sweepBucket. A bare
    // destructure that returned `null` on a transient supabase hit
    // would let sweepBucket compute its diff against an empty set and
    // delete every legitimate file in the bucket.

    // --- A. Squawk Images ---
    const { data: squawks, error: squawksErr } = await supabaseAdmin.from('aft_squawks').select('pictures');
    if (squawksErr) throw squawksErr;
    const activeSquawkPics = new Set<string>();
    if (squawks) {
      for (const sq of squawks) {
        if (sq.pictures && Array.isArray(sq.pictures)) {
          for (const pic of sq.pictures) activeSquawkPics.add(pic);
        }
      }
    }
    results.squawk_image_orphans = await sweepBucket(supabaseAdmin, 'aft_squawk_images', activeSquawkPics);

    // --- B. Note Images ---
    const { data: notesForImages, error: notesForImagesErr } = await supabaseAdmin.from('aft_notes').select('pictures');
    if (notesForImagesErr) throw notesForImagesErr;
    const activeNotePics = new Set<string>();
    if (notesForImages) {
      for (const note of notesForImages) {
        if (note.pictures && Array.isArray(note.pictures)) {
          for (const pic of note.pictures) activeNotePics.add(pic);
        }
      }
    }
    results.note_image_orphans = await sweepBucket(supabaseAdmin, 'aft_note_images', activeNotePics);

    // --- C. Aircraft Avatars ---
    const { data: aircraftForAvatars, error: aircraftForAvatarsErr } = await supabaseAdmin.from('aft_aircraft').select('avatar_url');
    if (aircraftForAvatarsErr) throw aircraftForAvatarsErr;
    const activeAvatars = new Set<string>();
    if (aircraftForAvatars) {
      for (const ac of aircraftForAvatars) {
        if (ac.avatar_url && typeof ac.avatar_url === 'string') activeAvatars.add(ac.avatar_url);
      }
    }
    results.avatar_orphans = await sweepBucket(supabaseAdmin, 'aft_aircraft_avatars', activeAvatars);

    // --- D. Event Attachments ---
    const { data: messagesWithAttachments, error: messagesWithAttachmentsErr } = await supabaseAdmin
      .from('aft_event_messages')
      .select('attachments')
      .not('attachments', 'is', null);
    if (messagesWithAttachmentsErr) throw messagesWithAttachmentsErr;
    const activeAttachmentUrls = new Set<string>();
    if (messagesWithAttachments) {
      for (const msg of messagesWithAttachments) {
        if (msg.attachments && Array.isArray(msg.attachments)) {
          for (const att of msg.attachments) {
            if (att.url) activeAttachmentUrls.add(att.url);
          }
        }
      }
    }
    results.event_attachment_orphans = await sweepBucket(supabaseAdmin, 'aft_event_attachments', activeAttachmentUrls);

    // ==========================================
    // 9. TABLE ROW COUNTS (parallelized)
    // ==========================================
    const tables = [
      'aft_aircraft', 'aft_flight_logs', 'aft_maintenance_items',
      'aft_squawks', 'aft_notes', 'aft_note_reads',
      'aft_maintenance_events', 'aft_event_line_items', 'aft_event_messages',
      'aft_user_roles', 'aft_user_aircraft_access',
      'aft_reservations', 'aft_notification_preferences'
    ];

    const countPromises = tables.map(async (table) => {
      const { count } = await supabaseAdmin
        .from(table)
        .select('*', { count: 'exact', head: true });
      return { table, count: count || 0 };
    });

    const countResults = await Promise.all(countPromises);
    const counts: Record<string, number> = {};
    for (const { table, count } of countResults) {
      counts[table] = count;
    }

    return NextResponse.json({
      success: true,
      cleaned: results,
      table_row_counts: counts,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}

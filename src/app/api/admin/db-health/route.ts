import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

/**
 * Lists ALL files in a storage bucket using pagination.
 * Supabase limits `.list()` to 1000 items, so we page through.
 */
async function listAllFiles(
  supabaseAdmin: any,
  bucket: string
) {
  const allFiles: { name: string }[] = [];
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
 * Sweeps a storage bucket for orphaned files not referenced in the active URLs set.
 */
async function sweepBucket(
  supabaseAdmin: any,
  bucket: string,
  activeUrls: Set<string>
) {
  const files = await listAllFiles(supabaseAdmin, bucket);
  const filesToDelete: string[] = [];

  for (const f of files) {
    if (f.name === '.emptyFolderPlaceholder') continue;
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

export async function POST(req: Request) {
  try {
    const { supabaseAdmin } = await requireAuth(req, 'admin');

    const results: Record<string, any> = {};

    // ==========================================
    // 1. PURGE OLD READ RECEIPTS (30 Days)
    // ==========================================
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { count: readReceiptsPurged } = await supabaseAdmin
      .from('aft_note_reads')
      .delete({ count: 'exact' })
      .lt('read_at', thirtyDaysAgo.toISOString());
    results.read_receipts_purged = readReceiptsPurged || 0;

    // ==========================================
    // 2. PURGE OLD NOTES (6 Months)
    // ==========================================
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const { count: notesPurged } = await supabaseAdmin
      .from('aft_notes')
      .delete({ count: 'exact' })
      .lt('created_at', sixMonthsAgo.toISOString());
    results.notes_purged = notesPurged || 0;

    // ==========================================
    // 3. SQUAWKS — kept forever (no purge)
    // ==========================================
    results.resolved_squawks_purged = 0;

    // ==========================================
    // 4. PURGE OLD COMPLETED MX EVENTS (12 Months)
    //    + CANCELLED EVENTS (3 Months)
    // ==========================================
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const { data: oldCompletedEvents } = await supabaseAdmin
      .from('aft_maintenance_events')
      .select('id')
      .eq('status', 'complete')
      .lt('completed_at', oneYearAgo.toISOString());

    const { data: oldCancelledEvents } = await supabaseAdmin
      .from('aft_maintenance_events')
      .select('id')
      .eq('status', 'cancelled')
      .lt('created_at', threeMonthsAgo.toISOString());

    const eventIdsToClean = [
      ...(oldCompletedEvents || []).map((e: any) => e.id),
      ...(oldCancelledEvents || []).map((e: any) => e.id),
    ];

    let lineItemsPurged = 0;
    let messagesPurged = 0;
    let eventsPurged = 0;

    if (eventIdsToClean.length > 0) {
      const { count: liCount } = await supabaseAdmin
        .from('aft_event_line_items')
        .delete({ count: 'exact' })
        .in('event_id', eventIdsToClean);
      lineItemsPurged = liCount || 0;

      const { count: msgCount } = await supabaseAdmin
        .from('aft_event_messages')
        .delete({ count: 'exact' })
        .in('event_id', eventIdsToClean);
      messagesPurged = msgCount || 0;

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
    // 5. PURGE ORPHANED CHILD RECORDS
    // ==========================================
    const { data: allEventIds } = await supabaseAdmin
      .from('aft_maintenance_events')
      .select('id');
    const validEventIds = new Set((allEventIds || []).map((e: any) => e.id));

    const { data: allMessages } = await supabaseAdmin
      .from('aft_event_messages')
      .select('id, event_id');
    const orphanedMessageIds = (allMessages || [])
      .filter((m: any) => !validEventIds.has(m.event_id))
      .map((m: any) => m.id);

    if (orphanedMessageIds.length > 0) {
      await supabaseAdmin
        .from('aft_event_messages')
        .delete()
        .in('id', orphanedMessageIds);
    }
    results.orphaned_messages_purged = orphanedMessageIds.length;

    const { data: allLineItems } = await supabaseAdmin
      .from('aft_event_line_items')
      .select('id, event_id');
    const orphanedLineIds = (allLineItems || [])
      .filter((li: any) => !validEventIds.has(li.event_id))
      .map((li: any) => li.id);

    if (orphanedLineIds.length > 0) {
      await supabaseAdmin
        .from('aft_event_line_items')
        .delete()
        .in('id', orphanedLineIds);
    }
    results.orphaned_line_items_purged = orphanedLineIds.length;

    // ==========================================
    // 6. PURGE ORPHANED ACCESS RECORDS
    // ==========================================
    const { data: allAircraft } = await supabaseAdmin
      .from('aft_aircraft')
      .select('id');
    const validAircraftIds = new Set((allAircraft || []).map((a: any) => a.id));

    const { data: allAccess } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('id, aircraft_id');
    const orphanedAccessIds = (allAccess || [])
      .filter((a: any) => !validAircraftIds.has(a.aircraft_id))
      .map((a: any) => a.id);

    if (orphanedAccessIds.length > 0) {
      await supabaseAdmin
        .from('aft_user_aircraft_access')
        .delete()
        .in('id', orphanedAccessIds);
    }
    results.orphaned_access_purged = orphanedAccessIds.length;

    // ==========================================
    // 7. PURGE OLD FLIGHT LOGS (5 Years)
    // ==========================================
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    const { count: flightLogsPurged } = await supabaseAdmin
      .from('aft_flight_logs')
      .delete({ count: 'exact' })
      .lt('created_at', fiveYearsAgo.toISOString());
    results.flight_logs_purged = flightLogsPurged || 0;

    // ==========================================
    // 8. ORPHANED IMAGE SWEEPER (with pagination)
    // ==========================================

    // --- A. Squawk Images ---
    const { data: squawks } = await supabaseAdmin.from('aft_squawks').select('pictures');
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
    const { data: notesForImages } = await supabaseAdmin.from('aft_notes').select('pictures');
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
    const { data: aircraftForAvatars } = await supabaseAdmin.from('aft_aircraft').select('avatar_url');
    const activeAvatars = new Set<string>();
    if (aircraftForAvatars) {
      for (const ac of aircraftForAvatars) {
        if (ac.avatar_url && typeof ac.avatar_url === 'string') activeAvatars.add(ac.avatar_url);
      }
    }
    results.avatar_orphans = await sweepBucket(supabaseAdmin, 'aft_aircraft_avatars', activeAvatars);

    // --- D. Event Attachments ---
    // Collect all attachment URLs from messages that still exist
    const { data: messagesWithAttachments } = await supabaseAdmin
      .from('aft_event_messages')
      .select('attachments')
      .not('attachments', 'is', null);
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
    // 9. TABLE ROW COUNTS (for monitoring)
    // ==========================================
    const counts: Record<string, number> = {};
    const tables = [
      'aft_aircraft', 'aft_flight_logs', 'aft_maintenance_items',
      'aft_squawks', 'aft_notes', 'aft_note_reads',
      'aft_maintenance_events', 'aft_event_line_items', 'aft_event_messages',
      'aft_user_roles', 'aft_user_aircraft_access'
    ];
    for (const table of tables) {
      const { count } = await supabaseAdmin
        .from(table)
        .select('*', { count: 'exact', head: true });
      counts[table] = count || 0;
    }

    return NextResponse.json({
      success: true,
      cleaned: results,
      table_row_counts: counts,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

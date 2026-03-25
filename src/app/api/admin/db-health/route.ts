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
      hasMore = data.length === pageSize; // If we got a full page, there might be more
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
    // Supabase storage.remove() accepts up to 1000 items, batch if needed
    for (let i = 0; i < filesToDelete.length; i += 1000) {
      const batch = filesToDelete.slice(i, i + 1000);
      await supabaseAdmin.storage.from(bucket).remove(batch);
    }
  }

  return filesToDelete.length;
}

export async function POST(req: Request) {
  try {
    // SECURITY: Only admins can run database health checks
    const { supabaseAdmin } = await requireAuth(req, 'admin');

    // ==========================================
    // 1. PURGE OLD READ RECEIPTS (30 Days)
    // ==========================================
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    await supabaseAdmin.from('aft_note_reads').delete().lt('read_at', thirtyDaysAgo.toISOString());

    // ==========================================
    // 2. PURGE OLD NOTES (6 Months)
    // ==========================================
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    await supabaseAdmin.from('aft_notes').delete().lt('created_at', sixMonthsAgo.toISOString());

    // ==========================================
    // 3. ORPHANED IMAGE SWEEPER (with pagination)
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
    const squawkOrphans = await sweepBucket(supabaseAdmin, 'aft_squawk_images', activeSquawkPics);

    // --- B. Note Images ---
    const { data: notes } = await supabaseAdmin.from('aft_notes').select('pictures');
    const activeNotePics = new Set<string>();
    if (notes) {
      for (const note of notes) {
        if (note.pictures && Array.isArray(note.pictures)) {
          for (const pic of note.pictures) activeNotePics.add(pic);
        }
      }
    }
    const noteOrphans = await sweepBucket(supabaseAdmin, 'aft_note_images', activeNotePics);

    // --- C. Aircraft Avatars ---
    const { data: aircraft } = await supabaseAdmin.from('aft_aircraft').select('avatar_url');
    const activeAvatars = new Set<string>();
    if (aircraft) {
      for (const ac of aircraft) {
        if (ac.avatar_url && typeof ac.avatar_url === 'string') activeAvatars.add(ac.avatar_url);
      }
    }
    const avatarOrphans = await sweepBucket(supabaseAdmin, 'aft_aircraft_avatars', activeAvatars);

    return NextResponse.json({
      success: true,
      cleaned: {
        squawk_images: squawkOrphans,
        note_images: noteOrphans,
        avatars: avatarOrphans,
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

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
    // 3. ORPHANED IMAGE SWEEPER
    // ==========================================

    // --- A. Squawk Images Sweep ---
    const { data: squawks } = await supabaseAdmin.from('aft_squawks').select('pictures');
    const activeSquawkPics: string[] =[];
    if (squawks) {
      for (let i = 0; i < squawks.length; i++) {
        const pics = squawks[i].pictures;
        if (pics && Array.isArray(pics)) {
          for (let j = 0; j < pics.length; j++) {
            activeSquawkPics.push(pics[j]);
          }
        }
      }
    }

    const { data: squawkFiles } = await supabaseAdmin.storage.from('aft_squawk_images').list('', { limit: 1000 });
    if (squawkFiles) {
      const filesToDelete: string[] =[];
      for (let i = 0; i < squawkFiles.length; i++) {
        const f = squawkFiles[i];
        if (f.name !== '.emptyFolderPlaceholder') {
          const { data } = supabaseAdmin.storage.from('aft_squawk_images').getPublicUrl(f.name);
          if (activeSquawkPics.indexOf(data.publicUrl) === -1) {
            filesToDelete.push(f.name);
          }
        }
      }
      if (filesToDelete.length > 0) {
        await supabaseAdmin.storage.from('aft_squawk_images').remove(filesToDelete);
      }
    }

    // --- B. Note Images Sweep ---
    const { data: notes } = await supabaseAdmin.from('aft_notes').select('pictures');
    const activeNotePics: string[] =[];
    if (notes) {
      for (let i = 0; i < notes.length; i++) {
        const pics = notes[i].pictures;
        if (pics && Array.isArray(pics)) {
          for (let j = 0; j < pics.length; j++) {
            activeNotePics.push(pics[j]);
          }
        }
      }
    }

    const { data: noteFiles } = await supabaseAdmin.storage.from('aft_note_images').list('', { limit: 1000 });
    if (noteFiles) {
      const filesToDelete: string[] =[];
      for (let i = 0; i < noteFiles.length; i++) {
        const f = noteFiles[i];
        if (f.name !== '.emptyFolderPlaceholder') {
          const { data } = supabaseAdmin.storage.from('aft_note_images').getPublicUrl(f.name);
          if (activeNotePics.indexOf(data.publicUrl) === -1) {
            filesToDelete.push(f.name);
          }
        }
      }
      if (filesToDelete.length > 0) {
        await supabaseAdmin.storage.from('aft_note_images').remove(filesToDelete);
      }
    }

    // --- C. Aircraft Avatars Sweep ---
    const { data: aircraft } = await supabaseAdmin.from('aft_aircraft').select('avatar_url');
    const activeAvatars: string[] =[];
    if (aircraft) {
      for (let i = 0; i < aircraft.length; i++) {
        const url = aircraft[i].avatar_url;
        if (url && typeof url === 'string') {
          activeAvatars.push(url);
        }
      }
    }

    const { data: avatarFiles } = await supabaseAdmin.storage.from('aft_aircraft_avatars').list('', { limit: 1000 });
    if (avatarFiles) {
      const filesToDelete: string[] =[];
      for (let i = 0; i < avatarFiles.length; i++) {
        const f = avatarFiles[i];
        if (f.name !== '.emptyFolderPlaceholder') {
          const { data } = supabaseAdmin.storage.from('aft_aircraft_avatars').getPublicUrl(f.name);
          if (activeAvatars.indexOf(data.publicUrl) === -1) {
            filesToDelete.push(f.name);
          }
        }
      }
      if (filesToDelete.length > 0) {
        await supabaseAdmin.storage.from('aft_aircraft_avatars').remove(filesToDelete);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
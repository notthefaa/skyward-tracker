import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { idempotency } from '@/lib/idempotency';
import { stripProtectedFields, validatePicturesForBucket } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * GET /api/notes?aircraftId=...
 *
 * Returns all non-deleted notes for the aircraft (newest-first), plus
 * upserts aft_note_reads for any notes this caller hasn't yet read.
 * The fetcher used to do this with two direct supabase.from() reads
 * + an upsert; consolidating server-side avoids the iOS GoTrue mutex
 * pressure on every NotesTab open.
 *
 * Response shape: `{ notes, newlyMarkedRead }`. Client uses
 * newlyMarkedRead.length > 0 as the trigger to refresh the unread-
 * badge in AppShell.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const aircraftId = url.searchParams.get('aircraftId');
    if (!aircraftId) return NextResponse.json({ error: 'aircraftId required' }, { status: 400 });

    const { user, supabaseAdmin } = await requireAuth(req);
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    const { data: notes, error: notesErr } = await supabaseAdmin
      .from('aft_notes')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (notesErr) throw notesErr;

    let newlyMarkedRead: string[] = [];
    if (notes && notes.length > 0) {
      const { data: reads, error: readsErr } = await supabaseAdmin
        .from('aft_note_reads')
        .select('note_id')
        .eq('user_id', user.id)
        .in('note_id', notes.map(n => (n as any).id));
      if (readsErr) throw readsErr;
      const readIds = new Set((reads ?? []).map(r => (r as any).note_id));
      const unreadIds = notes.filter(n => !readIds.has((n as any).id)).map(n => (n as any).id);
      if (unreadIds.length > 0) {
        const inserts = unreadIds.map(id => ({ note_id: id, user_id: user.id }));
        const { error: upErr } = await supabaseAdmin
          .from('aft_note_reads')
          .upsert(inserts, { onConflict: 'note_id,user_id' });
        if (upErr) throw upErr;
        newlyMarkedRead = unreadIds as string[];
      }
    }

    return NextResponse.json({ notes: notes ?? [], newlyMarkedRead });
  } catch (error) {
    return handleApiError(error, req);
  }
}

// POST — create note (any user with aircraft access)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const idem = idempotency(supabaseAdmin, user.id, req, 'notes/POST');
    const cached = await idem.check();
    if (cached) return cached;

    const { aircraftId, noteData } = await req.json();
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    const picErr = validatePicturesForBucket(noteData, 'aft_note_images');
    if (picErr) return NextResponse.json({ error: picErr }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    await setAppUser(supabaseAdmin, user.id);
    // Strip server-owned fields; aircraft_id + author_id are set
    // authoritatively so client-supplied values for those can't leak
    // through into the insert.
    const safeNote = stripProtectedFields(noteData);
    const { data: inserted, error } = await supabaseAdmin
      .from('aft_notes')
      .insert({ ...safeNote, aircraft_id: aircraftId, author_id: user.id })
      .select('id')
      .single();
    if (error) throw error;

    const body = { success: true, noteId: inserted?.id };
    await idem.save(200, body);
    return NextResponse.json(body);
  } catch (error) { return handleApiError(error, req); }
}

// PUT — edit note (author or aircraft admin).
// SECURITY: must verify the note's aircraft_id matches the caller-
// supplied aircraftId before the admin check. See the matching squawks
// route for the full rationale.
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const idem = idempotency(supabaseAdmin, user.id, req, 'notes/PUT');
    const cached = await idem.check();
    if (cached) return cached;
    const { noteId, aircraftId, noteData } = await req.json();
    if (!noteId || !aircraftId) return NextResponse.json({ error: 'Note ID and Aircraft ID required.' }, { status: 400 });

    const { data: note, error: readErr } = await supabaseAdmin
      .from('aft_notes')
      .select('author_id, aircraft_id, deleted_at')
      .eq('id', noteId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!note || note.deleted_at) return NextResponse.json({ error: 'Note not found.' }, { status: 404 });
    if (note.aircraft_id !== aircraftId) {
      return NextResponse.json({ error: 'Note does not belong to the given aircraft.' }, { status: 403 });
    }

    const isAuthor = note.author_id === user.id;
    if (!isAuthor) {
      await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    } else {
      await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);
    }

    await setAppUser(supabaseAdmin, user.id);
    // Prevent a PUT from migrating the note across aircraft (bypassing
    // the access check) or resurrecting a soft-delete. Filter the UPDATE
    // by aircraft_id + deleted_at to close the read-then-update race
    // window where a soft-delete could land between the two ops.
    const picErr = validatePicturesForBucket(noteData, 'aft_note_images');
    if (picErr) return NextResponse.json({ error: picErr }, { status: 400 });
    const safeUpdate = stripProtectedFields(noteData);
    const { error } = await supabaseAdmin
      .from('aft_notes')
      .update(safeUpdate)
      .eq('id', noteId)
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null);
    if (error) throw error;

    const ok = { success: true };
    await idem.save(200, ok);
    return NextResponse.json(ok);
  } catch (error) { return handleApiError(error, req); }
}

// DELETE — soft-delete note (author or aircraft admin).
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const idem = idempotency(supabaseAdmin, user.id, req, 'notes/DELETE');
    const cached = await idem.check();
    if (cached) return cached;
    const { noteId, aircraftId } = await req.json();
    if (!noteId || !aircraftId) return NextResponse.json({ error: 'Note ID and Aircraft ID required.' }, { status: 400 });

    const { data: note, error: readErr } = await supabaseAdmin
      .from('aft_notes')
      .select('author_id, aircraft_id, deleted_at')
      .eq('id', noteId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!note || note.deleted_at) return NextResponse.json({ error: 'Note not found.' }, { status: 404 });
    if (note.aircraft_id !== aircraftId) {
      return NextResponse.json({ error: 'Note does not belong to the given aircraft.' }, { status: 403 });
    }

    const isAuthor = note.author_id === user.id;
    if (!isAuthor) {
      await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    } else {
      await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);
    }

    await setAppUser(supabaseAdmin, user.id);
    // Belt-and-suspenders scoping — re-pin the soft-delete to the same
    // (aircraft_id, deleted_at IS NULL) the read-side gates verified,
    // so a race-window mutation between verification and write can't
    // slip a cross-aircraft delete or re-tombstone a deleted row.
    const { error } = await supabaseAdmin
      .from('aft_notes')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', noteId)
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null);
    if (error) throw error;

    const ok = { success: true };
    await idem.save(200, ok);
    return NextResponse.json(ok);
  } catch (error) { return handleApiError(error, req); }
}

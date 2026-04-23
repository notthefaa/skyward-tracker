import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';
import { idempotency } from '@/lib/idempotency';
import { stripProtectedFields } from '@/lib/validation';

// POST — create note (any user with aircraft access)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const idem = idempotency(supabaseAdmin, user.id, req, 'notes/POST');
    const cached = await idem.check();
    if (cached) return cached;

    const { aircraftId, noteData } = await req.json();
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    await setAppUser(supabaseAdmin, user.id);
    // Strip server-owned fields; aircraft_id + author_id are set
    // authoritatively so client-supplied values for those can't leak
    // through into the insert.
    const safeNote = stripProtectedFields(noteData);
    const { error } = await supabaseAdmin.from('aft_notes').insert({ ...safeNote, aircraft_id: aircraftId, author_id: user.id });
    if (error) throw error;

    const body = { success: true };
    await idem.save(200, body);
    return NextResponse.json(body);
  } catch (error) { return handleApiError(error); }
}

// PUT — edit note (author or aircraft admin).
// SECURITY: must verify the note's aircraft_id matches the caller-
// supplied aircraftId before the admin check. See the matching squawks
// route for the full rationale.
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { noteId, aircraftId, noteData } = await req.json();
    if (!noteId || !aircraftId) return NextResponse.json({ error: 'Note ID and Aircraft ID required.' }, { status: 400 });

    const { data: note } = await supabaseAdmin
      .from('aft_notes')
      .select('author_id, aircraft_id, deleted_at')
      .eq('id', noteId)
      .maybeSingle();
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
    // the access check) or resurrecting a soft-delete.
    const safeUpdate = stripProtectedFields(noteData);
    const { error } = await supabaseAdmin.from('aft_notes').update(safeUpdate).eq('id', noteId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — soft-delete note (author or aircraft admin).
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { noteId, aircraftId } = await req.json();
    if (!noteId || !aircraftId) return NextResponse.json({ error: 'Note ID and Aircraft ID required.' }, { status: 400 });

    const { data: note } = await supabaseAdmin
      .from('aft_notes')
      .select('author_id, aircraft_id, deleted_at')
      .eq('id', noteId)
      .maybeSingle();
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
    const { error } = await supabaseAdmin
      .from('aft_notes')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', noteId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

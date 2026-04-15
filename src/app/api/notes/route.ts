import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, requireAircraftAdmin, handleApiError } from '@/lib/auth';
import { setAppUser } from '@/lib/audit';

// POST — create note (any user with aircraft access)
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, noteData } = await req.json();
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    await setAppUser(supabaseAdmin, user.id);
    const { error } = await supabaseAdmin.from('aft_notes').insert({ ...noteData, aircraft_id: aircraftId, author_id: user.id });
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// PUT — edit note (author or aircraft admin)
export async function PUT(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { noteId, aircraftId, noteData } = await req.json();
    if (!noteId || !aircraftId) return NextResponse.json({ error: 'Note ID and Aircraft ID required.' }, { status: 400 });

    // Check: must be author or admin
    const { data: note } = await supabaseAdmin.from('aft_notes').select('author_id').eq('id', noteId).single();
    if (!note) return NextResponse.json({ error: 'Note not found.' }, { status: 404 });

    const isAuthor = note.author_id === user.id;
    if (!isAuthor) {
      await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
    }

    await setAppUser(supabaseAdmin, user.id);
    const { error } = await supabaseAdmin.from('aft_notes').update(noteData).eq('id', noteId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

// DELETE — soft-delete note (author or aircraft admin)
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { noteId, aircraftId } = await req.json();
    if (!noteId || !aircraftId) return NextResponse.json({ error: 'Note ID and Aircraft ID required.' }, { status: 400 });

    const { data: note } = await supabaseAdmin.from('aft_notes').select('author_id').eq('id', noteId).single();
    if (!note) return NextResponse.json({ error: 'Note not found.' }, { status: 404 });

    const isAuthor = note.author_id === user.id;
    if (!isAuthor) {
      await requireAircraftAdmin(supabaseAdmin, user.id, aircraftId);
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

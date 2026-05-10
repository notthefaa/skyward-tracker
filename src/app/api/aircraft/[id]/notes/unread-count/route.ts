import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/aircraft/[id]/notes/unread-count
 *
 * Cheap count for the More-tab notes badge. Migrated from two direct
 * supabase reads in AppShell.fetchUnreadNotes (every tail switch).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { user, supabaseAdmin } = await requireAuth(req);
    await requireAircraftAccess(supabaseAdmin, user.id, id);

    const { data: notes, error: notesErr } = await supabaseAdmin
      .from('aft_notes')
      .select('id')
      .eq('aircraft_id', id)
      .is('deleted_at', null);
    if (notesErr) throw notesErr;
    if (!notes || notes.length === 0) {
      return NextResponse.json({ unread: 0 });
    }
    const ids = notes.map(n => (n as any).id);
    const { data: reads, error: readsErr } = await supabaseAdmin
      .from('aft_note_reads')
      .select('note_id')
      .eq('user_id', user.id)
      .in('note_id', ids);
    if (readsErr) throw readsErr;

    return NextResponse.json({ unread: ids.length - (reads?.length ?? 0) });
  } catch (error) {
    return handleApiError(error, req);
  }
}

import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

// POST — mark the spotlight tour as seen so it doesn't re-appear on
// next mount. Best-effort: if this fails the client still closes the
// overlay; the worst case is the user sees the tour twice.
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { error } = await supabaseAdmin
      .from('aft_user_roles')
      .update({ tour_completed: true })
      .eq('user_id', user.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error, req); }
}

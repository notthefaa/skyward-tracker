import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

// GET /api/howard/actions?threadId=xxx — list all proposed actions for a thread
export async function GET(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get('threadId');
    if (!threadId) return NextResponse.json({ error: 'Thread ID required.' }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('aft_proposed_actions')
      .select('*')
      .eq('thread_id', threadId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ actions: data || [] });
  } catch (error) { return handleApiError(error, req); }
}

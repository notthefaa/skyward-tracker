import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

// POST — mark onboarding as finished. Called by the classic form path
// (PilotOnboarding) after a successful aircraft create. The Howard-
// guided path flips this flag as part of the onboarding_setup
// executor, so this endpoint is only needed for the form branch.
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { error } = await supabaseAdmin
      .from('aft_user_roles')
      .update({ completed_onboarding: true })
      .eq('user_id', user.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

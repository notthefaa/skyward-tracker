import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

// POST — mark onboarding as finished. Called by the classic form path
// (PilotOnboarding) after a successful aircraft create. The Howard-
// guided path flips this flag as part of the onboarding_setup
// executor, so this endpoint is only needed for the form branch.
//
// Two-step (insert-if-missing then update) instead of a single upsert
// so we never overwrite an existing row's role/email. The `ignoreDuplicates`
// insert is a no-op when the row exists; the follow-up update flips
// the flag for both new and existing rows. Without this, a user who
// somehow lacks an aft_user_roles row would have the UPDATE silently
// no-op and AppShell's next fetch would coerce `completed_onboarding`
// back to false, bouncing them to the welcome screen with an empty
// form — the symptom we've been chasing.
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    const { error: insertErr } = await supabaseAdmin
      .from('aft_user_roles')
      .upsert(
        { user_id: user.id, role: 'pilot', email: user.email ?? null, completed_onboarding: true },
        { onConflict: 'user_id', ignoreDuplicates: true },
      );
    if (insertErr) throw insertErr;

    const { error: updateErr } = await supabaseAdmin
      .from('aft_user_roles')
      .update({ completed_onboarding: true })
      .eq('user_id', user.id);
    if (updateErr) throw updateErr;

    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error, req); }
}

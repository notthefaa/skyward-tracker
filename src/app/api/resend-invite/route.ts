import { NextResponse } from 'next/server';
import { createAdminClient, handleApiError } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    // NOTE: This route intentionally does NOT require authentication.
    // It is called from the "Link Expired" page by unauthenticated users
    // who need a fresh invite link. Supabase's built-in rate limiting
    // on inviteUserByEmail prevents abuse (it will reject rapid re-sends
    // and only works for users who were already invited).
    const supabaseAdmin = createAdminClient();

    // Resend the official invite email.
    // This generates a fresh token without overwriting their assigned aircraft.
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${new URL(req.url).origin}/update-password`
    });

    if (error) {
      // If they are already fully registered, Supabase throws an error here, preventing abuse.
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

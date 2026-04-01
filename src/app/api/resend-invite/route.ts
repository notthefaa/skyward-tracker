import { NextResponse } from 'next/server';
import { createAdminClient, handleApiError } from '@/lib/auth';
import { RESEND_INVITE_COOLDOWN_MINUTES } from '@/lib/constants';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // NOTE: This route intentionally does NOT require authentication.
    // It is called from the "Link Expired" page by unauthenticated users
    // who need a fresh invite link.

    const supabaseAdmin = createAdminClient();

    // ── Rate Limiting ──
    // Check if this email was invited recently to prevent abuse.
    // Uses Supabase Auth's invited_at field as a natural cooldown.
    const { data: userData } = await supabaseAdmin.auth.admin.listUsers();

    if (userData?.users) {
      const targetUser = userData.users.find(
        (u: any) => u.email?.toLowerCase() === normalizedEmail
      );

      if (targetUser?.invited_at) {
        const invitedAt = new Date(targetUser.invited_at).getTime();
        const cooldownMs = RESEND_INVITE_COOLDOWN_MINUTES * 60 * 1000;
        const now = Date.now();

        if (now - invitedAt < cooldownMs) {
          const remainingSeconds = Math.ceil((cooldownMs - (now - invitedAt)) / 1000);
          const remainingMinutes = Math.ceil(remainingSeconds / 60);
          return NextResponse.json(
            { error: `Please wait ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''} before requesting another invite link.` },
            { status: 429 }
          );
        }
      }
    }

    // Resend the official invite email.
    // This generates a fresh token without overwriting their assigned aircraft.
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
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

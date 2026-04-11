import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

// This route is intentionally unauthenticated — it is called from the
// "Link Expired" page by users who need a fresh invite link. Because the
// caller is anonymous, the response must NOT reveal whether an account
// exists for the given email. Every outcome returns the same success
// payload so the endpoint cannot be used as a user-enumeration oracle.
//
// Supabase's own inviteUserByEmail handler enforces a server-side throttle
// on repeated invites to the same address, so we no longer need to look up
// invited_at ourselves (which required listUsers — a full directory scan
// that also leaked performance-based enumeration signals).
export async function POST(req: Request) {
  const GENERIC_RESPONSE = NextResponse.json({ success: true });
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string') return GENERIC_RESPONSE;

    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail) return GENERIC_RESPONSE;

    const supabaseAdmin = createAdminClient();

    try {
      await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
        redirectTo: `${new URL(req.url).origin}/update-password`
      });
    } catch {
      // Swallow: an error here (already-registered user, throttled, invalid
      // address) must not be surfaced to the caller. The generic success
      // response below is the only branch this endpoint emits.
    }

    return GENERIC_RESPONSE;
  } catch {
    return GENERIC_RESPONSE;
  }
}

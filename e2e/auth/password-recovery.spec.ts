import { test, expect } from '../fixtures/test-user';
import { adminClient } from '../helpers/admin';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

/**
 * Password recovery (forgot-password) end-to-end.
 *
 * The /update-password page handles two flow types: 'invite' (full
 * Complete-Setup form) and 'recovery' (password-only, fixed in 2026-05-06
 * to stop overwriting returning users' name/initials with whatever they
 * retyped).
 *
 * We bypass the actual email step via supabase-js admin generateLink,
 * which returns the action_link without dispatching an email. The
 * action_link contains the same token_hash + type query params our
 * /update-password page parses.
 */
test.describe('password recovery', () => {
  test('recovery link sets new password without overwriting profile fields', async ({ page, testUser }) => {
    const admin = adminClient();

    // Pre-populate a profile so we can confirm it survives the recovery.
    await admin.from('aft_user_roles').upsert({
      user_id: testUser.userId,
      role: 'pilot',
      email: testUser.email,
      full_name: 'Original Name',
      initials: 'ON',
      completed_onboarding: true,
    }, { onConflict: 'user_id' });

    // Mint a recovery action link (no email sent).
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: testUser.email,
    });
    if (linkErr || !link?.properties?.action_link) {
      throw new Error(`generateLink failed: ${linkErr?.message ?? 'no action_link'}`);
    }

    // generateLink returns properties.hashed_token — that's the OTP-
    // style hash our /update-password page passes to verifyOtp. The
    // action_link URL contains a different `token` query param meant
    // for Supabase's own /auth/v1/verify redirect flow; passing that
    // to verifyOtp would 422 ("Token has expired or is invalid").
    const tokenHash = link.properties.hashed_token;
    expect(tokenHash, 'hashed_token must exist').toBeTruthy();

    await page.goto(`/update-password?token_hash=${tokenHash}&type=recovery`, {
      waitUntil: 'domcontentloaded',
    });

    // Recovery flow renders ONLY the password field — the bug fix in
    // 2026-05-06 hides full_name + initials so we don't clobber the
    // existing profile.
    await expect(page.getByRole('heading', { name: /reset password/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/full name/i)).toHaveCount(0);
    await expect(page.getByText(/your initials/i)).toHaveCount(0);

    // Set a new password.
    const newPassword = `pw-new-${randomUUID().slice(0, 12)}`;
    await page.locator('input[type="password"]').first().fill(newPassword);
    await page.getByRole('button', { name: /save new password/i }).click();

    // Lands on the main app (window.location.href = '/' on success).
    // We can't reliably assert the welcome modal isn't visible because
    // the seeded role row already has completed_onboarding=true and
    // there's no aircraft, so AppShell may render its own onboarding.
    // What we CAN assert: the URL changed off /update-password.
    await page.waitForURL((u) => !u.pathname.includes('/update-password'), { timeout: 30_000 });

    // The profile should NOT have been clobbered.
    const { data: profile } = await admin
      .from('aft_user_roles')
      .select('full_name, initials')
      .eq('user_id', testUser.userId)
      .single();
    expect(profile?.full_name).toBe('Original Name');
    expect(profile?.initials).toBe('ON');

    // The new password must work — sign in via anon client.
    const url2 = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const sb = createClient(url2, anon, { auth: { persistSession: false } });
    const { data: signin, error: signinErr } = await sb.auth.signInWithPassword({
      email: testUser.email,
      password: newPassword,
    });
    expect(signinErr).toBeNull();
    expect(signin?.session?.user?.id).toBe(testUser.userId);
  });
});

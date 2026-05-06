import { test, expect } from '@playwright/test';
import { adminClient } from '../helpers/admin';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

/**
 * Invite-link UI flow.
 *
 * /update-password handles type=invite by showing the full
 * Complete-Setup form (full_name + initials + password). This spec
 * covers the path an invited pilot follows after clicking the email
 * link: form renders, fields submit, profile lands.
 */
test.describe('invite link', () => {
  test('invitee sees full Complete-Setup form, fields persist after save', async ({ page }) => {
    const admin = adminClient();
    const email = `e2e-invite-ui-${randomUUID()}@skyward-test.local`;

    // 1. Create the auth.users row + an empty role row (mimics what
    // /api/invite would set up server-side, minus the email send).
    const { data: u } = await admin.auth.admin.createUser({ email, email_confirm: false });
    const userId = u!.user!.id;
    await admin.from('aft_user_roles').upsert({
      user_id: userId,
      role: 'pilot',
      email,
      completed_onboarding: true, // skips welcome modal
    }, { onConflict: 'user_id' });

    // 2. Mint an invite link.
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'invite',
      email,
    });
    if (linkErr || !link?.properties?.hashed_token) {
      throw new Error(`generateLink: ${linkErr?.message ?? 'no hashed_token'}`);
    }

    await page.goto(`/update-password?token_hash=${link.properties.hashed_token}&type=invite`, {
      waitUntil: 'domcontentloaded',
    });

    // Full Complete-Setup form: name + initials + password all present.
    await expect(page.getByRole('heading', { name: /complete setup/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/full name/i).first()).toBeVisible();
    await expect(page.getByText(/your initials/i).first()).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();

    // 3. Fill + submit.
    const fullName = `Invited Pilot ${randomUUID().slice(0, 6)}`;
    const initials = 'INV';
    const password = `pw-inv-${randomUUID().slice(0, 12)}`;

    await page.getByPlaceholder(/jane smith/i).fill(fullName);
    await page.getByPlaceholder(/abc/i).fill(initials);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByRole('button', { name: /save and enter skyward/i }).click();

    await page.waitForURL((u) => !u.pathname.includes('/update-password'), { timeout: 30_000 });

    // 4. Profile written.
    const { data: profile } = await admin
      .from('aft_user_roles')
      .select('full_name, initials, completed_onboarding')
      .eq('user_id', userId)
      .single();
    expect(profile?.full_name).toBe(fullName);
    expect(profile?.initials).toBe(initials.toUpperCase());
    expect(profile?.completed_onboarding).toBe(true);

    // 5. Password works.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const sb = createClient(url, anon, { auth: { persistSession: false } });
    const { data: signin, error: signinErr } = await sb.auth.signInWithPassword({ email, password });
    expect(signinErr).toBeNull();
    expect(signin?.session?.user?.id).toBe(userId);

    await admin.auth.admin.deleteUser(userId).then(undefined, () => {});
  });
});

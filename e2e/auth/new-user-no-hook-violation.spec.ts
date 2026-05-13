import { test, expect } from '@playwright/test';
import { adminClient } from '../helpers/admin';
import { randomUUID } from 'node:crypto';

// Regression: production users with `completed_onboarding=false`
// were hitting "Rendered fewer hooks than expected" (surfaced as
// minified React #300) because `useDocStatusWatcher` lived AFTER
// the onboarding-path early returns in AppShell. Render N (loading)
// ran the hook; render N+1 (onboarding-needed) early-returned and
// skipped it; React detected the hook-count drift and fatal'd.
//
// Existing users never tripped this because their
// `completed_onboarding=true` made the early-return path unreachable.
//
// Two profiles of "new":
//   - No aft_user_roles row at all (Supabase Auth dashboard signup).
//   - Row with completed_onboarding=false (post-OTP, pre-aircraft).
// Both must land without a React render-time error.

test.describe('new user signup — no hook-order violation', () => {
  for (const profile of ['no_role_row', 'completed_onboarding_false'] as const) {
    test(`new user (${profile}) — no render crash`, async ({ page }) => {
      test.setTimeout(90_000);
      const admin = adminClient();

      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(`${err.message}\n${err.stack || ''}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      const email = `e2e-new-${profile}-${randomUUID()}@skyward-test.local`;
      const password = `pw-${randomUUID().slice(0, 12)}`;
      const { data: userU } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      const userId = userU!.user!.id;

      // Always delete any auto-created row first, then optionally insert
      // a row with explicit completed_onboarding=false. The "no_role_row"
      // profile leaves the table empty for this user.
      await admin.from('aft_user_roles').delete().eq('user_id', userId);
      if (profile === 'completed_onboarding_false') {
        await admin.from('aft_user_roles').insert({
          user_id: userId,
          role: 'pilot',
          email,
          completed_onboarding: false,
        });
      }

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill(password);
      await page.getByRole('button', { name: 'Log in' }).click();

      // Wait 12 seconds to let any render loop fire — React #300 is
      // typically detected fast, but we give the bundle time to load.
      await page.waitForTimeout(12_000);

      try { await admin.from('aft_user_roles').delete().eq('user_id', userId); } catch {}
      try { await admin.auth.admin.deleteUser(userId); } catch {}

      console.log(`\n=== PROFILE: ${profile} ===`);
      console.log('PAGE ERRORS:', pageErrors.length, pageErrors.join('\n---\n'));
      console.log('CONSOLE ERRORS:', consoleErrors.length, consoleErrors.join('\n'));

      const reactErrors = [...pageErrors, ...consoleErrors].filter(e => /Minified React error|Too many re-renders|#300/i.test(e));
      expect(reactErrors, `React errors:\n${reactErrors.join('\n')}`).toEqual([]);
    });
  }
});

import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';

/**
 * Settings → Profile: change full name + initials, save, verify the
 * row landed in aft_user_roles. The Settings modal hangs off a
 * button in the AppShell header (aria-label "Settings").
 */
test.describe('Settings — profile', () => {
  test('admin updates full name and initials', async ({ page, seededUser }) => {
    test.setTimeout(60_000);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(seededUser.email);
    await page.locator('input[type="password"]').fill(seededUser.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Settings' }).click();

    await expect(page.getByRole('heading', { name: /^Settings$/ })).toBeVisible();

    await page.getByPlaceholder('e.g. Jane Smith').fill('Test Pilot');
    await page.getByPlaceholder('e.g. JS').fill('TP');

    await page.getByRole('button', { name: /save profile/i }).click();
    await expect(page.getByText(/profile updated/i).first()).toBeVisible({ timeout: 30_000 });

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_user_roles')
      .select('full_name, initials')
      .eq('user_id', seededUser.userId)
      .single();
    expect(row?.full_name).toBe('Test Pilot');
    expect(row?.initials).toBe('TP');
  });
});

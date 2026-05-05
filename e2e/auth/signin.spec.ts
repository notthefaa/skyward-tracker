import { test, expect } from '../fixtures/test-user';

test.describe('signin', () => {
  test('valid credentials land on welcome screen for a brand-new user', async ({ page, testUser }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // AuthScreen labels lack htmlFor; key off the type attribute.
    await page.locator('input[type="email"]').fill(testUser.email);
    await page.locator('input[type="password"]').fill(testUser.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    // Fresh user with no aft_user_roles row → HowardWelcome takes over.
    await expect(page.getByRole('heading', { name: 'Meet Howard' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /let.s set up together/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /i.ll do it myself/i })).toBeVisible();

    const blocking = consoleErrors.filter((e) => !/Failed to load resource/i.test(e));
    expect(blocking, blocking.join('\n')).toEqual([]);
  });

  test('wrong password shows the friendly error, stays on auth screen', async ({ page, testUser }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // AuthScreen labels lack htmlFor; key off the type attribute.
    await page.locator('input[type="email"]').fill(testUser.email);
    await page.locator('input[type="password"]').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Log in' }).click();

    // The friendly error is rendered via toast — anchor on its text.
    await expect(page.getByText(/email or password is wrong/i)).toBeVisible({ timeout: 10_000 });
    // Still on auth screen.
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });
});

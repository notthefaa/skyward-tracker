import { test, expect } from '../fixtures/test-user';
import { randomUUID } from 'node:crypto';

test.describe('onboarding (manual-form path)', () => {
  test('new user picks form path → fills required fields → lands in app', async ({ page, testUser }) => {
    test.setTimeout(90_000);

    // Surface server errors so a 500 doesn't masquerade as a UI bug.
    const apiErrors: string[] = [];
    page.on('response', async (res) => {
      if (res.url().includes('/api/aircraft/create') && !res.ok()) {
        apiErrors.push(`${res.status()} ${res.url()} :: ${await res.text().catch(() => '')}`);
      }
    });

    // Sign in
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(testUser.email);
    await page.locator('input[type="password"]').fill(testUser.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    // Welcome screen → form path
    await expect(page.getByRole('heading', { name: 'Meet Howard' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /i.ll do it myself/i }).click();

    // Form
    await expect(page.getByRole('heading', { name: /set up your aircraft/i })).toBeVisible();

    // Unique tail per run so successive runs don't collide.
    const tail = `N${randomUUID().slice(0, 5).toUpperCase()}`;

    await page.locator('input[name="tail_number"]').fill(tail);
    await page.locator('input[name="aircraft_type"]').fill('Cessna 172S');
    // The required engine-time input is the last number input (Tach).
    const engineInput = page.locator('input[type="number"]').last();
    await engineInput.fill('100');

    await page.getByRole('button', { name: /save and start using skyward/i }).click();

    // First-stage signal: button flips to "Creating..." while POST is in flight.
    await expect(page.getByRole('button', { name: /creating/i })).toBeVisible({ timeout: 5_000 });

    // Wait for the submit cycle to finish (button reverts OR the form
    // unmounts). Then assert success — capture toast text on failure
    // so a 4xx/5xx doesn't masquerade as "form sat silently."
    await page.waitForFunction(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return !buttons.some((b) => /creating/i.test(b.textContent || ''));
    }, { timeout: 30_000 });

    if (apiErrors.length) {
      throw new Error(`/api/aircraft/create errored:\n${apiErrors.join('\n')}`);
    }

    // Toast is the deterministic success signal.
    await expect(page.getByText(/aircraft added to your fleet/i)).toBeVisible({ timeout: 15_000 });
  });
});

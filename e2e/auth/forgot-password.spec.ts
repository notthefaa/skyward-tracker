import { test, expect } from '@playwright/test';

test.describe('forgot password (UI flow only)', () => {
  test('can navigate to forgot-password form and back', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /forgot password/i }).click();

    await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible();
    await expect(page.getByText(/enter your email/i)).toBeVisible();

    await page.getByRole('button', { name: /back to login/i }).click();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });
});

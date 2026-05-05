import { test, expect } from '@playwright/test';

test.describe('smoke', () => {
  test('app boots and renders the auth screen for an anonymous visitor', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
    });

    // domcontentloaded (not 'load') so a long-polling fetch (Supabase
    // realtime, HMR websocket) doesn't keep the load event pending and
    // burn the test timeout.
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Auth gate is the unauthenticated entry point; the exact heading
    // copy may evolve, so anchor on stable affordances instead.
    await expect(page.getByRole('button', { name: /sign in|continue|log in/i })).toBeVisible({ timeout: 15_000 });

    // Page-level errors are blocking; console errors are noisy in dev
    // but should be empty for a clean cold-load.
    const blocking = consoleErrors.filter((e) => !/Failed to load resource/i.test(e));
    expect(blocking, blocking.join('\n')).toEqual([]);
  });
});

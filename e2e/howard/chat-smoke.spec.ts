import { test, expect } from '../fixtures/seeded-user';

/**
 * Howard chat smoke. One conversational turn, no tool use. Catches
 * the "Howard's UI broke" / "SSE plumbing collapsed" / "API route
 * returns 500" classes without burning many Anthropic tokens.
 *
 * Skipped when ANTHROPIC_API_KEY isn't set so the suite stays green
 * in environments that don't have the key wired up.
 */
test.describe('Howard — chat smoke', () => {
  test.skip(!process.env.ANTHROPIC_API_KEY, 'Anthropic key not set');

  test('user sends a greeting and Howard replies', async ({ page, seededUser }) => {
    test.setTimeout(120_000);

    const apiErrors: string[] = [];
    page.on('response', async (res) => {
      if (res.url().includes('/api/howard') && !res.ok()) {
        apiErrors.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(seededUser.email);
    await page.locator('input[type="password"]').fill(seededUser.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
    const secondaryNav = page.getByRole('navigation', { name: 'Secondary navigation' });

    await expect(mainNav.getByRole('button', { name: 'More', exact: true })).toBeVisible({ timeout: 20_000 });
    await mainNav.getByRole('button', { name: 'More', exact: true }).click();
    await secondaryNav.getByRole('button', { name: 'Howard', exact: true }).click();

    // Give the textarea a moment to mount.
    const input = page.getByPlaceholder('Ask Howard anything...');
    await expect(input).toBeVisible({ timeout: 15_000 });

    // Conversational prompt designed to NOT trigger any tool use —
    // Howard's system prompt is tool-eager but a simple greeting is
    // the fast-path no-tool case.
    await input.fill('Just respond with the single word "ack" and nothing else.');
    await page.getByRole('button', { name: 'Send message' }).click();

    // Wait for an assistant bubble to render with non-empty content.
    // data-role="assistant" is set on the bubble wrapper so we don't
    // accidentally match the user's own prompt (which contains "ack").
    const assistantBubble = page.locator('[data-role="assistant"]').last();
    await expect(assistantBubble).toBeVisible({ timeout: 60_000 });
    await expect(assistantBubble).not.toBeEmpty({ timeout: 60_000 });

    if (apiErrors.length) {
      throw new Error(`Howard API errored:\n${apiErrors.join('\n')}`);
    }
  });
});

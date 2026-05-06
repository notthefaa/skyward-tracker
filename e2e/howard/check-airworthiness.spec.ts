import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';

/**
 * Howard check_airworthiness — pilots act on this verdict for go/no-go
 * decisions. The handler was hardened in commit `b5926bc` to throw on
 * any of the Promise.all read errors instead of silently treating
 * missing data as "airworthy". This test verifies the tool gets called
 * and produces a verdict on a freshly-seeded aircraft (which will be
 * "thin data" — equipment / mxItems / squawks / ads all empty).
 *
 * Cost: ~$0.005 Anthropic. No external API.
 * Skipped without ANTHROPIC_API_KEY.
 */
test.describe('Howard — check_airworthiness', () => {
  test.skip(!process.env.ANTHROPIC_API_KEY, 'Anthropic key not set');

  test('returns a verdict for a freshly-seeded aircraft (thin-data caveat)', async ({ page, seededUser }) => {
    test.setTimeout(120_000);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(seededUser.email);
    await page.locator('input[type="password"]').fill(seededUser.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(mainNav.getByRole('button', { name: 'More', exact: true })).toBeVisible({ timeout: 20_000 });
    await mainNav.getByRole('button', { name: 'More', exact: true }).click();
    const secondaryNav = page.getByRole('navigation', { name: 'Secondary navigation' });
    await secondaryNav.getByRole('button', { name: 'Howard', exact: true }).click();

    const input = page.getByPlaceholder('Ask Howard anything...');
    await expect(input).toBeVisible({ timeout: 15_000 });

    await input.fill(`Is ${seededUser.tailNumber} airworthy right now? Use the check_airworthiness tool. One-sentence verdict.`);
    await page.getByRole('button', { name: 'Send message' }).click();

    const assistantBubble = page.locator('[data-role="assistant"]').last();
    await expect(assistantBubble).toBeVisible({ timeout: 90_000 });
    await expect(assistantBubble).not.toBeEmpty({ timeout: 90_000 });

    await page.waitForTimeout(1_500);
    const admin = adminClient();
    const { data: msgs } = await admin
      .from('aft_howard_messages')
      .select('role, tool_calls, tool_results, content, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    const assistantMsgs = (msgs ?? []).filter(m => m.role === 'assistant');
    const calledTool = assistantMsgs.some(m => {
      const calls = (m.tool_calls as any[]) || [];
      return calls.some((c: any) => c?.name === 'check_airworthiness');
    });
    expect(calledTool, 'expected check_airworthiness tool to be invoked').toBe(true);

    // Tool result must contain SOMETHING — i.e. the tool didn't error
    // out silently (which is what we hardened in commit b5926bc). The
    // exact shape of stored tool_results varies (jsonb/array/string),
    // so we check loosely for the verdict's data_completeness signal.
    const flatResults = JSON.stringify(assistantMsgs.map(m => m.tool_results ?? []));
    expect(flatResults).toMatch(/data_completeness|missing_critical_equipment|verdict|airworthy/i);
  });
});

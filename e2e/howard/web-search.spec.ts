import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';

/**
 * Howard web_search via Tavily — single targeted call.
 *
 * Tavily's free tier is 1000 searches/month. This test makes ONE
 * search per run; do not parallelise or loop.
 *
 * Cost: ~1 Tavily search (free) + ~$0.005 Anthropic. Skipped if
 * either ANTHROPIC_API_KEY or TAVILY_API_KEY is absent.
 */
test.describe('Howard — web_search (Tavily)', () => {
  test.skip(!process.env.ANTHROPIC_API_KEY || !process.env.TAVILY_API_KEY,
    'ANTHROPIC_API_KEY + TAVILY_API_KEY required for Tavily test');

  test('$100-hamburger prompt triggers web_search and returns a non-empty answer', async ({ page, seededUser }) => {
    test.setTimeout(120_000);

    const admin = adminClient();

    // Reset the per-user daily cap so a previous test run doesn't
    // exhaust the budget. Migration 048 added howard_web_search_daily.
    await admin
      .from('aft_howard_web_search_daily')
      .delete()
      .eq('user_id', seededUser.userId)
      .then(undefined, () => { /* table may not exist on older bootstraps */ });

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

    // $100-hamburger query — Howard's system prompt explicitly tells
    // the model to call web_search FIRST for these. Single search.
    await input.fill('Quick web search: best $100-hamburger spot near KMRY airport. One sentence. Use web_search.');
    await page.getByRole('button', { name: 'Send message' }).click();

    const assistantBubble = page.locator('[data-role="assistant"]').last();
    await expect(assistantBubble).toBeVisible({ timeout: 90_000 });
    await expect(assistantBubble).not.toBeEmpty({ timeout: 90_000 });

    // Verify web_search was actually invoked.
    await page.waitForTimeout(1_500);
    const { data: msgs } = await admin
      .from('aft_howard_messages')
      .select('role, tool_calls, content, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    const assistantMsgs = (msgs ?? []).filter(m => m.role === 'assistant');
    const usedWebSearch = assistantMsgs.some(m => {
      const calls = (m.tool_calls as any[]) || [];
      return calls.some((c: any) => c?.name === 'web_search');
    });
    expect(usedWebSearch, 'expected web_search tool to be invoked').toBe(true);
  });
});

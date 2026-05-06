import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';

/**
 * Howard tool-call coverage. Each test triggers ONE specific tool to
 * keep token cost low (~$0.005/test on Haiku). The assertion checks
 * the saved aft_howard_messages row for tool_calls metadata, NOT the
 * model's natural-language output (which is non-deterministic).
 *
 * Skipped when ANTHROPIC_API_KEY isn't set.
 *
 * Budget note: 1 message → ~1 tool round → 2 saved messages. With
 * Haiku 4.5 + caching, cost is roughly $0.002–0.005 per test. If you
 * need to add a tool-call test, prefer cheap deterministic tools
 * (db reads); avoid web_search unless specifically testing Tavily.
 */
test.describe('Howard — tool calls', () => {
  test.skip(!process.env.ANTHROPIC_API_KEY, 'Anthropic key not set');

  test('triggers get_flight_logs tool when asked about flight history', async ({ page, seededUser }) => {
    test.setTimeout(120_000);

    // Seed a couple of flight logs so the tool returns data.
    const admin = adminClient();
    await admin.from('aft_flight_logs').insert([
      {
        aircraft_id: seededUser.aircraftId,
        user_id: seededUser.userId,
        occurred_at: '2026-04-01',
        date: '2026-04-01',
        pilot_initials: 'TST',
        pic_initials: 'TST',
        landings: 1,
        engine_cycles: 1,
      },
      {
        aircraft_id: seededUser.aircraftId,
        user_id: seededUser.userId,
        occurred_at: '2026-04-02',
        date: '2026-04-02',
        pilot_initials: 'TST',
        pic_initials: 'TST',
        landings: 1,
        engine_cycles: 1,
      },
    ]);

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

    // Prompt designed to force exactly the get_flight_logs tool.
    await input.fill(`Show me my flight history for ${seededUser.tailNumber} — last 3 entries. Use the get_flight_logs tool then briefly summarize.`);
    await page.getByRole('button', { name: 'Send message' }).click();

    // Wait for an assistant bubble to populate.
    const assistantBubble = page.locator('[data-role="assistant"]').last();
    await expect(assistantBubble).toBeVisible({ timeout: 60_000 });
    await expect(assistantBubble).not.toBeEmpty({ timeout: 60_000 });

    // Server-side: the assistant message we just rendered should have
    // a tool_calls jsonb naming get_flight_logs.
    // Brief settle-time so the streaming write commits.
    await page.waitForTimeout(1_500);

    const { data: msgs } = await admin
      .from('aft_howard_messages')
      .select('role, tool_calls, content, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    const assistantMsgs = (msgs ?? []).filter(m => m.role === 'assistant');
    const usedFlightLogs = assistantMsgs.some(m => {
      const calls = (m.tool_calls as any[]) || [];
      return calls.some((c: any) => c?.name === 'get_flight_logs');
    });
    expect(usedFlightLogs, 'expected get_flight_logs tool to be invoked').toBe(true);
  });
});

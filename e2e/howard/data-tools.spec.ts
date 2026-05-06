import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { randomUUID } from 'node:crypto';

/**
 * Howard data-read tool coverage. Each test triggers ONE specific
 * read-only tool to keep token cost low (~$0.002–0.005 per test on
 * Haiku). The assertion checks the saved aft_howard_messages row for
 * tool_calls metadata, NOT the model's natural-language output.
 *
 * Skipped when ANTHROPIC_API_KEY isn't set.
 *
 * `get_flight_logs` is covered in tool-calls.spec.ts; this file fills
 * the gap on get_maintenance_items / get_squawks / get_service_events.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Howard — data-read tool calls', () => {
  test.skip(!process.env.ANTHROPIC_API_KEY, 'Anthropic key not set');

  async function loginAndOpenHoward(page: any, seededUser: any) {
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
    return input;
  }

  async function expectToolWasCalled(toolName: string) {
    const admin = adminClient();
    const { data: msgs } = await admin
      .from('aft_howard_messages')
      .select('role, tool_calls, content, created_at')
      .order('created_at', { ascending: false })
      .limit(10);
    const assistantMsgs = (msgs ?? []).filter(m => m.role === 'assistant');
    const calledTool = assistantMsgs.some(m => {
      const calls = (m.tool_calls as any[]) || [];
      return calls.some((c: any) => c?.name === toolName);
    });
    expect(calledTool, `expected ${toolName} tool to be invoked`).toBe(true);
  }

  test('triggers get_maintenance_items when asked about MX due', async ({ page, seededUser }) => {
    test.setTimeout(120_000);
    const admin = adminClient();
    await admin.from('aft_maintenance_items').insert({
      aircraft_id: seededUser.aircraftId,
      item_name: 'Annual inspection',
      tracking_type: 'date',
      due_date: '2026-08-31',
    });

    const input = await loginAndOpenHoward(page, seededUser);
    await input.fill(`What maintenance items are due on ${seededUser.tailNumber}? Use the get_maintenance_items tool.`);
    await page.getByRole('button', { name: 'Send message' }).click();

    const assistantBubble = page.locator('[data-role="assistant"]').last();
    await expect(assistantBubble).toBeVisible({ timeout: 60_000 });
    await expect(assistantBubble).not.toBeEmpty({ timeout: 60_000 });
    await page.waitForTimeout(1_500);

    await expectToolWasCalled('get_maintenance_items');
  });

  test('triggers get_squawks when asked about open discrepancies', async ({ page, seededUser }) => {
    test.setTimeout(120_000);
    const admin = adminClient();
    await admin.from('aft_squawks').insert({
      aircraft_id: seededUser.aircraftId,
      reported_by: seededUser.userId,
      description: 'Loose rudder pedal — needs adjustment.',
      status: 'open',
      access_token: randomUUID().replace(/-/g, ''),
    });

    const input = await loginAndOpenHoward(page, seededUser);
    await input.fill(`Show me all open squawks on ${seededUser.tailNumber}. Use the get_squawks tool.`);
    await page.getByRole('button', { name: 'Send message' }).click();

    const assistantBubble = page.locator('[data-role="assistant"]').last();
    await expect(assistantBubble).toBeVisible({ timeout: 60_000 });
    await expect(assistantBubble).not.toBeEmpty({ timeout: 60_000 });
    await page.waitForTimeout(1_500);

    await expectToolWasCalled('get_squawks');
  });

  test('triggers get_service_events when asked about work packages', async ({ page, seededUser }) => {
    test.setTimeout(120_000);
    const admin = adminClient();
    await admin.from('aft_maintenance_events').insert({
      aircraft_id: seededUser.aircraftId,
      created_by: seededUser.userId,
      status: 'scheduling',
      proposed_date: '2026-08-15',
      proposed_by: 'owner',
      access_token: randomUUID().replace(/-/g, ''),
      mx_contact_name: 'Test Mechanic',
    });

    const input = await loginAndOpenHoward(page, seededUser);
    await input.fill(`Any active service events on ${seededUser.tailNumber}? Use the get_service_events tool.`);
    await page.getByRole('button', { name: 'Send message' }).click();

    const assistantBubble = page.locator('[data-role="assistant"]').last();
    await expect(assistantBubble).toBeVisible({ timeout: 60_000 });
    await expect(assistantBubble).not.toBeEmpty({ timeout: 60_000 });
    await page.waitForTimeout(1_500);

    await expectToolWasCalled('get_service_events');
  });
});

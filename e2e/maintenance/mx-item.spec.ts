import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';

/**
 * MX → Due Items: create a maintenance item via the UI (form path,
 * not scan). Verifies the route + form contract + UI listing all hold
 * together. The api/maintenance-items spec covers the cross-aircraft
 * guards; this one covers the actual user-facing flow.
 *
 * Default tracking type is 'date', so this test takes the date path —
 * it's the simpler one and doesn't need the engine-type-aware Tach/FTT
 * label assertion.
 */
test.describe('Maintenance → Due Items — create item', () => {
  test('admin tracks a new annual-style item, row appears in due list', async ({ page, seededUser }) => {
    test.setTimeout(90_000);

    const apiErrors: string[] = [];
    page.on('response', async (res) => {
      if (res.url().includes('/api/maintenance-items') && !res.ok()) {
        apiErrors.push(`${res.status()} ${res.url()} :: ${await res.text().catch(() => '')}`);
      }
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(seededUser.email);
    await page.locator('input[type="password"]').fill(seededUser.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
    const secondaryNav = page.getByRole('navigation', { name: 'Secondary navigation' });

    await expect(mainNav.getByRole('button', { name: 'MX', exact: true })).toBeVisible({ timeout: 20_000 });
    await mainNav.getByRole('button', { name: 'MX', exact: true }).click();
    await secondaryNav.getByRole('button', { name: 'Due Items', exact: true }).click();

    await page.getByRole('button', { name: /track new item/i }).click();
    await expect(page.getByRole('heading', { name: 'Track New Item' })).toBeVisible();

    // Default tracking type is 'date'. Fill the minimum required fields.
    // Form labels aren't associated with their inputs (sibling <label>
    // without htmlFor) so getByLabel doesn't work — pick by placeholder
    // and structure. Logged as an a11y backlog item.
    await page.getByPlaceholder('e.g. Annual Inspection').fill('Annual Inspection');
    await page.locator('input[type="date"][required]').first().fill('2026-01-15');
    await page.locator('input[type="number"][min="1"]').first().fill('365');

    await page.getByRole('button', { name: /save maintenance item/i }).click();

    if (apiErrors.length) {
      throw new Error(`/api/maintenance-items errored:\n${apiErrors.join('\n')}`);
    }

    // Toast is the deterministic success signal.
    await expect(page.getByText(/maintenance item (saved|added|tracked)/i).first())
      .toBeVisible({ timeout: 15_000 });

    // DB-side: row exists, scoped to this aircraft, not soft-deleted.
    const admin = adminClient();
    const { data: rows, error } = await admin
      .from('aft_maintenance_items')
      .select('id, item_name, tracking_type, date_interval_days, deleted_at')
      .eq('aircraft_id', seededUser.aircraftId)
      .is('deleted_at', null);
    if (error) throw new Error(`maintenance-items read: ${error.message}`);
    expect(rows?.length).toBe(1);
    expect(rows![0].item_name).toBe('Annual Inspection');
    expect(rows![0].tracking_type).toBe('date');
    expect(Number(rows![0].date_interval_days)).toBe(365);

    // UI-side: the new item should appear in the maintenance list.
    await expect(page.getByText('Annual Inspection').first()).toBeVisible({ timeout: 5_000 });
  });
});

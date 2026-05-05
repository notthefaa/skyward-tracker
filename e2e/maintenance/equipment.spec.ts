import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';

/**
 * More → Equipment: add a piece of equipment via the catalog combobox.
 * Verifies the route + catalog autofill + listing all hold together.
 *
 * Catalog query "Garmin GTX" should match the Garmin GTX 345 transponder
 * entry in the equipment catalog. We don't verify which entry is picked —
 * just that catalog autofill flows from picker → form → save → DB row.
 */
test.describe('More → Equipment — add via catalog', () => {
  test('admin adds a transponder via the catalog combobox', async ({ page, seededUser }) => {
    test.setTimeout(120_000);

    const apiErrors: string[] = [];
    page.on('response', async (res) => {
      if (res.url().includes('/api/equipment') && !res.ok()) {
        apiErrors.push(`${res.status()} ${res.url()} :: ${await res.text().catch(() => '')}`);
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
    await secondaryNav.getByRole('button', { name: 'Equipment', exact: true }).click();

    // Wait for the equipment view to render before clicking Add.
    await expect(page.getByRole('heading', { name: 'Equipment' })).toBeVisible({ timeout: 30_000 });

    // Add button — only one button labeled exactly "Add" on this page.
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Add Equipment' })).toBeVisible();

    // Type into the catalog combobox — the picker is async + on-blur-close,
    // so use mousedown semantics (matched in the component) by clicking
    // a visible result row.
    await page.getByPlaceholder('Search make or model — e.g. Continental IO-360').fill('Garmin GTX');
    // Pick the first result. The list renders <button> children, so role=button
    // works; scope to the modal heading's container to avoid the page's Add button.
    const firstResult = page.getByRole('button').filter({ hasText: /Garmin/ }).filter({ hasText: /GTX/ }).first();
    await firstResult.click();

    // Verify catalog autofill populated Make and Model. Make+Model inputs
    // sit under the Category select; pick by placeholder.
    const makeInput = page.getByPlaceholder('Garmin');
    await expect(makeInput).toHaveValue(/Garmin/i);

    // Default Name should also have prefilled — but we override to a stable
    // string the test can assert on.
    const nameInput = page.getByPlaceholder('e.g. Primary Transponder');
    await nameInput.fill('Test Transponder');

    await page.getByRole('button', { name: /^Add Equipment$/ }).click();

    if (apiErrors.length) {
      throw new Error(`/api/equipment errored:\n${apiErrors.join('\n')}`);
    }

    // Toast text from EquipmentTab.tsx:251 — "Equipment added."
    await expect(page.getByText(/equipment added/i).first()).toBeVisible({ timeout: 30_000 });

    // DB-side: row exists, scoped to this aircraft.
    const admin = adminClient();
    const { data: rows, error } = await admin
      .from('aft_aircraft_equipment')
      .select('id, name, make, category, removed_at')
      .eq('aircraft_id', seededUser.aircraftId)
      .is('removed_at', null);
    if (error) throw new Error(`equipment read: ${error.message}`);
    expect(rows?.length).toBe(1);
    expect(rows![0].name).toBe('Test Transponder');
    expect(rows![0].make?.toLowerCase()).toContain('garmin');

    // UI-side: the new row should appear in the Currently Installed list.
    await expect(page.getByText('Test Transponder').first()).toBeVisible({ timeout: 5_000 });
  });
});

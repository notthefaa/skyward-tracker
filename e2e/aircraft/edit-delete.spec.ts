import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';

/**
 * Aircraft modal — edit + delete flows from the Summary tab. Both
 * are destructive paths reachable from a single icon-button on the
 * hero, so coverage matters: a regression here either silently keeps
 * stale data (edit) or wipes a fleet entry (delete).
 *
 * Two tests share one fixture; we don't merge them so a delete-spec
 * regression doesn't take the edit-spec down with it.
 */
test.describe('Aircraft — edit + delete', () => {
  test('admin edits the aircraft tail and the row reflects the change', async ({ page, seededUser }) => {
    test.setTimeout(90_000);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(seededUser.email);
    await page.locator('input[type="password"]').fill(seededUser.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    // Land on Summary (default tab after login for onboarded users).
    await expect(page.getByRole('button', { name: 'Edit Aircraft' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Edit Aircraft' }).click();

    await expect(page.getByRole('heading', { name: 'Edit Aircraft' })).toBeVisible();

    // Submit-time read happens via FormData on `name="tail_number"`,
    // so the test must use that input. State sync is also via onChange,
    // so a fill() lands in both places.
    const NEW_TAIL = `${seededUser.tailNumber}X`;
    await page.locator('input[name="tail_number"]').fill(NEW_TAIL);

    await page.getByRole('button', { name: /save aircraft/i }).click();

    // Modal closes on success; verify it's gone.
    await expect(page.getByRole('heading', { name: 'Edit Aircraft' })).toBeHidden({ timeout: 20_000 });

    // DB-side: tail number updated.
    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_aircraft')
      .select('tail_number')
      .eq('id', seededUser.aircraftId)
      .single();
    expect(row?.tail_number).toBe(NEW_TAIL);
  });

  test('admin deletes the aircraft after a confirmation modal', async ({ page, seededUser }) => {
    test.setTimeout(90_000);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(seededUser.email);
    await page.locator('input[type="password"]').fill(seededUser.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByRole('button', { name: 'Delete Aircraft' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Delete Aircraft' }).click();

    // Confirm the destructive prompt
    await expect(page.getByRole('heading', { name: 'Delete Aircraft' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm Delete' }).click();

    // After delete the user lands on a no-aircraft state. The aircraft is
    // soft-deleted, so `deleted_at` becomes non-null and the row is hidden
    // from the user's fleet (access grants are also hard-deleted).
    const admin = adminClient();
    await expect.poll(async () => {
      const { data } = await admin
        .from('aft_aircraft')
        .select('deleted_at')
        .eq('id', seededUser.aircraftId)
        .single();
      return data?.deleted_at ?? null;
    }, { timeout: 15_000 }).not.toBeNull();

    // Access grant should also be cleaned up (hard delete).
    const { data: access } = await admin
      .from('aft_user_aircraft_access')
      .select('user_id')
      .eq('aircraft_id', seededUser.aircraftId);
    expect(access?.length ?? 0).toBe(0);
  });
});

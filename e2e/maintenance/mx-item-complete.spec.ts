import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';

/**
 * MX → Due Items: one-tap "Mark complete" on an existing item.
 * Recreates the field-report scenario where a pilot couldn't figure
 * out how to mark an annual inspection done in 15+ minutes; the
 * "Mark complete" button (CheckCircle icon) on each row records
 * today's date / current Hobbs and slides the next-due forward.
 */
test.describe('Maintenance → Due Items — mark complete', () => {
  test('admin marks an annual-style item complete; due_date slides forward + flags reset', async ({ page, seededUser }) => {
    test.setTimeout(90_000);

    // Seed an item that's already past-due so the "complete" path
    // visibly slides the due date forward (instead of being a no-op).
    const admin = adminClient();
    const { data: created, error: insertErr } = await admin
      .from('aft_maintenance_items')
      .insert({
        aircraft_id: seededUser.aircraftId,
        item_name: 'Annual Inspection (test)',
        tracking_type: 'date',
        is_required: true,
        last_completed_date: '2024-01-15',
        date_interval_days: 365,
        due_date: '2025-01-15',
        primary_heads_up_sent: true,
        mx_schedule_sent: true,
        reminder_30_sent: true,
        reminder_15_sent: true,
        reminder_5_sent: true,
      })
      .select('id, due_date, primary_heads_up_sent')
      .single();
    if (insertErr) throw new Error(`seed mx item: ${insertErr.message}`);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(seededUser.email);
    await page.locator('input[type="password"]').fill(seededUser.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
    const secondaryNav = page.getByRole('navigation', { name: 'Secondary navigation' });

    await expect(mainNav.getByRole('button', { name: 'MX', exact: true })).toBeVisible({ timeout: 20_000 });
    await mainNav.getByRole('button', { name: 'MX', exact: true }).click();
    await secondaryNav.getByRole('button', { name: 'Due Items', exact: true }).click();

    // The item row should now be visible. The "Mark complete" button
    // sits inside the row; targeting it via title (the tooltip text)
    // is stable across icon rotation.
    const itemRow = page.locator('div', { hasText: 'Annual Inspection (test)' }).first();
    await expect(itemRow).toBeVisible({ timeout: 10_000 });

    await page.getByTitle(/mark complete/i).first().click();

    // Confirm modal — "Mark complete" button (the confirm action,
    // not the icon) is the green confirm button.
    await page.getByRole('button', { name: /^mark complete$/i }).click();

    // Success toast.
    await expect(page.getByText(/marked complete/i).first()).toBeVisible({ timeout: 30_000 });

    // DB-side: due_date should have moved forward, flags should be reset.
    // Allow a moment for the SWR mutate to settle so the user sees the
    // updated row before we assert the DB.
    await page.waitForTimeout(500);
    const { data: refreshed, error: readErr } = await admin
      .from('aft_maintenance_items')
      .select('due_date, last_completed_date, primary_heads_up_sent, mx_schedule_sent, reminder_5_sent, reminder_15_sent, reminder_30_sent')
      .eq('id', created!.id)
      .single();
    if (readErr) throw new Error(`mx item read: ${readErr.message}`);

    // last_completed_date should be today (test runs in UTC of the
    // CI host; allow the local-vs-UTC slop).
    expect(refreshed!.last_completed_date).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(refreshed!.last_completed_date).not.toBe('2024-01-15');

    // due_date should be ~365 days after last_completed_date.
    const last = new Date(refreshed!.last_completed_date + 'T12:00:00');
    const due = new Date(refreshed!.due_date + 'T12:00:00');
    const days = Math.round((due.getTime() - last.getTime()) / (24 * 60 * 60 * 1000));
    expect(days).toBe(365);

    // Flags reset so the next approaching-due email cycle re-fires.
    expect(refreshed!.primary_heads_up_sent).toBe(false);
    expect(refreshed!.mx_schedule_sent).toBe(false);
    expect(refreshed!.reminder_5_sent).toBe(false);
    expect(refreshed!.reminder_15_sent).toBe(false);
    expect(refreshed!.reminder_30_sent).toBe(false);
  });
});

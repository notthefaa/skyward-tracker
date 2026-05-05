import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';

/**
 * Calendar — create a single non-recurring reservation. Pairs with
 * api/reservations.spec.ts (which covers the cross-aircraft + RLS
 * guards) by exercising the form contract end-to-end.
 *
 * The seeded user is the only pilot on this aircraft, so there's no
 * "Book For" toggle; the form goes straight to date/time pickers.
 */
test.describe('Calendar — book a reservation', () => {
  test('admin reserves the aircraft for a future window', async ({ page, seededUser }) => {
    test.setTimeout(120_000);

    const apiErrors: string[] = [];
    page.on('response', async (res) => {
      if (res.url().includes('/api/reservations') && !res.ok()) {
        apiErrors.push(`${res.status()} ${res.url()} :: ${await res.text().catch(() => '')}`);
      }
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(seededUser.email);
    await page.locator('input[type="password"]').fill(seededUser.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    const mainNav = page.getByRole('navigation', { name: 'Main navigation' });

    await expect(mainNav.getByRole('button', { name: 'Calendar', exact: true })).toBeVisible({ timeout: 20_000 });
    await mainNav.getByRole('button', { name: 'Calendar', exact: true }).click();

    // Open the reservation form.
    await page.getByRole('button', { name: /reserve aircraft/i }).first().click();
    await expect(page.getByRole('heading', { name: /reserve aircraft/i })).toBeVisible();

    // Pick a window two weeks out so it doesn't collide with anything.
    const start = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const hm = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

    // Date inputs in the booking modal — Departure date+time, Return date+time.
    const dateInputs = page.locator('div[role="dialog"], .animate-slide-up').locator('input[type="date"]');
    const timeInputs = page.locator('div[role="dialog"], .animate-slide-up').locator('input[type="time"]');

    await dateInputs.nth(0).fill(ymd(start));
    await timeInputs.nth(0).fill(hm(start));
    await dateInputs.nth(1).fill(ymd(end));
    await timeInputs.nth(1).fill(hm(end));

    // Optional purpose
    await page.getByPlaceholder('Weekend trip, Business travel...').fill('E2E reservation smoke');

    await page.getByRole('button', { name: /^Confirm Reservation$/ }).click();

    if (apiErrors.length) {
      throw new Error(`/api/reservations errored:\n${apiErrors.join('\n')}`);
    }

    await expect(page.getByText(/reservation confirmed/i).first()).toBeVisible({ timeout: 15_000 });

    // DB-side verification. Reservations use status='cancelled' for
    // soft-delete (no deleted_at column).
    const admin = adminClient();
    const { data: rows, error } = await admin
      .from('aft_reservations')
      .select('id, title, status')
      .eq('aircraft_id', seededUser.aircraftId)
      .eq('status', 'confirmed');
    if (error) throw new Error(`reservations read: ${error.message}`);
    expect(rows?.length).toBe(1);
    expect(rows![0].title).toBe('E2E reservation smoke');
  });
});

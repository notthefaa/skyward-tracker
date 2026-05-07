import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';

/**
 * Calendar — month/week/day view toggle, header format per mode,
 * chevron step delta per active view, Today reset, and month-cell
 * drill-down to day view.
 *
 * UI-only: no /api/* hits, no AI cost. The drill-down test inserts a
 * reservation directly via the admin client (bypasses the booking
 * form, which already has its own spec) and asserts the title shows
 * up in the ReservationCard once we land in day view.
 */
test.describe('Calendar — view modes', () => {
  test.setTimeout(120_000);

  // Header label is the same `<button aria-label="Jump to a different month">`
  // in all three views; only its text content swaps.
  const monthRe = /^[A-Z][a-z]+ \d{4}$/;                                    // "May 2026"
  const weekRe  = /^[A-Z][a-z]{2,} \d{1,2} — [A-Z][a-z]{2,} \d{1,2}, \d{4}$/; // "May 3 — May 9, 2026"
  const dayRe   = /^[A-Z][a-z]+, [A-Z][a-z]+ \d{1,2}, \d{4}$/;              // "Friday, May 8, 2026"

  async function signInAndOpenCalendar(page: any, seededUser: { email: string; password: string }) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(seededUser.email);
    await page.locator('input[type="password"]').fill(seededUser.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(mainNav.getByRole('button', { name: 'Calendar', exact: true })).toBeVisible({ timeout: 20_000 });
    await mainNav.getByRole('button', { name: 'Calendar', exact: true }).click();

    const labelBtn = page.getByRole('button', { name: 'Jump to a different month' });
    await expect(labelBtn).toBeVisible({ timeout: 20_000 });
    return { labelBtn };
  }

  test('toggles month / week / day and updates the header format', async ({ page, seededUser }) => {
    const { labelBtn } = await signInAndOpenCalendar(page, seededUser);

    const monthBtn = page.getByRole('button', { name: 'month', exact: true });
    const weekBtn  = page.getByRole('button', { name: 'week',  exact: true });
    const dayBtn   = page.getByRole('button', { name: 'day',   exact: true });

    // Default = month. Selected button has the brand-green chip class.
    await expect(labelBtn).toHaveText(monthRe);
    await expect(monthBtn).toHaveClass(/56B94A/);
    await expect(weekBtn).not.toHaveClass(/56B94A/);
    await expect(dayBtn).not.toHaveClass(/56B94A/);

    // Switch to week.
    await weekBtn.click();
    await expect(labelBtn).toHaveText(weekRe);
    await expect(weekBtn).toHaveClass(/56B94A/);
    await expect(monthBtn).not.toHaveClass(/56B94A/);

    // Switch to day.
    await dayBtn.click();
    await expect(labelBtn).toHaveText(dayRe);
    await expect(dayBtn).toHaveClass(/56B94A/);
    await expect(weekBtn).not.toHaveClass(/56B94A/);

    // Back to month round-trips cleanly.
    await monthBtn.click();
    await expect(labelBtn).toHaveText(monthRe);
    await expect(monthBtn).toHaveClass(/56B94A/);
  });

  test('chevrons step by month / week / day per active view; Today resets', async ({ page, seededUser }) => {
    const { labelBtn } = await signInAndOpenCalendar(page, seededUser);

    const next  = page.getByRole('button', { name: 'Next',  exact: true });
    const today = page.getByRole('button', { name: 'Today', exact: true });

    // MONTH: Next advances by one calendar month.
    const monthInitial = (await labelBtn.textContent())?.trim();
    expect(monthInitial).toMatch(monthRe);
    await next.click();
    const monthAfter = (await labelBtn.textContent())?.trim();
    expect(monthAfter).toMatch(monthRe);
    expect(monthAfter).not.toBe(monthInitial);
    await today.click();
    await expect(labelBtn).toHaveText(monthInitial!);

    // WEEK: Next advances by 7 days.
    await page.getByRole('button', { name: 'week', exact: true }).click();
    const weekInitial = (await labelBtn.textContent())?.trim();
    expect(weekInitial).toMatch(weekRe);
    await next.click();
    const weekAfter = (await labelBtn.textContent())?.trim();
    expect(weekAfter).toMatch(weekRe);
    expect(weekAfter).not.toBe(weekInitial);
    await today.click();
    await expect(labelBtn).toHaveText(weekInitial!);

    // DAY: Next advances by 1 day.
    await page.getByRole('button', { name: 'day', exact: true }).click();
    const dayInitial = (await labelBtn.textContent())?.trim();
    expect(dayInitial).toMatch(dayRe);
    await next.click();
    const dayAfter = (await labelBtn.textContent())?.trim();
    expect(dayAfter).toMatch(dayRe);
    expect(dayAfter).not.toBe(dayInitial);
    await today.click();
    await expect(labelBtn).toHaveText(dayInitial!);
  });

  test('clicking a month-grid cell drills into day view and surfaces the reservation', async ({ page, seededUser }) => {
    const admin = adminClient();

    // Reservation 4 hours from now — same UTC day, today's day cell in
    // the rendered grid (the browser inside Playwright's Docker image
    // runs in UTC, matching the Node fixture's clock).
    const start = new Date(Date.now() + 4 * 3600_000);
    const end = new Date(Date.now() + 6 * 3600_000);
    const title = `view-mode-drilldown-${Date.now()}`;
    const { error: insErr } = await admin.from('aft_reservations').insert({
      aircraft_id: seededUser.aircraftId,
      user_id: seededUser.userId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: 'confirmed',
      title,
    });
    if (insErr) throw new Error(`reservation insert: ${insErr.message}`);

    try {
      const { labelBtn } = await signInAndOpenCalendar(page, seededUser);

      // Default month view. Find today's day cell — it's a button whose
      // first child span renders the day-of-month text.
      const todayDom = String(new Date().getUTCDate());
      const calendarCard = labelBtn.locator('xpath=ancestor::div[contains(@class, "border-t-4")][1]');
      const todayCell = calendarCard.locator(`button:has(> span:text-is("${todayDom}"))`).first();
      await expect(todayCell).toBeVisible();
      await todayCell.click();

      // Landed in day view: header label is the long weekday format.
      await expect(labelBtn).toHaveText(dayRe);
      await expect(page.getByRole('button', { name: 'day', exact: true })).toHaveClass(/56B94A/);

      // ReservationCard renders the title in day view.
      await expect(page.getByText(title)).toBeVisible();
    } finally {
      // Best-effort cleanup; aircraft delete in the fixture would
      // cascade anyway, but keep the row-set tight in case the test
      // is rerun against the same project.
      try { await admin.from('aft_reservations').delete().eq('title', title); } catch { /* noop */ }
    }
  });
});

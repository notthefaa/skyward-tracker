import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { randomUUID } from 'node:crypto';

/**
 * Aircraft switch — the new aircraft's data must render without a
 * reload, without a hang, and without `recoveryReload()` firing as
 * the routine path. Locks in the iOS resume hardening trio:
 *   - Symmetric abort wiring (supabase + authFetch on every
 *     lifecycle path)
 *   - Canonical-key revalidation on switch (clears FETCH-zombie
 *     entries even for keys never written into cache)
 *   - 5min `recoveryReload` threshold (no longer the routine path)
 *
 * Setup: the seededUser has aircraft A. The test admin-creates a
 * second aircraft B owned by the same user, inserts a unique
 * reservation today on each aircraft, then signs in and switches
 * via the toolbar dropdown. Day-view reservation title is the
 * scope assertion — A's title disappears, B's title renders.
 */
test.describe('Aircraft switch — destination data renders without reload', () => {
  test.setTimeout(180_000);

  test('switching from A to B in the toolbar loads B\'s data immediately', async ({ page, seededUser }) => {
    const admin = adminClient();

    // Seed aircraft B for the same user via the same RPC the app uses.
    const tailB = `N${randomUUID().slice(0, 5).toUpperCase()}`;
    const { data: bRow, error: bErr } = await admin.rpc('create_aircraft_atomic', {
      p_user_id: seededUser.userId,
      p_payload: {
        tail_number: tailB,
        aircraft_type: 'Cessna 182T',
        engine_type: 'Piston',
        total_airframe_time: 750,
        total_engine_time: 750,
        setup_hobbs: 750,
        setup_tach: 750,
      },
    });
    if (bErr || !bRow) throw new Error(`create_aircraft_atomic B: ${bErr?.message}`);
    const aircraftBId = (bRow as { id: string }).id;

    // Distinguishing reservations on each aircraft, both today so a
    // single Day-view drill-in surfaces the right one.
    const titleA = `switch-test-A-${Date.now()}`;
    const titleB = `switch-test-B-${Date.now()}`;
    const start = new Date(Date.now() + 4 * 3600_000);
    const end = new Date(Date.now() + 6 * 3600_000);
    const insertA = await admin.from('aft_reservations').insert({
      aircraft_id: seededUser.aircraftId,
      user_id: seededUser.userId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: 'confirmed',
      title: titleA,
    });
    if (insertA.error) throw new Error(`insert A: ${insertA.error.message}`);
    const insertB = await admin.from('aft_reservations').insert({
      aircraft_id: aircraftBId,
      user_id: seededUser.userId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: 'confirmed',
      title: titleB,
    });
    if (insertB.error) throw new Error(`insert B: ${insertB.error.message}`);

    try {
      // Capture any `recoveryReload firing` warning — its absence is
      // half the contract. Routine aircraft-switch paths must not need
      // a JS-process reset.
      const recoveryReloadFires: string[] = [];
      page.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'warning' && text.includes('recoveryReload firing')) {
          recoveryReloadFires.push(text);
        }
      });

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.locator('input[type="email"]').fill(seededUser.email);
      await page.locator('input[type="password"]').fill(seededUser.password);
      await page.getByRole('button', { name: 'Log in' }).click();

      const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
      await expect(mainNav.getByRole('button', { name: 'Calendar', exact: true })).toBeVisible({ timeout: 20_000 });

      // Make sure aircraft A is the active tail before we switch. The
      // initial fetch may pick either A or B depending on save state;
      // explicitly pick A from the dropdown if needed.
      const tailDropdownTrigger = page.getByRole('button', { name: 'Switch aircraft' });
      await expect(tailDropdownTrigger).toBeVisible({ timeout: 20_000 });
      await tailDropdownTrigger.click();
      const dropdown = page.getByRole('listbox', { name: 'Aircraft selection' });
      await expect(dropdown).toBeVisible();
      await dropdown.getByRole('option').filter({ hasText: seededUser.tailNumber }).click();
      await expect(dropdown).not.toBeVisible();

      // Land on Calendar, drill to today's day cell.
      await mainNav.getByRole('button', { name: 'Calendar', exact: true }).click();
      const labelBtn = page.getByRole('button', { name: 'Jump to a different month' });
      await expect(labelBtn).toBeVisible({ timeout: 20_000 });
      const dayBtn = page.getByRole('button', { name: 'day', exact: true });
      await dayBtn.click();
      // Day-view of today: A's reservation visible, B's not.
      await expect(page.getByText(titleA)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(titleB)).toHaveCount(0);

      // Switch to B via the toolbar dropdown. `handleTailChange`
      // auto-navigates to the Summary tab on switch, so we re-open
      // Calendar afterwards and drill back to the day view.
      await tailDropdownTrigger.click();
      await expect(dropdown).toBeVisible();
      await dropdown.getByRole('option').filter({ hasText: tailB }).click();
      await expect(dropdown).not.toBeVisible();

      await mainNav.getByRole('button', { name: 'Calendar', exact: true }).click();
      await expect(labelBtn).toBeVisible({ timeout: 20_000 });
      await dayBtn.click();

      // After switch: B's reservation must surface and A's must vanish
      // — within a generous timeout to absorb network jitter, but
      // without needing a pull-to-refresh or a reload.
      await expect(page.getByText(titleB)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(titleA)).toHaveCount(0);

      // Routine switch path must not fire a recoveryReload.
      expect(recoveryReloadFires).toEqual([]);
    } finally {
      // Cleanup: aircraft B + its reservation + A's reservation.
      // Aircraft A + user are torn down by the seededUser fixture.
      try { await admin.from('aft_reservations').delete().in('title', [titleA, titleB]); } catch { /* noop */ }
      try { await admin.from('aft_aircraft').delete().eq('id', aircraftBId); } catch { /* noop */ }
    }
  });
});

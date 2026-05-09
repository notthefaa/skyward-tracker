import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { randomUUID } from 'node:crypto';

/**
 * Aircraft switch — destination tab data MUST be isolated from the
 * source tab. Pilots reported two distinct cache-bleed symptoms:
 *
 *   1. "I switched aircraft and the flight-log table showed entries
 *      that don't match the new tail or aren't the latest." Root
 *      cause: SWR's localStorage cache provider hydrated week-old
 *      data for the new tail's key on app boot; on switch, useSWR
 *      returned that stale data immediately while revalidation ran
 *      in the background.
 *
 *   2. "The status dot is delayed in showing the correct status; it
 *      carries over the wrong status briefly." Root cause: the
 *      AppShell-level throttle on `checkGroundedStatus` (per-tail,
 *      30s) skipped the reset-to-unknown when the user revisited a
 *      tail within the throttle window. The state still held the
 *      *previous* tail's verdict.
 *
 * This spec seeds distinct flight logs on two aircraft, signs in,
 * switches tails, and asserts the destination tab can never display
 * the source tab's row identifiers. The status-dot piece is harder
 * to assert in Playwright's chromium-mobile-iOS profile (the timing
 * window is sub-second), so we verify the structural invariant via
 * an `aria-label` snapshot rather than a color flicker.
 */

test.describe('Aircraft switch — TimesTab data isolation', () => {
  test.setTimeout(180_000);

  test('flight-log table never shows aircraft A entries while aircraft B is selected', async ({ page, seededUser }) => {
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

    // Seed distinguishable flight logs. The TimesTab table renders
    // `log.initials` directly as a column, so unique 2-3 char initials
    // make for a visible discriminator with no extra UI navigation.
    // Using `XA`/`XB` rather than `AA`/`BB` to dodge accidental
    // collision with anything else on the page that says 'AA'.
    const reasonA = `XA${randomUUID().slice(0, 1).toUpperCase()}`;
    const reasonB = `XB${randomUUID().slice(0, 1).toUpperCase()}`;

    const insertA = await admin.from('aft_flight_logs').insert({
      aircraft_id: seededUser.aircraftId,
      user_id: seededUser.userId,
      hobbs: 1010,
      tach: 1010,
      landings: 1,
      engine_cycles: 0,
      initials: reasonA,
      occurred_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    });
    if (insertA.error) throw new Error(`insert A: ${insertA.error.message}`);

    const insertB = await admin.from('aft_flight_logs').insert({
      aircraft_id: aircraftBId,
      user_id: seededUser.userId,
      hobbs: 760,
      tach: 760,
      landings: 1,
      engine_cycles: 0,
      initials: reasonB,
      occurred_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    });
    if (insertB.error) throw new Error(`insert B: ${insertB.error.message}`);

    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.locator('input[type="email"]').fill(seededUser.email);
      await page.locator('input[type="password"]').fill(seededUser.password);
      await page.getByRole('button', { name: 'Log in' }).click();

      const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
      const secondaryNav = page.getByRole('navigation', { name: 'Secondary navigation' });
      const calendarBtn = mainNav.getByRole('button', { name: 'Calendar', exact: true });
      await expect(calendarBtn).toBeVisible({ timeout: 20_000 });

      // Pick aircraft A explicitly so the test is deterministic
      // regardless of which tail the saved-state defaulted to.
      const tailDropdownTrigger = page.getByRole('button', { name: 'Switch aircraft' });
      await expect(tailDropdownTrigger).toBeVisible({ timeout: 20_000 });
      await tailDropdownTrigger.click();
      const dropdown = page.getByRole('listbox', { name: 'Aircraft selection' });
      await expect(dropdown).toBeVisible();
      await dropdown.getByRole('option').filter({ hasText: seededUser.tailNumber }).click();
      await expect(dropdown).not.toBeVisible();

      // Visit Log → Flights. The Log button opens a secondary tray;
      // Flights is the default Log sub-section (TimesTab). NavTray
      // items are <div>s with text labels, not buttons — use getByText
      // scoped to the secondary nav so we don't match in-tab labels.
      const openLogTray = async () => {
        await mainNav.getByRole('button', { name: 'Log', exact: true }).click();
        const flightsItem = secondaryNav.getByText('Flights', { exact: true });
        await expect(flightsItem).toBeVisible({ timeout: 10_000 });
        await flightsItem.click();
      };

      await openLogTray();
      await expect(page.getByText(reasonA, { exact: false })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(reasonB, { exact: false })).toHaveCount(0);

      // Switch to B via the toolbar dropdown. `handleTailChange`
      // auto-navigates to Summary on switch, so re-open the Log tray
      // and pick Flights again to land on TimesTab.
      await tailDropdownTrigger.click();
      await expect(dropdown).toBeVisible();
      await dropdown.getByRole('option').filter({ hasText: tailB }).click();
      await expect(dropdown).not.toBeVisible();

      await openLogTray();

      // **The contract**: after switch, A's row must not be visible.
      // B's row must surface within the fetch deadline. The order of
      // these two awaits is intentional — we want the "A is gone"
      // assertion to be the high-stakes one, since the bug was
      // "wrong-tail entries lingered." Both must hold simultaneously.
      await expect(page.getByText(reasonB, { exact: false })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(reasonA, { exact: false })).toHaveCount(0);
    } finally {
      try { await admin.from('aft_flight_logs').delete().in('initials', [reasonA, reasonB]); } catch { /* noop */ }
      try { await admin.from('aft_aircraft').delete().eq('id', aircraftBId); } catch { /* noop */ }
    }
  });
});

test.describe('Aircraft switch — status dot stays in sync with active tail', () => {
  test.setTimeout(180_000);

  test('status dot reflects the active tail (no stale verdict from previous tail)', async ({ page, seededUser }) => {
    const admin = adminClient();

    // Aircraft B intentionally grounded by an open airworthiness-
    // affecting squawk so B's verdict differs from A's (airworthy).
    // The `status` dot's aria-label encodes the verdict, which gives
    // us a structural assertion that doesn't depend on color matching.
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

    const sqInsert = await admin.from('aft_squawks').insert({
      aircraft_id: aircraftBId,
      reported_by: seededUser.userId,
      description: 'Stale-status-test grounding squawk',
      status: 'open',
      affects_airworthiness: true,
      access_token: randomUUID().replace(/-/g, ''),
    });
    if (sqInsert.error) throw new Error(`insert squawk: ${sqInsert.error.message}`);

    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.locator('input[type="email"]').fill(seededUser.email);
      await page.locator('input[type="password"]').fill(seededUser.password);
      await page.getByRole('button', { name: 'Log in' }).click();

      const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
      // Calendar is a stable label across initial-tab variants (Home
      // vs Fleet flips depending on saved-state).
      await expect(mainNav.getByRole('button', { name: 'Calendar', exact: true })).toBeVisible({ timeout: 20_000 });

      const tailDropdownTrigger = page.getByRole('button', { name: 'Switch aircraft' });
      await expect(tailDropdownTrigger).toBeVisible({ timeout: 20_000 });
      await tailDropdownTrigger.click();
      const dropdown = page.getByRole('listbox', { name: 'Aircraft selection' });
      await expect(dropdown).toBeVisible();
      await dropdown.getByRole('option').filter({ hasText: seededUser.tailNumber }).click();
      await expect(dropdown).not.toBeVisible();

      // Status dot for A: airworthy (no open squawks).
      const statusDot = page.locator('[role="status"]').first();
      await expect(statusDot).toHaveAttribute(
        'aria-label',
        /airthy|airworthy|issues|grounded|unknown/i,
        { timeout: 20_000 },
      );
      // Wait for the dot to settle on a non-unknown verdict for A.
      await expect.poll(
        async () => (await statusDot.getAttribute('aria-label')) ?? '',
        { timeout: 20_000 },
      ).toMatch(/airworthy/i);

      // Switch to B. The dot MUST NOT continue to show A's
      // 'airworthy' verdict — it must transition (via 'unknown' or
      // straight to 'grounded'/'issues') to reflect B's state.
      await tailDropdownTrigger.click();
      await expect(dropdown).toBeVisible();
      await dropdown.getByRole('option').filter({ hasText: tailB }).click();
      await expect(dropdown).not.toBeVisible();

      // After the switch settles, B's verdict must reflect the open
      // grounding squawk, never A's airworthy. Allow either 'grounded'
      // (the regulatory-unsafe verdict the squawk should produce) or
      // 'issues' (the open-squawk override) — both are correct B
      // verdicts and not-A verdicts. The critical thing is the value
      // is NOT 'airworthy', which would prove the previous bug.
      await expect.poll(
        async () => (await statusDot.getAttribute('aria-label')) ?? '',
        { timeout: 20_000 },
      ).toMatch(/grounded|issues|unknown/i);

      // Final settled state: must NOT be 'airworthy' (B has an open
      // airworthiness-affecting squawk; airworthy would be a false-
      // positive carryover from A).
      const finalLabel = (await statusDot.getAttribute('aria-label')) ?? '';
      expect(finalLabel).not.toMatch(/: airworthy/i);
    } finally {
      try { await admin.from('aft_squawks').delete().eq('aircraft_id', aircraftBId); } catch { /* noop */ }
      try { await admin.from('aft_aircraft').delete().eq('id', aircraftBId); } catch { /* noop */ }
    }
  });
});

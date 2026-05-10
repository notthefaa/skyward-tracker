import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { randomUUID } from 'node:crypto';

/**
 * Field-report repro: pilot opened iOS PWA, switched through 4 aircraft
 * fine, hit aircraft #5 and got a hung gray status dot, placeholder
 * avatar, and no flight-log/squawk data on the destination tab. The
 * suspect is a per-tail caching/abort bug that only surfaces when the
 * fleet has more than the typical 2 aircraft we test with.
 *
 * This spec seeds 5 aircraft for the same user, each with:
 *   - a flight log (unique initials so we can prove "this aircraft's
 *     row is on screen")
 *   - an open squawk (so the airworthiness dot must resolve to
 *     'issues' or 'grounded' — never gray-stuck)
 *   - an avatar_url stored on the aircraft row (signed-URL hook should
 *     not log warnings during the switch)
 *
 * It then logs in, iterates the 5 tails IN ORDER, and after each
 * switch asserts within 10s that:
 *   1. The header shows the new tail
 *   2. The aircraft summary tab loads its data (the per-tail flight
 *      log row's initials surface on the Times tab)
 *   3. The status dot is NOT gray (resolved to airworthy/issues/grounded)
 *
 * Console warnings from `recoveryReload`, `useGroundedStatus` fetch
 * failures, or signed-URL hook failures are collected throughout and
 * fail the test if any fired — they'd indicate the bug is reproduced.
 *
 * The test runs in two timing modes (fast: no inter-switch wait,
 * paced: 1s pause between switches) to flush out timing-dependent
 * cache-bleed / abort-zombie bugs.
 */

const PISTON_TYPES = ['Cessna 172S', 'Cessna 182T', 'Piper PA-28-181', 'Cirrus SR22', 'Diamond DA40'];
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

function publicAvatarUrl(aircraftId: string): string {
  // The bucket is private, but we only need a stored URL — the signed-URL
  // hook still has to handle it, which is half the contract being tested.
  return `${SUPABASE_URL}/storage/v1/object/public/aft_aircraft_avatars/${aircraftId}_${Date.now()}.jpg`;
}

type SeededAircraft = {
  id: string;
  tail: string;
  initials: string;
  squawkDesc: string;
};

async function seedFourMoreAircraft(userId: string, primaryAircraftId: string, primaryTail: string): Promise<SeededAircraft[]> {
  const admin = adminClient();
  const all: SeededAircraft[] = [];

  // Seed the primary's own flight log + squawk + avatar so it matches the
  // shape of the other 4 — every aircraft must have unique data to prove
  // "this aircraft's data loaded" rather than "any data loaded".
  const primaryInitials = `X1${randomUUID().slice(0, 1).toUpperCase()}`;
  const primarySquawkDesc = `5ac-test squawk #1 ${randomUUID().slice(0, 4)}`;
  await admin.from('aft_flight_logs').insert({
    aircraft_id: primaryAircraftId,
    user_id: userId,
    hobbs: 1010,
    tach: 1010,
    landings: 1,
    engine_cycles: 0,
    initials: primaryInitials,
    occurred_at: new Date(Date.now() - 1 * 3600_000).toISOString(),
  }).then(({ error }) => { if (error) throw new Error(`primary flight: ${error.message}`); });
  await admin.from('aft_squawks').insert({
    aircraft_id: primaryAircraftId,
    reported_by: userId,
    description: primarySquawkDesc,
    status: 'open',
    affects_airworthiness: true,
    access_token: randomUUID().replace(/-/g, ''),
  }).then(({ error }) => { if (error) throw new Error(`primary squawk: ${error.message}`); });
  await admin.from('aft_aircraft').update({ avatar_url: publicAvatarUrl(primaryAircraftId) }).eq('id', primaryAircraftId)
    .then(({ error }) => { if (error) throw new Error(`primary avatar: ${error.message}`); });
  all.push({ id: primaryAircraftId, tail: primaryTail, initials: primaryInitials, squawkDesc: primarySquawkDesc });

  // Seed the additional 4 aircraft (so the user has 5 total).
  for (let i = 2; i <= 5; i++) {
    const tail = `N${randomUUID().slice(0, 5).toUpperCase()}`;
    const { data: row, error: rpcErr } = await admin.rpc('create_aircraft_atomic', {
      p_user_id: userId,
      p_payload: {
        tail_number: tail,
        aircraft_type: PISTON_TYPES[(i - 1) % PISTON_TYPES.length],
        engine_type: 'Piston',
        total_airframe_time: 500 + i * 100,
        total_engine_time: 500 + i * 100,
        setup_hobbs: 500 + i * 100,
        setup_tach: 500 + i * 100,
      },
    });
    if (rpcErr || !row) throw new Error(`create_aircraft_atomic ${i}: ${rpcErr?.message}`);
    const aircraftId = (row as { id: string }).id;

    const initials = `X${i}${randomUUID().slice(0, 1).toUpperCase()}`;
    const squawkDesc = `5ac-test squawk #${i} ${randomUUID().slice(0, 4)}`;

    await admin.from('aft_flight_logs').insert({
      aircraft_id: aircraftId,
      user_id: userId,
      hobbs: 500 + i * 100 + 10,
      tach: 500 + i * 100 + 10,
      landings: 1,
      engine_cycles: 0,
      initials,
      occurred_at: new Date(Date.now() - i * 3600_000).toISOString(),
    }).then(({ error }) => { if (error) throw new Error(`flight ${i}: ${error.message}`); });
    await admin.from('aft_squawks').insert({
      aircraft_id: aircraftId,
      reported_by: userId,
      description: squawkDesc,
      status: 'open',
      affects_airworthiness: i % 2 === 0, // alternate so verdict varies
      access_token: randomUUID().replace(/-/g, ''),
    }).then(({ error }) => { if (error) throw new Error(`squawk ${i}: ${error.message}`); });
    await admin.from('aft_aircraft').update({ avatar_url: publicAvatarUrl(aircraftId) }).eq('id', aircraftId)
      .then(({ error }) => { if (error) throw new Error(`avatar ${i}: ${error.message}`); });

    all.push({ id: aircraftId, tail, initials, squawkDesc });
  }

  return all;
}

async function teardownExtras(extraIds: string[]) {
  const admin = adminClient();
  // Cascade in supabase isn't reliable across these tables; clean
  // child rows first. seededUser fixture handles the primary aircraft.
  for (const id of extraIds) {
    try { await admin.from('aft_squawks').delete().eq('aircraft_id', id); } catch { /* noop */ }
    try { await admin.from('aft_flight_logs').delete().eq('aircraft_id', id); } catch { /* noop */ }
    try { await admin.from('aft_aircraft').delete().eq('id', id); } catch { /* noop */ }
  }
}

type Diagnostic = {
  type: 'console-warning' | 'console-error' | 'pageerror' | 'request-failed';
  text: string;
};

function attachDiagnosticListeners(page: import('@playwright/test').Page): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'warning') {
      // Bug-marker warnings — these are the ones the user reported in
      // adjacent fields ("recoveryReload firing" + per-tab fetch
      // failures) and should NEVER fire on a routine switch.
      if (
        text.includes('recoveryReload firing') ||
        text.includes('[useGroundedStatus] fetch failed') ||
        text.includes('[useSignedUrls]') ||
        text.includes('signed-url') ||
        text.includes('SWR')
      ) {
        diagnostics.push({ type: 'console-warning', text });
      }
    }
    if (msg.type() === 'error') {
      // Filter out noisy dev-server hot-reload errors and React DevTools
      // checks — only keep things that look like data-layer or auth
      // failures.
      if (
        text.includes('Failed to fetch') ||
        text.includes('AbortError') ||
        text.includes('supabase') ||
        text.includes('useSWR') ||
        text.includes('useFleetData') ||
        text.includes('useGroundedStatus')
      ) {
        diagnostics.push({ type: 'console-error', text });
      }
    }
  });
  page.on('pageerror', (err) => {
    diagnostics.push({ type: 'pageerror', text: err.message });
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure();
    const errText = failure?.errorText ?? '';
    // Skip noise:
    // - net::ERR_ABORTED — our own abort-on-switch registry firing
    // - "Load request cancelled" — same idea on chromium iOS profile
    // - hot-reload websocket and Next chunk fetches that get cancelled
    //   when the page transitions out of auth (lazy chunk no longer
    //   needed)
    // - /api/storage/sign cancellations (correct behavior on tail
    //   switch — the abort registry kills in-flight signing fetches)
    if (errText.includes('aborted') || errText.includes('ABORTED') || errText.includes('cancelled') || errText.includes('canceled')) return;
    if (req.url().includes('_next/')) return;
    if (req.url().includes('/api/storage/sign')) return;
    diagnostics.push({ type: 'request-failed', text: `${req.method()} ${req.url()} — ${errText}` });
  });

  return diagnostics;
}

async function loginAndPrepare(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(mainNav.getByRole('button', { name: 'Calendar', exact: true })).toBeVisible({ timeout: 30_000 });
}

async function switchToTail(page: import('@playwright/test').Page, tail: string) {
  const trigger = page.getByRole('button', { name: 'Switch aircraft' });
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
  const dropdown = page.getByRole('listbox', { name: 'Aircraft selection' });
  await expect(dropdown).toBeVisible({ timeout: 10_000 });
  await dropdown.getByRole('option').filter({ hasText: tail }).click();
  await expect(dropdown).not.toBeVisible({ timeout: 10_000 });
}

async function assertAircraftDataLoaded(
  page: import('@playwright/test').Page,
  ac: SeededAircraft,
) {
  // 1. Header tail label updated. The header's tail-link button has
  //    aria-label `View ${tail} summary`.
  await expect(page.getByRole('button', { name: `View ${ac.tail} summary` })).toBeVisible({ timeout: 10_000 });

  // 2. Status dot is not gray. The dot's aria-label encodes the verdict;
  //    'unknown' = gray. We allow a brief 'unknown' transition but require
  //    a non-gray verdict within 10s.
  const statusDot = page.locator('[role="status"][aria-label^="Aircraft status:"]').first();
  await expect.poll(
    async () => (await statusDot.getAttribute('aria-label')) ?? '',
    { timeout: 10_000, message: `${ac.tail}: status dot stuck on unknown/gray` },
  ).toMatch(/airworthy|issues|grounded/);

  // 3. Per-tail flight log row's initials surface on TimesTab. The
  //    `handleTailChange` auto-navigates to summary; we go to Log → Flights
  //    so the row is what we read off the screen, which is the strictest
  //    "this aircraft's data loaded" assertion we can make.
  const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
  const secondaryNav = page.getByRole('navigation', { name: 'Secondary navigation' });
  await mainNav.getByRole('button', { name: 'Log', exact: true }).click();
  const flightsItem = secondaryNav.getByText('Flights', { exact: true });
  await expect(flightsItem).toBeVisible({ timeout: 10_000 });
  await flightsItem.click();
  await expect(page.getByText(ac.initials, { exact: false })).toBeVisible({ timeout: 10_000 });
}

test.describe('Aircraft switch — 5-aircraft fleet, sequential switching', () => {
  test.setTimeout(360_000);

  for (const mode of ['fast', 'paced'] as const) {
    test(`switching through 5 aircraft in order [${mode}]`, async ({ page, seededUser }) => {
      const aircraft = await seedFourMoreAircraft(
        seededUser.userId,
        seededUser.aircraftId,
        seededUser.tailNumber,
      );
      const extraIds = aircraft.slice(1).map(a => a.id);

      try {
        const diagnostics = attachDiagnosticListeners(page);
        await loginAndPrepare(page, seededUser.email, seededUser.password);

        // Iterate all 5 in seeding order. The bug only manifested on
        // aircraft #5 — but we assert at every step so the failure mode
        // (which step + what's missing) is captured precisely.
        for (let i = 0; i < aircraft.length; i++) {
          const ac = aircraft[i];
          await switchToTail(page, ac.tail);
          if (mode === 'paced') await page.waitForTimeout(1_000);
          await assertAircraftDataLoaded(page, ac);

          // Bug-marker diagnostics: bail with the captured info if any
          // bug-marker warning fired during this switch's window.
          if (diagnostics.length > 0) {
            const summary = diagnostics.map(d => `[${d.type}] ${d.text}`).join('\n');
            throw new Error(`Bug markers fired during switch to aircraft #${i + 1} (${ac.tail}):\n${summary}`);
          }
        }
      } finally {
        await teardownExtras(extraIds);
      }
    });
  }

  // Stress variant: 8-switch loop (1→2→3→4→5→4→3→2→1) to flush out the
  // "magic N" suspicion — does the bug fire at a count threshold, or at
  // a specific aircraft, or only on net-new tails?
  test('rapid 8-switch loop across 5 aircraft (probes for magic-N pattern)', async ({ page, seededUser }) => {
    const aircraft = await seedFourMoreAircraft(
      seededUser.userId,
      seededUser.aircraftId,
      seededUser.tailNumber,
    );
    const extraIds = aircraft.slice(1).map(a => a.id);

    // 1→2→3→4→5→4→3→2→1 = 8 switches after the initial land
    const sequence = [aircraft[1], aircraft[2], aircraft[3], aircraft[4], aircraft[3], aircraft[2], aircraft[1], aircraft[0]];

    try {
      const diagnostics = attachDiagnosticListeners(page);
      await loginAndPrepare(page, seededUser.email, seededUser.password);

      for (let i = 0; i < sequence.length; i++) {
        const ac = sequence[i];
        await switchToTail(page, ac.tail);
        // No wait between switches — exercises the abort-on-switch path
        // before the previous switch's fetches have settled.
        await assertAircraftDataLoaded(page, ac);
        if (diagnostics.length > 0) {
          const summary = diagnostics.map(d => `[${d.type}] ${d.text}`).join('\n');
          throw new Error(`Bug markers fired during stress-loop switch #${i + 1} (${ac.tail}):\n${summary}`);
        }
      }
    } finally {
      await teardownExtras(extraIds);
    }
  });
});

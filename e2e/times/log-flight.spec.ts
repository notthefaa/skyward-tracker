import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';

test.describe('Times tab — log a flight', () => {
  test('Piston pilot logs a hop, totals advance, row appears in logbook', async ({ page, seededUser }) => {
    test.setTimeout(90_000);

    // Surface 5xxs from the flight-log path so a server bug doesn't
    // present as an inscrutable "save button stuck" UI symptom.
    const apiErrors: string[] = [];
    page.on('response', async (res) => {
      if (res.url().includes('/api/flight-logs') && !res.ok()) {
        apiErrors.push(`${res.status()} ${res.url()} :: ${await res.text().catch(() => '')}`);
      }
    });

    // ── Sign in
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(seededUser.email);
    await page.locator('input[type="password"]').fill(seededUser.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    // ── Wait for app shell — primary nav button "Log" is unique to the
    // logged-in chrome.
    const logNav = page.getByRole('button', { name: 'Log', exact: true });
    await expect(logNav).toBeVisible({ timeout: 20_000 });

    // ── Open the Log secondary tray, then jump to Flights.
    await logNav.click();
    await page.getByRole('button', { name: 'Flights' }).click();

    // ── Open the log-flight modal.
    await page.getByRole('button', { name: /log new flight/i }).click();
    await expect(page.getByRole('heading', { name: 'Log New Flight' })).toBeVisible();

    // ── Fill required fields. The seeded aircraft is Piston with Tach=1000.
    // Tach is the only required *time* meter for Piston.
    const tachInput = page.locator('input[type="number"]').filter({ has: page.locator('xpath=preceding-sibling::*//*[contains(., "Tach")]') }).first();
    // Fallback selector: the page's required Tach field is the first
    // required number input. The above XPath query is brittle, so use
    // a deterministic pickup by required attribute + step=0.1.
    const numericInputs = page.locator('input[type="number"][required]');
    await numericInputs.first().fill('1001'); // Tach: 1000 → 1001 (one-hour hop)
    await numericInputs.nth(1).fill('1');     // Landings
    await page.locator('input[maxlength="3"]').fill('TST'); // Initials

    await page.getByRole('button', { name: /save flight log/i }).click();

    if (apiErrors.length) {
      throw new Error(`/api/flight-logs errored:\n${apiErrors.join('\n')}`);
    }

    // ── Toast is the deterministic UX-side success signal.
    await expect(page.getByText(/flight logged/i)).toBeVisible({ timeout: 15_000 });

    // ── DB-side: confirm one log exists for this aircraft and totals are correct.
    const admin = adminClient();
    const { data: logs, error: logErr } = await admin
      .from('aft_flight_logs')
      .select('id, tach, hobbs, landings, initials')
      .eq('aircraft_id', seededUser.aircraftId)
      .is('deleted_at', null);
    if (logErr) throw new Error(`flight log read: ${logErr.message}`);
    expect(logs?.length).toBe(1);
    expect(Number(logs![0].tach)).toBe(1001);
    expect(logs![0].landings).toBe(1);

    const { data: ac } = await admin
      .from('aft_aircraft')
      .select('total_engine_time, total_airframe_time')
      .eq('id', seededUser.aircraftId)
      .single();
    expect(Number(ac?.total_engine_time)).toBe(1001);

    // ── UI-side: the saved row should be visible (latest log card shows tach 1001.0).
    await expect(page.getByText(/1001\.0/i).first()).toBeVisible({ timeout: 5_000 });
  });
});

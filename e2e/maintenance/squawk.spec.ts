import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';

/**
 * MX → Squawks: report a squawk via the UI, then resolve it. Pairs
 * with api/squawks.spec.ts (which covers cross-aircraft guards) by
 * exercising the form contract + listing + resolve UX path.
 *
 * Notify MX is left UNchecked so we don't depend on Resend in the
 * test harness — the resolve path is the value here, not the email.
 */
test.describe('Maintenance → Squawks — report and resolve', () => {
  test('admin reports a squawk, sees it open in the list, resolves it', async ({ page, seededUser }) => {
    test.setTimeout(120_000);

    const apiErrors: string[] = [];
    page.on('response', async (res) => {
      if (res.url().includes('/api/squawks') && !res.ok()) {
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
    await secondaryNav.getByRole('button', { name: 'Squawks', exact: true }).click();

    // ── Open the report-squawk modal
    await page.getByRole('button', { name: /report new squawk/i }).click();
    await expect(page.getByRole('heading', { name: 'Report Squawk' })).toBeVisible();

    // Form labels aren't associated; pick by placeholder + structure.
    await page.getByPlaceholder('e.g. KDFW').fill('KDFW');
    // Description is the only required textarea in the modal.
    await page.locator('form textarea[required]').first().fill('Mag drop above limit on right mag — 200 RPM at 1700');

    // Untoggle Notify MX so the test isn't gated on Resend.
    await page.getByLabel(/notify mx/i).uncheck().catch(() => {
      // If unchecking fails (e.g. element not interactable yet), ignore —
      // the seeded user has no mx contact email so the notify call no-ops.
    });

    await page.getByRole('button', { name: 'Save Squawk' }).click();

    if (apiErrors.length) {
      throw new Error(`/api/squawks errored on save:\n${apiErrors.join('\n')}`);
    }

    // Toast confirms save.
    await expect(page.getByText(/squawk reported/i).first()).toBeVisible({ timeout: 30_000 });

    // DB-side: row exists, status='open'.
    const admin = adminClient();
    const { data: openRows, error: e1 } = await admin
      .from('aft_squawks')
      .select('id, status, location, description, deleted_at')
      .eq('aircraft_id', seededUser.aircraftId)
      .is('deleted_at', null);
    if (e1) throw new Error(`squawk read: ${e1.message}`);
    expect(openRows?.length).toBe(1);
    expect(openRows![0].status).toBe('open');
    expect(openRows![0].location).toBe('KDFW');

    // ── Resolve it
    // Click the squawk card to open the detail modal. The card shows the
    // location + description; click on the description text to scope to
    // the list card (avoid the heading "Squawks" or other banners).
    await page.getByText('Mag drop above limit on right mag — 200 RPM at 1700', { exact: false }).first().click();

    // The "Resolve" button is in the detail modal.
    await page.getByRole('button', { name: /^Resolve$/ }).click();
    await page.getByRole('button', { name: /confirm resolve/i }).click();

    if (apiErrors.length) {
      throw new Error(`/api/squawks errored on resolve:\n${apiErrors.join('\n')}`);
    }

    await expect(page.getByText(/squawk resolved/i).first()).toBeVisible({ timeout: 30_000 });

    // DB-side: status now 'resolved'. (Squawks don't have a resolved_at —
    // status='resolved' is the marker.)
    const { data: resolved, error: e2 } = await admin
      .from('aft_squawks')
      .select('id, status, resolved_note')
      .eq('id', openRows![0].id)
      .single();
    if (e2) throw new Error(`squawk re-read: ${e2.message}`);
    expect(resolved?.status).toBe('resolved');
  });
});

import { test, expect } from '../fixtures/seeded-user';

/**
 * Tab-navigation smoke. For each primary tab, click the nav,
 * confirm the tab content rendered, and confirm no console errors
 * fired during the render. Cheap broad coverage of the most common
 * regression class — a route or component throwing on first mount.
 *
 * We don't exercise tab-internal interactions here (each tab has
 * its own dedicated spec for that). The win is: if anyone breaks
 * MX, Howard, Calendar, Notes, etc. with a typo or missing import,
 * this catches it on commit.
 */

const PRIMARY_TABS = [
  // Each entry: [name on bottom-nav, secondary tray item label or null, expected stable text on tab]
  { nav: 'Log', sub: 'Flights', stable: 'Log New Flight' },
  { nav: 'Log', sub: 'Ops Checks', stable: /ops checks/i },
  { nav: 'Calendar', sub: null, stable: /calendar|schedule/i },
  { nav: 'MX', sub: 'Due Items', stable: /maintenance/i },
  { nav: 'MX', sub: 'Squawks', stable: /squawks/i },
  { nav: 'MX', sub: 'Service', stable: /service/i },
  { nav: 'MX', sub: 'ADs', stable: /airworthiness|directives|ad\b/i },
  { nav: 'More', sub: 'Notes', stable: /note|notes/i },
  { nav: 'More', sub: 'Documents', stable: /document/i },
  { nav: 'More', sub: 'Equipment', stable: /equipment/i },
  { nav: 'More', sub: 'Howard', stable: /howard|ask/i },
] as const;

test.describe('navigation smoke — every tab renders without errors', () => {
  test('user signs in and visits every primary tab', async ({ page, seededUser }) => {
    test.setTimeout(180_000);

    const blockingErrors: string[] = [];
    page.on('pageerror', (err) => blockingErrors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // Filter known dev-only noise that doesn't reflect a real bug:
      //   - "Failed to load resource" comes from the avatar 404 fallback (intentional)
      //   - HMR disconnects during the test (fast refresh is unrelated to app health)
      //   - A devtools warning about Sentry sampling / client-init in dev
      if (/Failed to load resource/i.test(text)) return;
      if (/Fast Refresh|HMR|websocket/i.test(text)) return;
      if (/sentry/i.test(text)) return;
      blockingErrors.push(`console.error: ${text}`);
    });

    // ── Sign in
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(seededUser.email);
    await page.locator('input[type="password"]').fill(seededUser.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
    const secondaryNav = page.getByRole('navigation', { name: 'Secondary navigation' });

    await expect(mainNav.getByRole('button', { name: 'Log', exact: true })).toBeVisible({ timeout: 20_000 });

    for (const { nav, sub, stable } of PRIMARY_TABS) {
      await test.step(`tab: ${nav}${sub ? ` → ${sub}` : ''}`, async () => {
        await mainNav.getByRole('button', { name: nav, exact: true }).click();
        if (sub) {
          await secondaryNav.getByRole('button', { name: sub, exact: true }).click();
        }
        await expect(page.getByText(stable).first()).toBeVisible({ timeout: 15_000 });
      });
    }

    if (blockingErrors.length) {
      throw new Error('Blocking console / page errors during navigation:\n' + blockingErrors.join('\n'));
    }
  });
});

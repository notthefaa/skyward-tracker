import { defineConfig, devices } from '@playwright/test';

/**
 * E2E test config. Codespace runs Playwright inside the official
 * Docker image (`mcr.microsoft.com/playwright:v1.59.1-noble`) because
 * the host is missing the browser system libs and apt is firewalled.
 * See package.json e2e script.
 *
 * Two projects:
 *   - desktop-chromium: standard regression coverage.
 *   - mobile-ios: iPhone 14 emulation in Chromium. Not WebKit-exact,
 *     but covers viewport, touch, user-agent, and the visibility/
 *     network behaviors that drive most recent bugs. Real-iPhone
 *     verification still happens after the suite is green.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Single worker locally so the shared dev server doesn't get hammered;
  // CI can override with --workers.
  workers: process.env.CI ? 2 : 1,
  // Failures should be loud, not retried-into-silence on a real bug —
  // but the Docker dev-server cold-compile path causes transient
  // connection-refused / 504 flakes when the full suite is run, so we
  // allow ONE retry locally to absorb infra noise. Real test bugs still
  // surface as 2x-failed (visible in the report).
  retries: process.env.CI ? 1 : 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-ios',
      // Pixel-fidelity iOS Safari needs WebKit, which isn't available
      // in this codespace. iPhone 14 viewport + touch + UA spoof in
      // Chromium catches the layout/UX bugs we actually ship.
      use: { ...devices['iPhone 14'] },
    },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        // `npm run dev` auto-uses port 3000 by default; we override
        // to 3100 so a pre-existing dev session keeps running.
        command: `npx next dev -p ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        // Cold compile of a Next 16 app is slow; give it room.
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});

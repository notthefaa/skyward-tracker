import { test, expect } from '@playwright/test';

/**
 * Cron auth boundary. Both `/api/cron/mx-reminders` and
 * `/api/cron/ads-sync` are GET endpoints fronted by a Bearer
 * CRON_SECRET check. They MUST 401 without the bearer (Vercel cron
 * passes it automatically; nothing else should be hitting them).
 *
 * We don't run the cron's body here — that's a deep DB-seeding
 * exercise. The auth check is the cheap layer worth a permanent guard.
 *
 * `dev/email-preview` style probe: fetch directly with a raw HTTP
 * request via `request.fetch` so we can set arbitrary Authorization.
 */

const CRON_SECRET = process.env.CRON_SECRET;

test.describe('cron auth — Bearer CRON_SECRET required', () => {
  test('mx-reminders without auth → 401', async ({ baseURL, request }) => {
    const res = await request.get(`${baseURL}/api/cron/mx-reminders`);
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauth/i);
  });

  test('mx-reminders with wrong bearer → 401', async ({ baseURL, request }) => {
    const res = await request.get(`${baseURL}/api/cron/mx-reminders`, {
      headers: { Authorization: 'Bearer not-the-real-secret' },
    });
    expect(res.status()).toBe(401);
  });

  test('ads-sync without auth → 401', async ({ baseURL, request }) => {
    const res = await request.get(`${baseURL}/api/cron/ads-sync`);
    expect(res.status()).toBe(401);
  });

  test('ads-sync with wrong bearer → 401', async ({ baseURL, request }) => {
    const res = await request.get(`${baseURL}/api/cron/ads-sync`, {
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(res.status()).toBe(401);
  });

  test('mx-reminders with correct bearer returns 200 + success shape', async ({ baseURL, request }) => {
    test.skip(!CRON_SECRET, 'CRON_SECRET not in env');
    test.setTimeout(120_000);
    const res = await request.get(`${baseURL}/api/cron/mx-reminders`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('ads-sync with correct bearer returns 200 + totals shape', async ({ baseURL, request }) => {
    test.skip(!CRON_SECRET, 'CRON_SECRET not in env');
    test.setTimeout(120_000);
    const res = await request.get(`${baseURL}/api/cron/ads-sync`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // No-aircraft case returns `note: 'No aircraft to sync'`; aircraft-
    // present case returns `totals: { inserted, updated, skipped, errors }`.
    // Either is fine — just don't 500.
    expect(body.note ?? body.totals).toBeDefined();
  });
});

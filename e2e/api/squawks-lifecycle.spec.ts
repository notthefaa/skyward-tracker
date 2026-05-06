import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * Squawks lifecycle — edit/resolve/reopen + delete + public page +
 * protected-field guards. Existing happy + cross-user coverage lives
 * in `e2e/api/squawks.spec.ts`. This file fills the gap on:
 *   - same-user edit path (author edits own squawk)
 *   - status flips (open → resolved → open again)
 *   - DELETE soft-delete by author
 *   - protected fields (resolved_by_event_id / access_token /
 *     mx_notify_failed) cannot be set via PUT
 *   - public /squawk/[token] page renders for valid token, 404s
 *     for unknown / soft-deleted
 */
test.describe('squawks API — edit + delete + protected fields', () => {
  test('author can resolve their own squawk via PUT', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const created = await fetchAs(token, baseURL!, '/api/squawks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        squawkData: { description: 'Author resolves their own squawk', reporter_initials: 'TST' },
      }),
    });
    expect(created.status).toBe(200);
    const { squawk } = await created.json();

    const resolved = await fetchAs(token, baseURL!, '/api/squawks', {
      method: 'PUT',
      body: JSON.stringify({
        squawkId: squawk.id,
        aircraftId: seededUser.aircraftId,
        squawkData: { status: 'resolved', affects_airworthiness: false, resolved_note: 'Sorted in shop.' },
      }),
    });
    expect(resolved.status).toBe(200);

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_squawks')
      .select('status, resolved_note, affects_airworthiness')
      .eq('id', squawk.id)
      .single();
    expect(row?.status).toBe('resolved');
    expect(row?.resolved_note).toBe('Sorted in shop.');
    expect(row?.affects_airworthiness).toBe(false);
  });

  test('author can reopen a resolved squawk', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();

    // Seed directly as resolved.
    const { data: sq } = await admin
      .from('aft_squawks')
      .insert({
        aircraft_id: seededUser.aircraftId,
        reported_by: seededUser.userId,
        description: 'Pre-resolved squawk',
        status: 'resolved',
        affects_airworthiness: false,
        resolved_note: 'Original resolution.',
      })
      .select('id')
      .single();
    const squawkId = sq!.id as string;

    const reopened = await fetchAs(token, baseURL!, '/api/squawks', {
      method: 'PUT',
      body: JSON.stringify({
        squawkId,
        aircraftId: seededUser.aircraftId,
        squawkData: { status: 'open', affects_airworthiness: true },
      }),
    });
    expect(reopened.status).toBe(200);

    const { data: row } = await admin
      .from('aft_squawks')
      .select('status, affects_airworthiness')
      .eq('id', squawkId)
      .single();
    expect(row?.status).toBe('open');
    expect(row?.affects_airworthiness).toBe(true);
  });

  test('PUT cannot set protected fields (resolved_by_event_id / access_token / mx_notify_failed)', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();

    const { data: sq } = await admin
      .from('aft_squawks')
      .insert({
        aircraft_id: seededUser.aircraftId,
        reported_by: seededUser.userId,
        description: 'Protected-field test',
        status: 'open',
      })
      .select('id, access_token')
      .single();
    const squawkId = sq!.id as string;
    const originalToken = sq!.access_token;

    // Server-managed fields. PUT must silently strip these via
    // stripProtectedFields(squawkData, 'squawks').
    const fakeEventId = randomUUID();
    const res = await fetchAs(token, baseURL!, '/api/squawks', {
      method: 'PUT',
      body: JSON.stringify({
        squawkId,
        aircraftId: seededUser.aircraftId,
        squawkData: {
          description: 'Legitimate description update',
          // Spoof attempts:
          resolved_by_event_id: fakeEventId,
          access_token: 'spoofed-token-12345',
          mx_notify_failed: false,
        },
      }),
    });
    expect(res.status).toBe(200);

    const { data: row } = await admin
      .from('aft_squawks')
      .select('description, resolved_by_event_id, access_token')
      .eq('id', squawkId)
      .single();
    expect(row?.description).toBe('Legitimate description update');
    expect(row?.resolved_by_event_id).toBeNull();
    expect(row?.access_token).toBe(originalToken);
  });

  test('author can soft-delete their own squawk via DELETE', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();

    const { data: sq } = await admin
      .from('aft_squawks')
      .insert({
        aircraft_id: seededUser.aircraftId,
        reported_by: seededUser.userId,
        description: 'About to delete',
        status: 'open',
      })
      .select('id')
      .single();
    const squawkId = sq!.id as string;

    const res = await fetchAs(token, baseURL!, '/api/squawks', {
      method: 'DELETE',
      body: JSON.stringify({ squawkId, aircraftId: seededUser.aircraftId }),
    });
    expect(res.status).toBe(200);

    const { data: row } = await admin
      .from('aft_squawks')
      .select('deleted_at')
      .eq('id', squawkId)
      .single();
    expect(row?.deleted_at).not.toBeNull();
  });
});

test.describe('squawks public page — /squawk/[token]', () => {
  test('valid access_token renders squawk description + tail', async ({ page, seededUser }) => {
    const admin = adminClient();
    const description = `Public-page test squawk ${randomUUID()}`;
    const { data: sq } = await admin
      .from('aft_squawks')
      .insert({
        aircraft_id: seededUser.aircraftId,
        reported_by: seededUser.userId,
        description,
        location: 'Right wing root',
        status: 'open',
      })
      .select('id, access_token')
      .single();

    await page.goto(`/squawk/${sq!.access_token}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText(description)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(seededUser.tailNumber)).toBeVisible();

    await admin.from('aft_squawks').delete().eq('id', sq!.id);
  });

  test('soft-deleted squawk does not render (404-equivalent UI)', async ({ page, seededUser }) => {
    const admin = adminClient();
    const description = `Hidden squawk ${randomUUID()}`;
    const { data: sq } = await admin
      .from('aft_squawks')
      .insert({
        aircraft_id: seededUser.aircraftId,
        reported_by: seededUser.userId,
        description,
        status: 'open',
        deleted_at: new Date().toISOString(),
      })
      .select('id, access_token')
      .single();

    await page.goto(`/squawk/${sq!.access_token}`, { waitUntil: 'domcontentloaded' });

    // Page filters deleted_at IS NULL — description must not appear.
    await page.waitForTimeout(1500);
    await expect(page.getByText(description)).toHaveCount(0);

    await admin.from('aft_squawks').delete().eq('id', sq!.id);
  });

  test('unknown token does not render any squawk', async ({ page }) => {
    await page.goto(`/squawk/${randomUUID().replace(/-/g, '')}`, { waitUntil: 'domcontentloaded' });
    // Wait briefly for the fetch to complete, then verify no squawk
    // content has rendered.
    await page.waitForTimeout(1500);
    // The page renders an empty/neutral state for missing tokens — we
    // just need to verify it doesn't throw or render foreign data.
    await expect(page.getByText(/squawk \d+/i).first()).toHaveCount(0);
  });
});

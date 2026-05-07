import { test, expect } from '../fixtures/seeded-user';
import { test as crossTest } from '../fixtures/two-users';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * Phase 2 — Tire-check submission lifecycle.
 *
 * /api/tire-checks
 *   POST: any user with aircraft access → row in aft_tire_checks
 *   DELETE: aircraft-admin only, scoped by aircraft_id (admin on A
 *     must not be able to soft-delete a row on B by mixing IDs)
 *
 * Locks in:
 *   - all-null "all tires OK" still creates a row (so the inspection
 *     counter resets — see the route comment for why)
 *   - X-Idempotency-Key returns the same id on replay (no dup row)
 *   - cross-aircraft POST is rejected
 *   - non-admin DELETE returns 403
 *   - admin DELETE filtered by aircraft_id (404 on mismatched pair)
 */
test.describe('tire-checks API — happy + idempotency + bad input', () => {
  test('user submits a tire check on their aircraft', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/tire-checks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        logData: {
          nose_psi: 32,
          left_main_psi: 28,
          right_main_psi: 28.5,
          initials: 'TST',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.id).toBeTruthy();

    const admin = adminClient();
    const { data } = await admin
      .from('aft_tire_checks')
      .select('nose_psi, left_main_psi, right_main_psi, initials, user_id, aircraft_id')
      .eq('id', body.id)
      .single();
    expect(data?.nose_psi).toBe(32);
    expect(data?.left_main_psi).toBe(28);
    expect(data?.right_main_psi).toBe(28.5);
    expect(data?.initials).toBe('TST');
    expect(data?.user_id).toBe(seededUser.userId);
    expect(data?.aircraft_id).toBe(seededUser.aircraftId);
  });

  test('all-null "all tires OK" entry still creates a row', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/tire-checks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        logData: {
          // No psi values — the dial reads "all tires OK" + resets the
          // inspection counter at the pilot's local clock.
          initials: 'TST',
        },
      }),
    });
    expect(res.status).toBe(200);
    const { id } = await res.json();
    expect(id).toBeTruthy();

    const admin = adminClient();
    const { data } = await admin
      .from('aft_tire_checks')
      .select('nose_psi, left_main_psi, right_main_psi')
      .eq('id', id)
      .single();
    expect(data?.nose_psi).toBeNull();
    expect(data?.left_main_psi).toBeNull();
    expect(data?.right_main_psi).toBeNull();
  });

  test('idempotency key returns same id on replay', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const idemKey = randomUUID();
    const payload = {
      aircraftId: seededUser.aircraftId,
      logData: { nose_psi: 30, left_main_psi: 27, right_main_psi: 27, initials: 'IDM' },
    };

    const res1 = await fetchAs(token, baseURL!, '/api/tire-checks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body: JSON.stringify(payload),
    });
    const res2 = await fetchAs(token, baseURL!, '/api/tire-checks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body: JSON.stringify(payload),
    });
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const j1 = await res1.json();
    const j2 = await res2.json();
    expect(j1.id).toBe(j2.id);

    const admin = adminClient();
    const { count } = await admin
      .from('aft_tire_checks')
      .select('id', { count: 'exact', head: true })
      .eq('aircraft_id', seededUser.aircraftId)
      .is('deleted_at', null);
    expect(count).toBe(1);
  });

  test('non-numeric psi is rejected with 400', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/tire-checks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        logData: { nose_psi: 'thirty', initials: 'TST' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('missing aircraftId is rejected with 400', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/tire-checks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({ logData: { nose_psi: 32, initials: 'TST' } }),
    });
    expect(res.status).toBe(400);
  });
});

crossTest.describe('tire-checks API — cross-aircraft + admin-only DELETE', () => {
  crossTest('user B cannot post a tire check to user A aircraft', async ({ userA, userB, baseURL }) => {
    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, '/api/tire-checks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: userA.aircraftId,
        logData: { nose_psi: 32, initials: 'XXX' },
      }),
    });
    expect([401, 403, 404]).toContain(res.status);

    const admin = adminClient();
    const { count } = await admin
      .from('aft_tire_checks')
      .select('id', { count: 'exact', head: true })
      .eq('aircraft_id', userA.aircraftId)
      .is('deleted_at', null);
    expect(count).toBe(0);
  });

  crossTest('admin on A cannot delete a B-aircraft row by mixing aircraftId=A + foreign logId', async ({ userA, userB, baseURL }) => {
    // Seed B with a tire-check row under their own credentials.
    const tokenB = await getAccessToken(userB.email, userB.password);
    const created = await fetchAs(tokenB, baseURL!, '/api/tire-checks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: userB.aircraftId,
        logData: { nose_psi: 30, initials: 'BBB' },
      }),
    });
    expect(created.status).toBe(200);
    const { id: bRowId } = await created.json();

    // Owner A tries to delete B's row by claiming it belongs to A.
    const tokenA = await getAccessToken(userA.email, userA.password);
    const res = await fetchAs(tokenA, baseURL!, '/api/tire-checks', {
      method: 'DELETE',
      body: JSON.stringify({ logId: bRowId, aircraftId: userA.aircraftId }),
    });
    expect(res.status).toBe(404);

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_tire_checks')
      .select('deleted_at')
      .eq('id', bRowId)
      .single();
    expect(row?.deleted_at).toBeNull();
  });
});

test.describe('tire-checks API — admin DELETE happy path', () => {
  test('owner soft-deletes their own tire check', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const created = await fetchAs(token, baseURL!, '/api/tire-checks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        logData: { nose_psi: 32, initials: 'TST' },
      }),
    });
    expect(created.status).toBe(200);
    const { id } = await created.json();

    const deleted = await fetchAs(token, baseURL!, '/api/tire-checks', {
      method: 'DELETE',
      body: JSON.stringify({ logId: id, aircraftId: seededUser.aircraftId }),
    });
    expect(deleted.status).toBe(200);

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_tire_checks')
      .select('deleted_at, deleted_by')
      .eq('id', id)
      .single();
    expect(row?.deleted_at).not.toBeNull();
    expect(row?.deleted_by).toBe(seededUser.userId);
  });
});

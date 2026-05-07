import { test, expect } from '../fixtures/seeded-user';
import { test as crossTest } from '../fixtures/two-users';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * Phase 2 — VOR-check submission lifecycle.
 *
 * /api/vor-checks
 *   POST: any user with aircraft access → row in aft_vor_checks +
 *     server-computed `passed` flag (|bearing_error| <= tolerance for
 *     the check_type)
 *   DELETE: aircraft-admin only, scoped by aircraft_id
 *
 * Locks in:
 *   - tolerance lookup table (FAR 91.171: VOT/Ground/Dual = ±4°,
 *     Airborne = ±6°). pass/fail computed server-side, never trusted
 *     from the client.
 *   - X-Idempotency-Key returns the same id on replay
 *   - cross-aircraft POST is rejected
 *   - admin DELETE filtered by aircraft_id (404 on mismatched pair)
 *   - rejects unknown check_type
 */

interface VorPostBody {
  check_type: 'VOT' | 'Ground Checkpoint' | 'Airborne Checkpoint' | 'Dual VOR';
  station: string;
  bearing_error: number;
  initials: string;
}

function postVor(token: string, baseURL: string, aircraftId: string, logData: VorPostBody, idemKey?: string) {
  return fetchAs(token, baseURL, '/api/vor-checks', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': idemKey ?? randomUUID() },
    body: JSON.stringify({ aircraftId, logData }),
  });
}

test.describe('vor-checks API — happy + tolerance + bad input', () => {
  test('VOT within tolerance → passed=true', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await postVor(token, baseURL!, seededUser.aircraftId, {
      check_type: 'VOT',
      station: 'KPDX',
      bearing_error: 3,
      initials: 'TST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.passed).toBe(true);
    expect(body.id).toBeTruthy();

    const admin = adminClient();
    const { data } = await admin
      .from('aft_vor_checks')
      .select('check_type, station, bearing_error, tolerance, passed, initials, user_id, aircraft_id')
      .eq('id', body.id)
      .single();
    expect(data?.check_type).toBe('VOT');
    expect(data?.tolerance).toBe(4);
    expect(data?.bearing_error).toBe(3);
    expect(data?.passed).toBe(true);
    expect(data?.user_id).toBe(seededUser.userId);
    expect(data?.aircraft_id).toBe(seededUser.aircraftId);
  });

  test('VOT outside tolerance → passed=false', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await postVor(token, baseURL!, seededUser.aircraftId, {
      check_type: 'VOT',
      station: 'KPDX',
      bearing_error: 5,
      initials: 'TST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.passed).toBe(false);

    const admin = adminClient();
    const { data } = await admin.from('aft_vor_checks').select('passed, tolerance').eq('id', body.id).single();
    expect(data?.passed).toBe(false);
    expect(data?.tolerance).toBe(4);
  });

  test('Airborne Checkpoint uses ±6° tolerance', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    // 5° error: out-of-spec for VOT (±4) but in-spec for Airborne (±6).
    const res = await postVor(token, baseURL!, seededUser.aircraftId, {
      check_type: 'Airborne Checkpoint',
      station: 'BTG',
      bearing_error: 5,
      initials: 'TST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.passed).toBe(true);

    const admin = adminClient();
    const { data } = await admin.from('aft_vor_checks').select('tolerance, passed').eq('id', body.id).single();
    expect(data?.tolerance).toBe(6);
    expect(data?.passed).toBe(true);
  });

  test('negative bearing_error is treated by absolute value', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await postVor(token, baseURL!, seededUser.aircraftId, {
      check_type: 'Dual VOR',
      station: 'BTG',
      bearing_error: -3,
      initials: 'TST',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).passed).toBe(true);

    const fail = await postVor(token, baseURL!, seededUser.aircraftId, {
      check_type: 'Dual VOR',
      station: 'BTG',
      bearing_error: -5,
      initials: 'TST',
    });
    expect(fail.status).toBe(200);
    expect((await fail.json()).passed).toBe(false);
  });

  test('idempotency key returns same id on replay', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const idemKey = randomUUID();
    const logData: VorPostBody = {
      check_type: 'VOT',
      station: 'KPDX',
      bearing_error: 2,
      initials: 'IDM',
    };

    const res1 = await postVor(token, baseURL!, seededUser.aircraftId, logData, idemKey);
    const res2 = await postVor(token, baseURL!, seededUser.aircraftId, logData, idemKey);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect((await res1.json()).id).toBe((await res2.json()).id);

    const admin = adminClient();
    const { count } = await admin
      .from('aft_vor_checks')
      .select('id', { count: 'exact', head: true })
      .eq('aircraft_id', seededUser.aircraftId)
      .is('deleted_at', null);
    expect(count).toBe(1);
  });

  test('unknown check_type is rejected with 400', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/vor-checks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        logData: { check_type: 'GPS Fix', station: 'KPDX', bearing_error: 1, initials: 'TST' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('non-numeric bearing_error is rejected with 400', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/vor-checks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        logData: { check_type: 'VOT', station: 'KPDX', bearing_error: 'two', initials: 'TST' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('missing aircraftId is rejected with 400', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/vor-checks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        logData: { check_type: 'VOT', station: 'KPDX', bearing_error: 1, initials: 'TST' },
      }),
    });
    expect(res.status).toBe(400);
  });
});

crossTest.describe('vor-checks API — cross-aircraft + admin-only DELETE', () => {
  crossTest('user B cannot post a VOR check to user A aircraft', async ({ userA, userB, baseURL }) => {
    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await postVor(tokenB, baseURL!, userA.aircraftId, {
      check_type: 'VOT',
      station: 'KPDX',
      bearing_error: 1,
      initials: 'XXX',
    });
    expect([401, 403, 404]).toContain(res.status);

    const admin = adminClient();
    const { count } = await admin
      .from('aft_vor_checks')
      .select('id', { count: 'exact', head: true })
      .eq('aircraft_id', userA.aircraftId)
      .is('deleted_at', null);
    expect(count).toBe(0);
  });

  crossTest('admin on A cannot delete a B-aircraft row by mixing IDs', async ({ userA, userB, baseURL }) => {
    const tokenB = await getAccessToken(userB.email, userB.password);
    const created = await postVor(tokenB, baseURL!, userB.aircraftId, {
      check_type: 'VOT',
      station: 'KPDX',
      bearing_error: 2,
      initials: 'BBB',
    });
    expect(created.status).toBe(200);
    const { id: bRowId } = await created.json();

    const tokenA = await getAccessToken(userA.email, userA.password);
    const res = await fetchAs(tokenA, baseURL!, '/api/vor-checks', {
      method: 'DELETE',
      body: JSON.stringify({ logId: bRowId, aircraftId: userA.aircraftId }),
    });
    expect(res.status).toBe(404);

    const admin = adminClient();
    const { data: row } = await admin.from('aft_vor_checks').select('deleted_at').eq('id', bRowId).single();
    expect(row?.deleted_at).toBeNull();
  });
});

test.describe('vor-checks API — admin DELETE happy path', () => {
  test('owner soft-deletes their own VOR check', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const created = await postVor(token, baseURL!, seededUser.aircraftId, {
      check_type: 'VOT',
      station: 'KPDX',
      bearing_error: 2,
      initials: 'TST',
    });
    expect(created.status).toBe(200);
    const { id } = await created.json();

    const deleted = await fetchAs(token, baseURL!, '/api/vor-checks', {
      method: 'DELETE',
      body: JSON.stringify({ logId: id, aircraftId: seededUser.aircraftId }),
    });
    expect(deleted.status).toBe(200);

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_vor_checks')
      .select('deleted_at, deleted_by')
      .eq('id', id)
      .single();
    expect(row?.deleted_at).not.toBeNull();
    expect(row?.deleted_by).toBe(seededUser.userId);
  });
});

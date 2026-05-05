import { test, expect } from '../fixtures/two-users';
import { test as singleTest } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

singleTest.describe('squawks API — happy path', () => {
  singleTest('user reports a squawk on their aircraft', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/squawks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        squawkData: {
          description: 'Left brake pedal feels spongy',
          location: 'Left main gear',
          reporter_initials: 'TST',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.squawk?.id).toBeTruthy();

    const admin = adminClient();
    const { data } = await admin.from('aft_squawks').select('id, status, reported_by, description, access_token').eq('id', body.squawk.id).single();
    expect(data?.reported_by).toBe(seededUser.userId);
    expect(data?.status).toBe('open');
    expect(data?.access_token).toBeTruthy();
    expect(data?.description).toBe('Left brake pedal feels spongy');
  });

  singleTest('idempotency key returns same result on replay', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const idemKey = randomUUID();
    const body = {
      aircraftId: seededUser.aircraftId,
      squawkData: { description: 'Idem-test squawk', reporter_initials: 'IDM' },
    };

    const res1 = await fetchAs(token, baseURL!, '/api/squawks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body: JSON.stringify(body),
    });
    const res2 = await fetchAs(token, baseURL!, '/api/squawks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body: JSON.stringify(body),
    });
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const j1 = await res1.json();
    const j2 = await res2.json();
    expect(j1.squawk.id).toBe(j2.squawk.id);

    // DB should have only one row.
    const admin = adminClient();
    const { data } = await admin
      .from('aft_squawks')
      .select('id')
      .eq('aircraft_id', seededUser.aircraftId)
      .is('deleted_at', null);
    expect(data?.length).toBe(1);
  });

  singleTest('rejects pictures pointing at a foreign URL', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/squawks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        squawkData: {
          description: 'XSS attempt',
          pictures: ['https://attacker.example.com/track.png'],
        },
      }),
    });
    expect(res.status).toBe(400);
  });
});

test.describe('squawks API — cross-user / scope guards', () => {
  test('user B cannot post a squawk to user A aircraft', async ({ userA, userB, baseURL }) => {
    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, '/api/squawks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: userA.aircraftId,
        squawkData: { description: 'Hostile squawk', reporter_initials: 'BAD' },
      }),
    });
    expect([401, 403, 404]).toContain(res.status);

    // Nothing should be on A's aircraft.
    const admin = adminClient();
    const { data } = await admin
      .from('aft_squawks')
      .select('id')
      .eq('aircraft_id', userA.aircraftId)
      .is('deleted_at', null);
    expect(data?.length ?? 0).toBe(0);
  });

  test('PUT cross-aircraft spoof is rejected', async ({ userA, userB, baseURL }) => {
    // Seed a squawk on B's aircraft via service role.
    const admin = adminClient();
    const { data: sq } = await admin
      .from('aft_squawks')
      .insert({
        aircraft_id: userB.aircraftId,
        description: 'B-only squawk',
        reported_by: userB.userId,
        access_token: randomUUID().replace(/-/g, ''),
      })
      .select('id')
      .single();
    const squawkId = sq!.id;

    // A tries to edit it via spoofed aircraftId.
    const tokenA = await getAccessToken(userA.email, userA.password);
    const res = await fetchAs(tokenA, baseURL!, '/api/squawks', {
      method: 'PUT',
      body: JSON.stringify({
        squawkId,
        aircraftId: userA.aircraftId,
        squawkData: { description: 'Hijacked' },
      }),
    });
    expect([403, 404]).toContain(res.status);

    const { data: row } = await admin.from('aft_squawks').select('description').eq('id', squawkId).single();
    expect(row?.description).toBe('B-only squawk');
  });

  test('user B cannot delete A-aircraft squawk by claiming author', async ({ userA, userB, baseURL }) => {
    // Seed a squawk on A's aircraft, reported by A.
    const admin = adminClient();
    const { data: sq } = await admin
      .from('aft_squawks')
      .insert({
        aircraft_id: userA.aircraftId,
        description: 'A-only squawk',
        reported_by: userA.userId,
        access_token: randomUUID().replace(/-/g, ''),
      })
      .select('id')
      .single();
    const squawkId = sq!.id;

    const tokenB = await getAccessToken(userB.email, userB.password);
    // B tries with their own aircraftId — fails the aircraft_id match.
    const res1 = await fetchAs(tokenB, baseURL!, '/api/squawks', {
      method: 'DELETE',
      body: JSON.stringify({ squawkId, aircraftId: userB.aircraftId }),
    });
    expect([403, 404]).toContain(res1.status);

    // B tries with A's aircraftId — fails the access check.
    const res2 = await fetchAs(tokenB, baseURL!, '/api/squawks', {
      method: 'DELETE',
      body: JSON.stringify({ squawkId, aircraftId: userA.aircraftId }),
    });
    expect([401, 403, 404]).toContain(res2.status);

    const { data: row } = await admin.from('aft_squawks').select('deleted_at').eq('id', squawkId).single();
    expect(row?.deleted_at).toBeNull();
  });
});

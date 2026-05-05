import { test, expect } from '../fixtures/two-users';
import { test as singleTest } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

function isoIn(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

singleTest.describe('reservations API — happy path', () => {
  singleTest('pilot books a single occurrence on their aircraft', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        title: 'Cross-country to KCMA',
        route: 'KCMA-KSBA-KCMA',
        timeZone: 'America/Los_Angeles',
        occurrences: [{ start: isoIn(48), end: isoIn(52) }],
      }),
    });
    expect(res.status).toBe(200);

    const admin = adminClient();
    const { data } = await admin
      .from('aft_reservations')
      .select('id, status, user_id, title')
      .eq('aircraft_id', seededUser.aircraftId)
      .eq('status', 'confirmed');
    expect(data?.length).toBe(1);
    expect(data![0].user_id).toBe(seededUser.userId);
    expect(data![0].title).toBe('Cross-country to KCMA');
  });

  singleTest('overlapping reservation on same aircraft is rejected', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res1 = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        title: 'First booking',
        timeZone: 'UTC',
        occurrences: [{ start: isoIn(72), end: isoIn(76) }],
      }),
    });
    expect(res1.status).toBe(200);

    // Half-overlap with the first.
    const res2 = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        title: 'Conflicting booking',
        timeZone: 'UTC',
        occurrences: [{ start: isoIn(74), end: isoIn(78) }],
      }),
    });
    // Either the API rejects with a 4xx, OR returns 200 with a skipped/error
    // message in the body — verify we don't end up with two confirmed
    // reservations covering the same window.
    const admin = adminClient();
    const { data } = await admin
      .from('aft_reservations')
      .select('id, start_time, end_time')
      .eq('aircraft_id', seededUser.aircraftId)
      .eq('status', 'confirmed');
    expect(data?.length).toBe(1);
    if (res2.status >= 400) {
      // explicit rejection — fine
    } else {
      // 200 with a skip message: body should indicate at least one error/skip.
      const body = await res2.json().catch(() => ({}));
      // Be resilient to shape: any of these signal the conflict path was hit.
      const text = JSON.stringify(body).toLowerCase();
      expect(
        text.includes('conflict') ||
        text.includes('already') ||
        text.includes('overlap') ||
        text.includes('skip') ||
        text.includes('error') ||
        body.success === false,
      ).toBeTruthy();
    }
  });

  singleTest('end <= start rejected with 400', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const start = isoIn(48);
    const res = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        title: 'Backwards',
        timeZone: 'UTC',
        occurrences: [{ start, end: start }],
      }),
    });
    expect(res.status).toBe(400);
  });

  singleTest('owner can cancel their own reservation (soft delete)', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const create = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        title: 'Will cancel',
        timeZone: 'UTC',
        occurrences: [{ start: isoIn(96), end: isoIn(100) }],
      }),
    });
    expect(create.status).toBe(200);

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_reservations')
      .select('id')
      .eq('aircraft_id', seededUser.aircraftId)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    const reservationId = row!.id;

    const cancelRes = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'DELETE',
      body: JSON.stringify({ reservationId, timeZone: 'UTC' }),
    });
    expect(cancelRes.status).toBe(200);

    const { data: cancelled } = await admin
      .from('aft_reservations')
      .select('status')
      .eq('id', reservationId)
      .single();
    expect(cancelled?.status).toBe('cancelled');
  });
});

test.describe('reservations API — cross-user / scope guards', () => {
  test('user B cannot book on user A aircraft', async ({ userA, userB, baseURL }) => {
    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, '/api/reservations', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: userA.aircraftId,
        title: 'Hostile booking',
        timeZone: 'UTC',
        occurrences: [{ start: isoIn(120), end: isoIn(124) }],
      }),
    });
    expect([401, 403]).toContain(res.status);

    const admin = adminClient();
    const { data } = await admin
      .from('aft_reservations')
      .select('id')
      .eq('aircraft_id', userA.aircraftId);
    expect(data?.length ?? 0).toBe(0);
  });

  test('user B cannot cancel user A reservation', async ({ userA, userB, baseURL }) => {
    const admin = adminClient();
    // Seed a reservation for A.
    const { data: r } = await admin
      .from('aft_reservations')
      .insert({
        aircraft_id: userA.aircraftId,
        user_id: userA.userId,
        start_time: isoIn(150),
        end_time: isoIn(154),
        status: 'confirmed',
        title: 'A-only booking',
      })
      .select('id')
      .single();
    const reservationId = r!.id;

    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, '/api/reservations', {
      method: 'DELETE',
      body: JSON.stringify({ reservationId, timeZone: 'UTC' }),
    });
    expect([403, 404]).toContain(res.status);

    const { data: row } = await admin
      .from('aft_reservations')
      .select('status')
      .eq('id', reservationId)
      .single();
    expect(row?.status).toBe('confirmed');
  });
});

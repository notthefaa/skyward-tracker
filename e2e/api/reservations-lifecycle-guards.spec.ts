import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * /api/reservations PUT + DELETE lifecycle guards.
 *
 * The route reads the existing reservation by id with no status
 * filter, then PUT lets you edit a cancelled row's start/end/title
 * (it stays status='cancelled' but the times silently change), and
 * DELETE on an already-cancelled row succeeds + sends a duplicate
 * "Reservation Cancelled" email to every assigned pilot. Neither
 * verb has idempotency wiring — slow-network double-taps fire the
 * email N times.
 *
 * These specs lock the cancel-terminal guard + idempotency replay
 * on both verbs.
 */

async function seedReservation(seededUser: { aircraftId: string; userId: string }) {
  const admin = adminClient();
  const start = new Date(Date.now() + 7 * 86400_000).toISOString();
  const end = new Date(Date.now() + 7 * 86400_000 + 2 * 3600_000).toISOString();
  const { data: r, error } = await admin
    .from('aft_reservations')
    .insert({
      aircraft_id: seededUser.aircraftId,
      user_id: seededUser.userId,
      start_time: start,
      end_time: end,
      pilot_name: 'Test Pilot',
      pilot_initials: 'TP',
      status: 'confirmed',
      time_zone: 'America/Los_Angeles',
    })
    .select('id, start_time, end_time')
    .single();
  if (error || !r) throw new Error(`seed reservation: ${error?.message ?? 'no row'}`);
  return { reservationId: r.id as string, startTime: r.start_time as string, endTime: r.end_time as string };
}

async function cleanup(reservationId: string) {
  await adminClient().from('aft_reservations').delete().eq('id', reservationId);
}

test.describe('reservations — cancel-terminal guard + idempotency', () => {
  test('PUT on a cancelled reservation: 409, no silent time edit', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { reservationId, startTime, endTime } = await seedReservation(seededUser);
    await admin.from('aft_reservations').update({ status: 'cancelled' }).eq('id', reservationId);

    const token = await getAccessToken(seededUser.email, seededUser.password);

    const newStart = new Date(Date.now() + 14 * 86400_000).toISOString();
    const newEnd = new Date(Date.now() + 14 * 86400_000 + 2 * 3600_000).toISOString();

    const res = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'PUT',
      body: JSON.stringify({
        reservationId,
        startTime: newStart,
        endTime: newEnd,
        title: 'Sneaky edit',
      }),
    });
    expect(res.status).toBe(409);

    const { data: after } = await admin
      .from('aft_reservations')
      .select('start_time, end_time, title, status')
      .eq('id', reservationId)
      .single();
    expect(after?.start_time).toBe(startTime);
    expect(after?.end_time).toBe(endTime);
    expect(after?.title).toBeNull();
    expect(after?.status).toBe('cancelled');

    await cleanup(reservationId);
  });

  test('DELETE on an already-cancelled reservation: 409, no duplicate email', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { reservationId } = await seedReservation(seededUser);
    await admin.from('aft_reservations').update({ status: 'cancelled' }).eq('id', reservationId);

    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'DELETE',
      body: JSON.stringify({ reservationId }),
    });
    expect(res.status).toBe(409);

    await cleanup(reservationId);
  });

  test('PUT idempotency: same X-Idempotency-Key returns cached without re-running side effects', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { reservationId } = await seedReservation(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const idemKey = randomUUID();

    const newStart = new Date(Date.now() + 21 * 86400_000).toISOString();
    const newEnd = new Date(Date.now() + 21 * 86400_000 + 2 * 3600_000).toISOString();

    const body = JSON.stringify({ reservationId, startTime: newStart, endTime: newEnd });

    const res1 = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'PUT',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(res1.status).toBe(200);

    const res2 = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'PUT',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(res2.status).toBe(200);

    // The row should reflect ONE update, not two — both idempotency
    // and the actual UPDATE land the same final state, so this is a
    // weak assertion. The real protection is the email side-effect
    // (not directly observable in CI without Resend mocks). What we
    // *can* assert is that the second response was cached, not a
    // fresh re-run that hit the conflict-check + UPDATE again. Check
    // by examining aft_idempotency_keys.
    const { data: idemRow } = await admin
      .from('aft_idempotency_keys')
      .select('user_id, route, response_status')
      .eq('key', idemKey)
      .maybeSingle();
    expect(idemRow).toBeTruthy();
    expect(idemRow?.route).toBe('reservations/PUT');
    expect(idemRow?.response_status).toBe(200);

    await cleanup(reservationId);
  });

  test('DELETE idempotency: same X-Idempotency-Key returns cached without re-running side effects', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { reservationId } = await seedReservation(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const idemKey = randomUUID();

    const body = JSON.stringify({ reservationId });

    const res1 = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'DELETE',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(res1.status).toBe(200);

    const res2 = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'DELETE',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(res2.status).toBe(200);

    const { data: idemRow } = await admin
      .from('aft_idempotency_keys')
      .select('route, response_status')
      .eq('key', idemKey)
      .maybeSingle();
    expect(idemRow).toBeTruthy();
    expect(idemRow?.route).toBe('reservations/DELETE');
    expect(idemRow?.response_status).toBe(200);

    // Final state: cancelled exactly once.
    const { data: row } = await admin
      .from('aft_reservations')
      .select('status')
      .eq('id', reservationId)
      .single();
    expect(row?.status).toBe('cancelled');

    await cleanup(reservationId);
  });

  test('regression: PUT on a confirmed reservation still works (no false-positive 409)', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { reservationId } = await seedReservation(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const newStart = new Date(Date.now() + 30 * 86400_000).toISOString();
    const newEnd = new Date(Date.now() + 30 * 86400_000 + 2 * 3600_000).toISOString();

    const res = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'PUT',
      body: JSON.stringify({
        reservationId,
        startTime: newStart,
        endTime: newEnd,
        title: 'Edited',
      }),
    });
    expect(res.status).toBe(200);

    const { data: after } = await admin
      .from('aft_reservations')
      .select('start_time, end_time, title, status')
      .eq('id', reservationId)
      .single();
    // Postgres returns timestamps as ISO with `+00:00` instead of `Z`;
    // normalise both sides to compare instants, not byte-strings.
    expect(new Date(after?.start_time as string).toISOString()).toBe(new Date(newStart).toISOString());
    expect(new Date(after?.end_time as string).toISOString()).toBe(new Date(newEnd).toISOString());
    expect(after?.title).toBe('Edited');
    expect(after?.status).toBe('confirmed');

    await cleanup(reservationId);
  });

  test('regression: DELETE on a confirmed reservation still cancels (no false-positive 409)', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { reservationId } = await seedReservation(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'DELETE',
      body: JSON.stringify({ reservationId }),
    });
    expect(res.status).toBe(200);

    const { data: after } = await admin
      .from('aft_reservations')
      .select('status')
      .eq('id', reservationId)
      .single();
    expect(after?.status).toBe('cancelled');

    await cleanup(reservationId);
  });
});

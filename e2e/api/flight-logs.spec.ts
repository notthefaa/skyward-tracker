import { test, expect } from '../fixtures/two-users';
import { test as singleTest } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

singleTest.describe('flight-logs API — happy path', () => {
  singleTest('admin posts a piston flight, totals self-derive from latest log', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/flight-logs', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        logData: {
          tach: 1001,
          hobbs: 1001,
          landings: 1,
          engine_cycles: 0,
          initials: 'TST',
          occurred_at: new Date().toISOString(),
        },
      }),
    });
    expect(res.status).toBe(200);

    const admin = adminClient();
    const { data: ac } = await admin
      .from('aft_aircraft')
      .select('total_engine_time, total_airframe_time')
      .eq('id', seededUser.aircraftId)
      .single();
    expect(Number(ac?.total_engine_time)).toBe(1001);
  });

  singleTest('idempotency key returns same logId on replay', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const idemKey = randomUUID();
    const body = JSON.stringify({
      aircraftId: seededUser.aircraftId,
      logData: {
        tach: 1002,
        hobbs: 1002,
        landings: 1,
        engine_cycles: 0,
        initials: 'TST',
        occurred_at: new Date().toISOString(),
      },
    });
    const r1 = await fetchAs(token, baseURL!, '/api/flight-logs', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    const r2 = await fetchAs(token, baseURL!, '/api/flight-logs', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.logId).toBe(j2.logId);

    const admin = adminClient();
    const { data } = await admin
      .from('aft_flight_logs')
      .select('id')
      .eq('aircraft_id', seededUser.aircraftId)
      .is('deleted_at', null);
    expect(data?.length).toBe(1);
  });

  singleTest('admin edits a log, aircraft totals re-derive from latest', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const create = await fetchAs(token, baseURL!, '/api/flight-logs', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        logData: {
          tach: 1010, hobbs: 1010, landings: 2, engine_cycles: 0, initials: 'TST',
          occurred_at: new Date().toISOString(),
        },
      }),
    });
    const { logId } = await create.json();

    const edit = await fetchAs(token, baseURL!, '/api/flight-logs', {
      method: 'PUT',
      body: JSON.stringify({
        logId,
        aircraftId: seededUser.aircraftId,
        logData: { tach: 1015, hobbs: 1015, landings: 3, engine_cycles: 0, initials: 'EDT' },
      }),
    });
    expect(edit.status).toBe(200);

    const admin = adminClient();
    const { data: ac } = await admin
      .from('aft_aircraft')
      .select('total_engine_time')
      .eq('id', seededUser.aircraftId)
      .single();
    expect(Number(ac?.total_engine_time)).toBe(1015);
  });
});

test.describe('flight-logs API — cross-user / scope guards', () => {
  test('user B cannot post a flight on user A aircraft', async ({ userA, userB, baseURL }) => {
    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, '/api/flight-logs', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: userA.aircraftId,
        logData: {
          tach: 999,
          hobbs: 999,
          landings: 1,
          engine_cycles: 0,
          initials: 'BAD',
          occurred_at: new Date().toISOString(),
        },
      }),
    });
    expect([401, 403, 404]).toContain(res.status);

    const admin = adminClient();
    const { data } = await admin
      .from('aft_flight_logs')
      .select('id')
      .eq('aircraft_id', userA.aircraftId)
      .is('deleted_at', null);
    expect(data?.length ?? 0).toBe(0);
  });

  test('user B cannot edit user A flight log via PUT', async ({ userA, userB, baseURL }) => {
    // Seed a log on A's aircraft via service role.
    const admin = adminClient();
    const { data: log } = await admin
      .from('aft_flight_logs')
      .insert({
        aircraft_id: userA.aircraftId,
        user_id: userA.userId,
        tach: 600,
        hobbs: 600,
        landings: 1,
        engine_cycles: 0,
        initials: 'A',
        occurred_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    const logId = log!.id;

    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, '/api/flight-logs', {
      method: 'PUT',
      body: JSON.stringify({
        logId,
        aircraftId: userB.aircraftId,
        logData: { tach: 99999, hobbs: 99999, landings: 1, engine_cycles: 0, initials: 'X' },
      }),
    });
    expect([400, 401, 403, 404]).toContain(res.status);

    const { data: row } = await admin
      .from('aft_flight_logs')
      .select('tach')
      .eq('id', logId)
      .single();
    expect(Number(row?.tach)).toBe(600);
  });
});

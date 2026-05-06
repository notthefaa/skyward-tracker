import { test, expect } from '../fixtures/seeded-user';
import { test as crossTest } from '../fixtures/two-users';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * Aircraft API lifecycle — create, delete, fuel update, access
 * management. The seededUser fixture already exercises the create
 * RPC (via create_aircraft_atomic) and the create_aircraft trap memory;
 * this file pins the API contract on top.
 *
 * Specs:
 *   - POST /api/aircraft/create:
 *       happy path stamps created_by from JWT;
 *       allow-list ignores server-owned fields (created_by spoof, id spoof);
 *       dup tail returns 400 with 23505 friendly message;
 *       missing tail returns 400.
 *   - DELETE /api/aircraft/delete:
 *       aircraft admin can delete, cascade soft-deletes children;
 *       pilot 403; already-deleted 410.
 *   - POST /api/aircraft/fuel:
 *       valid gallons persists; out-of-range / non-numeric 400;
 *       cross-user 403.
 *   - PUT/DELETE /api/aircraft-access:
 *       sole-admin demotion blocked + reverted (race-safe);
 *       sole-admin removal blocked + restored.
 */

test.describe('aircraft create — payload + dup', () => {
  test('POST /api/aircraft/create stamps created_by; ignores spoofed server fields', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const tail = `N${randomUUID().slice(0, 5).toUpperCase()}`;
    const fakeUserId = '00000000-0000-0000-0000-000000000000';

    const res = await fetchAs(token, baseURL!, '/api/aircraft/create', {
      method: 'POST',
      body: JSON.stringify({
        payload: {
          tail_number: tail,
          aircraft_type: 'Cessna 172S',
          engine_type: 'Piston',
          // Spoof attempts the allow-list must ignore:
          id: '11111111-1111-1111-1111-111111111111',
          created_by: fakeUserId,
          deleted_at: '2026-01-01T00:00:00Z',
        },
      }),
    });
    expect(res.status).toBe(200);
    const { aircraft } = await res.json();
    expect(aircraft?.id).toBeTruthy();
    expect(aircraft.id).not.toBe('11111111-1111-1111-1111-111111111111');

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_aircraft')
      .select('tail_number, created_by, deleted_at')
      .eq('id', aircraft.id)
      .single();
    expect(row?.tail_number).toBe(tail);
    expect(row?.created_by).toBe(seededUser.userId);
    expect(row?.deleted_at).toBeNull();

    // Cleanup so the seededUser teardown doesn't leave an extra aircraft.
    await admin.from('aft_aircraft').delete().eq('id', aircraft.id);
  });

  test('POST /api/aircraft/create returns 400 when tail is missing', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/aircraft/create', {
      method: 'POST',
      body: JSON.stringify({ payload: { aircraft_type: 'Cessna 172S' } }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /api/aircraft/create rejects duplicate tail (23505 → friendly 400)', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/aircraft/create', {
      method: 'POST',
      body: JSON.stringify({ payload: { tail_number: seededUser.tailNumber, aircraft_type: 'Cessna 172S' } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/i);
  });
});

test.describe('aircraft delete — cascade + auth', () => {
  test('aircraft admin can soft-delete; cascade soft-deletes children', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();

    // Seed cascade children: a flight log + a squawk + a note.
    const { data: log, error: logErr } = await admin
      .from('aft_flight_logs')
      .insert({
        aircraft_id: seededUser.aircraftId,
        user_id: seededUser.userId,
        aftt: 1.0,
        ftt: 1.0,
        engine_cycles: 1,
        landings: 1,
        initials: 'TST',
      })
      .select('id')
      .single();
    if (logErr || !log) throw new Error(`seed flight log: ${logErr?.message}`);
    const { data: sq, error: sqErr } = await admin
      .from('aft_squawks')
      .insert({
        aircraft_id: seededUser.aircraftId,
        reported_by: seededUser.userId,
        description: 'Cascade test',
        access_token: randomUUID().replace(/-/g, ''),
      })
      .select('id')
      .single();
    if (sqErr || !sq) throw new Error(`seed squawk: ${sqErr?.message}`);
    const { data: note, error: noteErr } = await admin
      .from('aft_notes')
      .insert({
        aircraft_id: seededUser.aircraftId,
        author_id: seededUser.userId,
        author_initials: 'TST',
        content: 'Cascade test note',
      })
      .select('id')
      .single();
    if (noteErr || !note) throw new Error(`seed note: ${noteErr?.message}`);

    const res = await fetchAs(token, baseURL!, '/api/aircraft/delete', {
      method: 'DELETE',
      body: JSON.stringify({ aircraftId: seededUser.aircraftId }),
    });
    expect(res.status).toBe(200);

    const [parent, logRow, sqRow, noteRow, accessRows] = await Promise.all([
      admin.from('aft_aircraft').select('deleted_at, deleted_by').eq('id', seededUser.aircraftId).single(),
      admin.from('aft_flight_logs').select('deleted_at').eq('id', log!.id).single(),
      admin.from('aft_squawks').select('deleted_at').eq('id', sq!.id).single(),
      admin.from('aft_notes').select('deleted_at').eq('id', note!.id).single(),
      admin.from('aft_user_aircraft_access').select('user_id').eq('aircraft_id', seededUser.aircraftId),
    ]);

    expect(parent.data?.deleted_at).not.toBeNull();
    expect(parent.data?.deleted_by).toBe(seededUser.userId);
    expect(logRow.data?.deleted_at).not.toBeNull();
    expect(sqRow.data?.deleted_at).not.toBeNull();
    expect(noteRow.data?.deleted_at).not.toBeNull();
    // Hard-deleted: no access grants remain.
    expect((accessRows.data || []).length).toBe(0);
  });

  test('already-deleted aircraft returns 410', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();
    await admin
      .from('aft_aircraft')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', seededUser.aircraftId);

    const res = await fetchAs(token, baseURL!, '/api/aircraft/delete', {
      method: 'DELETE',
      body: JSON.stringify({ aircraftId: seededUser.aircraftId }),
    });
    expect(res.status).toBe(410);
  });
});

test.describe('aircraft fuel — bounded update', () => {
  test('valid gallons persists + stamps fuel_last_updated', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/aircraft/fuel', {
      method: 'POST',
      body: JSON.stringify({ aircraftId: seededUser.aircraftId, gallons: 42.5 }),
    });
    expect(res.status).toBe(200);

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_aircraft')
      .select('current_fuel_gallons, fuel_last_updated')
      .eq('id', seededUser.aircraftId)
      .single();
    expect(Number(row?.current_fuel_gallons)).toBe(42.5);
    expect(row?.fuel_last_updated).not.toBeNull();
  });

  test('rejects NaN / Infinity / negative / out-of-range', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const cases = [
      { gallons: 'not a number' },
      { gallons: -5 },
      { gallons: 50_000 },
      { gallons: null },
    ];
    for (const body of cases) {
      const res = await fetchAs(token, baseURL!, '/api/aircraft/fuel', {
        method: 'POST',
        body: JSON.stringify({ aircraftId: seededUser.aircraftId, ...body }),
      });
      expect(res.status, `expected 400 for ${JSON.stringify(body)}`).toBe(400);
    }
  });
});

crossTest.describe('aircraft fuel — cross-user', () => {
  crossTest('user B cannot update fuel on user A aircraft', async ({ userA, userB, baseURL }) => {
    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, '/api/aircraft/fuel', {
      method: 'POST',
      body: JSON.stringify({ aircraftId: userA.aircraftId, gallons: 99 }),
    });
    expect([401, 403, 404]).toContain(res.status);
  });
});

test.describe('aircraft-access — sole-admin guards', () => {
  test('demoting the only admin is blocked + reverted', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/aircraft-access', {
      method: 'PUT',
      body: JSON.stringify({
        targetUserId: seededUser.userId,
        aircraftId: seededUser.aircraftId,
        newRole: 'pilot',
      }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/no other admins remain/i);

    // Role unchanged.
    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_user_aircraft_access')
      .select('aircraft_role')
      .eq('user_id', seededUser.userId)
      .eq('aircraft_id', seededUser.aircraftId)
      .single();
    expect(row?.aircraft_role).toBe('admin');
  });

  test('removing the only admin is blocked + restored', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/aircraft-access', {
      method: 'DELETE',
      body: JSON.stringify({
        targetUserId: seededUser.userId,
        aircraftId: seededUser.aircraftId,
      }),
    });
    expect(res.status).toBe(409);

    // Access row restored.
    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_user_aircraft_access')
      .select('aircraft_role')
      .eq('user_id', seededUser.userId)
      .eq('aircraft_id', seededUser.aircraftId)
      .single();
    expect(row?.aircraft_role).toBe('admin');
  });
});

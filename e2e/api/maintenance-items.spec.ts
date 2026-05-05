import { test, expect } from '../fixtures/two-users';
import { test as singleTest } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';

/**
 * /api/maintenance-items integration coverage. The route guards on:
 *   - aircraft-admin role (requireAircraftAdmin)
 *   - aircraft-id matches the row's aircraft_id (cross-aircraft guard)
 *   - validateMxItemRow (numeric/date/boolean coercion + bounds)
 *   - soft-delete idempotency on UPDATE/DELETE
 *
 * These are the exact properties that have regressed in past audits
 * (see project_deep_scan_2026_05_03 and feedback_audit_contract_mismatches).
 * High-leverage to keep covered.
 */

singleTest.describe('maintenance-items API — happy path', () => {
  singleTest('admin creates → updates → soft-deletes their own item', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);

    // Create
    const createRes = await fetchAs(token, baseURL!, '/api/maintenance-items', {
      method: 'POST',
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        itemData: {
          item_name: 'Oil Change',
          tracking_type: 'time',
          time_interval: 50,
          last_completed_time: 1000,
          due_time: 1050,
          is_required: true,
          automate_scheduling: false,
        },
      }),
    });
    expect(createRes.status).toBe(200);

    // Read back via admin client
    const admin = adminClient();
    const { data: rows } = await admin
      .from('aft_maintenance_items')
      .select('id, item_name, time_interval, deleted_at')
      .eq('aircraft_id', seededUser.aircraftId)
      .is('deleted_at', null);
    expect(rows?.length).toBe(1);
    const itemId = rows![0].id as string;
    expect(rows![0].item_name).toBe('Oil Change');
    expect(Number(rows![0].time_interval)).toBe(50);

    // Update
    const updateRes = await fetchAs(token, baseURL!, '/api/maintenance-items', {
      method: 'PUT',
      body: JSON.stringify({
        itemId,
        aircraftId: seededUser.aircraftId,
        itemData: { time_interval: 100, due_time: 1100 },
      }),
    });
    expect(updateRes.status).toBe(200);

    const { data: updated } = await admin
      .from('aft_maintenance_items')
      .select('time_interval, due_time')
      .eq('id', itemId)
      .single();
    expect(Number(updated?.time_interval)).toBe(100);
    expect(Number(updated?.due_time)).toBe(1100);

    // Delete
    const deleteRes = await fetchAs(token, baseURL!, '/api/maintenance-items', {
      method: 'DELETE',
      body: JSON.stringify({ itemId, aircraftId: seededUser.aircraftId }),
    });
    expect(deleteRes.status).toBe(200);

    const { data: after } = await admin
      .from('aft_maintenance_items')
      .select('deleted_at, deleted_by')
      .eq('id', itemId)
      .single();
    expect(after?.deleted_at).not.toBeNull();
    expect(after?.deleted_by).toBe(seededUser.userId);
  });

  singleTest('rejects invalid tracking_type with 400', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/maintenance-items', {
      method: 'POST',
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        itemData: { item_name: 'Bad', tracking_type: 'bogus' },
      }),
    });
    expect(res.status).toBe(400);
  });

  singleTest('rejects NaN-prone string in time_interval', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/maintenance-items', {
      method: 'POST',
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        itemData: { item_name: 'Bad', tracking_type: 'time', time_interval: 'forty' },
      }),
    });
    expect(res.status).toBe(400);
  });
});

test.describe('maintenance-items API — cross-user / scope guards', () => {
  test('user B cannot create an item on user A aircraft', async ({ userA, userB, baseURL }) => {
    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, '/api/maintenance-items', {
      method: 'POST',
      body: JSON.stringify({
        aircraftId: userA.aircraftId,
        itemData: { item_name: 'Hostile', tracking_type: 'time' },
      }),
    });
    // requireAircraftAdmin → 403 Forbidden (or 401 if no role row).
    expect([401, 403, 404]).toContain(res.status);

    // Verify nothing got written to A's aircraft.
    const admin = adminClient();
    const { data } = await admin
      .from('aft_maintenance_items')
      .select('id')
      .eq('aircraft_id', userA.aircraftId)
      .is('deleted_at', null);
    expect(data?.length ?? 0).toBe(0);
  });

  test('user B cannot update an item across the aircraft boundary', async ({ userA, userB, baseURL }) => {
    // Seed an item on A's aircraft via service role (so we don't depend
    // on the create flow during this guard-specific test).
    const admin = adminClient();
    const { data: created } = await admin
      .from('aft_maintenance_items')
      .insert({
        aircraft_id: userA.aircraftId,
        item_name: 'A-only Item',
        tracking_type: 'time',
        time_interval: 50,
      })
      .select('id')
      .single();
    const itemId = created!.id;

    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, '/api/maintenance-items', {
      method: 'PUT',
      body: JSON.stringify({
        itemId,
        aircraftId: userB.aircraftId,
        itemData: { time_interval: 999 },
      }),
    });
    expect([401, 403, 404]).toContain(res.status);

    // The original row must be untouched.
    const { data: row } = await admin
      .from('aft_maintenance_items')
      .select('time_interval, item_name')
      .eq('id', itemId)
      .single();
    expect(Number(row?.time_interval)).toBe(50);
    expect(row?.item_name).toBe('A-only Item');
  });

  test('admin of A cannot update an item on B by spoofing the aircraftId', async ({ userA, userB, baseURL }) => {
    // Item on B's aircraft.
    const admin = adminClient();
    const { data: created } = await admin
      .from('aft_maintenance_items')
      .insert({
        aircraft_id: userB.aircraftId,
        item_name: 'B-only Item',
        tracking_type: 'time',
        time_interval: 25,
      })
      .select('id')
      .single();
    const itemId = created!.id;

    // A is admin on their own aircraft. They submit a PUT with B's
    // itemId but A's aircraftId — the route should detect the mismatch.
    const tokenA = await getAccessToken(userA.email, userA.password);
    const res = await fetchAs(tokenA, baseURL!, '/api/maintenance-items', {
      method: 'PUT',
      body: JSON.stringify({
        itemId,
        aircraftId: userA.aircraftId,
        itemData: { time_interval: 9999 },
      }),
    });
    expect(res.status).toBe(404);

    const { data: row } = await admin
      .from('aft_maintenance_items')
      .select('time_interval')
      .eq('id', itemId)
      .single();
    expect(Number(row?.time_interval)).toBe(25);
  });
});

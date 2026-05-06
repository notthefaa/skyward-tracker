import { test, expect } from '../fixtures/seeded-user';
import { test as crossTest } from '../fixtures/two-users';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';

/**
 * Equipment lifecycle — edit / mark-removed / delete / protected
 * fields / cross-aircraft. The catalog-add UI flow lives in
 * `e2e/maintenance/equipment.spec.ts`; this file covers the API
 * contract and the audit-trail rules.
 *
 * Key invariants locked in here:
 *   - PUT can SET removed_at (the "Mark Removed" button — broken
 *     before this round when removed_at was in the validation strip
 *     set).
 *   - PUT cannot CLEAR removed_at on an already-removed row
 *     (resurrect block — the audit trail must stand).
 *   - Cross-aircraft PUT/DELETE rejected.
 */
async function seedEquipment(aircraftId: string, userId: string, overrides: Record<string, unknown> = {}) {
  const admin = adminClient();
  const { data, error } = await admin
    .from('aft_aircraft_equipment')
    .insert({
      aircraft_id: aircraftId,
      name: 'Garmin GTX 345',
      category: 'transponder',
      make: 'Garmin',
      model: 'GTX 345',
      created_by: userId,
      ...overrides,
    })
    .select('id, removed_at')
    .single();
  if (error || !data) throw new Error(`seed equipment: ${error?.message}`);
  return data;
}

test.describe('equipment API — edit + mark removed + protected fields', () => {
  test('PUT updates basic fields (name / model / notes)', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const seeded = await seedEquipment(seededUser.aircraftId, seededUser.userId);

    const res = await fetchAs(token, baseURL!, '/api/equipment', {
      method: 'PUT',
      body: JSON.stringify({
        equipmentId: seeded.id,
        aircraftId: seededUser.aircraftId,
        equipmentData: {
          name: 'Renamed transponder',
          model: 'GTX 345R',
          notes: 'Bench-checked 2026-05-01',
        },
      }),
    });
    expect(res.status).toBe(200);

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_aircraft_equipment')
      .select('name, model, notes')
      .eq('id', seeded.id)
      .single();
    expect(row?.name).toBe('Renamed transponder');
    expect(row?.model).toBe('GTX 345R');
    expect(row?.notes).toBe('Bench-checked 2026-05-01');
  });

  test('PUT can mark equipment as removed (the "Mark Removed" path)', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const seeded = await seedEquipment(seededUser.aircraftId, seededUser.userId);

    const res = await fetchAs(token, baseURL!, '/api/equipment', {
      method: 'PUT',
      body: JSON.stringify({
        equipmentId: seeded.id,
        aircraftId: seededUser.aircraftId,
        equipmentData: {
          removed_at: '2026-05-06',
          removed_reason: 'Replaced with GTX 375',
        },
      }),
    });
    expect(res.status).toBe(200);

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_aircraft_equipment')
      .select('removed_at, removed_reason')
      .eq('id', seeded.id)
      .single();
    // Without the route's removed_at carve-out this assertion is what
    // failed before the fix — the validation strip was dropping the
    // field entirely, so Mark Removed silently no-op'd.
    expect(row?.removed_at).toBe('2026-05-06');
    expect(row?.removed_reason).toBe('Replaced with GTX 375');
  });

  test('PUT cannot resurrect already-removed equipment by setting removed_at: null', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const seeded = await seedEquipment(seededUser.aircraftId, seededUser.userId, {
      removed_at: '2026-01-01',
      removed_reason: 'Original removal',
    });

    const res = await fetchAs(token, baseURL!, '/api/equipment', {
      method: 'PUT',
      body: JSON.stringify({
        equipmentId: seeded.id,
        aircraftId: seededUser.aircraftId,
        equipmentData: {
          removed_at: null,
          removed_reason: 'attempted resurrect',
        },
      }),
    });
    // The route silently strips the resurrect — request still 200,
    // but removed_at stays.
    expect(res.status).toBe(200);

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_aircraft_equipment')
      .select('removed_at, removed_reason')
      .eq('id', seeded.id)
      .single();
    expect(row?.removed_at).toBe('2026-01-01');
    // Other fields still update — only removed_at is protected.
    expect(row?.removed_reason).toBe('attempted resurrect');
  });

  test('DELETE soft-deletes (deleted_at populated)', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const seeded = await seedEquipment(seededUser.aircraftId, seededUser.userId);

    const res = await fetchAs(token, baseURL!, '/api/equipment', {
      method: 'DELETE',
      body: JSON.stringify({
        equipmentId: seeded.id,
        aircraftId: seededUser.aircraftId,
      }),
    });
    expect(res.status).toBe(200);

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_aircraft_equipment')
      .select('deleted_at, deleted_by')
      .eq('id', seeded.id)
      .single();
    expect(row?.deleted_at).not.toBeNull();
    expect(row?.deleted_by).toBe(seededUser.userId);
  });

  test('GET excludes removed by default, includes with includeRemoved=true', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    await seedEquipment(seededUser.aircraftId, seededUser.userId, { name: 'Active radio', category: 'radio' });
    await seedEquipment(seededUser.aircraftId, seededUser.userId, {
      name: 'Removed radio',
      category: 'radio',
      removed_at: '2025-12-01',
    });

    const res1 = await fetchAs(token, baseURL!, `/api/equipment?aircraftId=${seededUser.aircraftId}`);
    expect(res1.status).toBe(200);
    const j1 = await res1.json();
    const names1 = (j1.equipment as { name: string }[]).map(e => e.name);
    expect(names1).toContain('Active radio');
    expect(names1).not.toContain('Removed radio');

    const res2 = await fetchAs(token, baseURL!, `/api/equipment?aircraftId=${seededUser.aircraftId}&includeRemoved=true`);
    expect(res2.status).toBe(200);
    const j2 = await res2.json();
    const names2 = (j2.equipment as { name: string }[]).map(e => e.name);
    expect(names2).toContain('Active radio');
    expect(names2).toContain('Removed radio');
  });
});

crossTest.describe('equipment API — cross-aircraft scope', () => {
  crossTest('user B cannot edit user A equipment via spoofed aircraftId', async ({ userA, userB, baseURL }) => {
    const admin = adminClient();
    const { data: gear } = await admin
      .from('aft_aircraft_equipment')
      .insert({
        aircraft_id: userA.aircraftId,
        name: 'A-only transponder',
        category: 'transponder',
        created_by: userA.userId,
      })
      .select('id')
      .single();
    const equipmentId = gear!.id as string;

    const tokenB = await getAccessToken(userB.email, userB.password);

    // B tries with their own aircraftId — equipmentId+aircraftId
    // mismatch hits the .eq filter → no row updated, but the access
    // gate also fires.
    const res1 = await fetchAs(tokenB, baseURL!, '/api/equipment', {
      method: 'PUT',
      body: JSON.stringify({
        equipmentId,
        aircraftId: userB.aircraftId,
        equipmentData: { name: 'Hijacked' },
      }),
    });
    // requireAircraftAdmin on B's aircraft is fine, so this call
    // would 200 with zero rows updated; assert the row didn't change.
    expect([200, 403, 404]).toContain(res1.status);

    // B tries with A's aircraftId — fails the admin gate.
    const res2 = await fetchAs(tokenB, baseURL!, '/api/equipment', {
      method: 'PUT',
      body: JSON.stringify({
        equipmentId,
        aircraftId: userA.aircraftId,
        equipmentData: { name: 'Hijacked' },
      }),
    });
    expect([401, 403, 404]).toContain(res2.status);

    const { data: row } = await admin
      .from('aft_aircraft_equipment')
      .select('name')
      .eq('id', equipmentId)
      .single();
    expect(row?.name).toBe('A-only transponder');
  });

  crossTest('user B cannot delete user A equipment', async ({ userA, userB, baseURL }) => {
    const admin = adminClient();
    const { data: gear } = await admin
      .from('aft_aircraft_equipment')
      .insert({
        aircraft_id: userA.aircraftId,
        name: 'A-only ELT',
        category: 'elt',
        created_by: userA.userId,
      })
      .select('id')
      .single();
    const equipmentId = gear!.id as string;

    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, '/api/equipment', {
      method: 'DELETE',
      body: JSON.stringify({ equipmentId, aircraftId: userA.aircraftId }),
    });
    expect([401, 403, 404]).toContain(res.status);

    const { data: row } = await admin
      .from('aft_aircraft_equipment')
      .select('deleted_at')
      .eq('id', equipmentId)
      .single();
    expect(row?.deleted_at).toBeNull();
  });
});

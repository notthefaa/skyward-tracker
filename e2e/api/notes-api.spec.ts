import { test, expect } from '../fixtures/two-users';
import { test as singleTest } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * Phase 6 — notes API guards. The UI flow lives in
 * `e2e/notes/notes.spec.ts`. This file covers:
 *   - cross-user / cross-aircraft scope guards on PUT + DELETE
 *   - pictures URL injection rejected (bucket scoping)
 *   - aircraft admin can edit OR delete a note authored by another
 *     user on the same aircraft (admin override path)
 */

singleTest.describe('notes API — pictures URL guard', () => {
  singleTest('rejects pictures pointing at a foreign URL', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/notes', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        noteData: {
          content: 'Tracking-pixel injection attempt',
          pictures: ['https://attacker.example.com/track.png'],
          author_initials: 'TST',
        },
      }),
    });
    expect(res.status).toBe(400);
  });

  singleTest('rejects PUT with pictures pointing at a foreign URL', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const { data: note } = await admin
      .from('aft_notes')
      .insert({
        aircraft_id: seededUser.aircraftId,
        author_id: seededUser.userId,
        content: 'Original note',
        pictures: [],
      })
      .select('id')
      .single();

    const res = await fetchAs(token, baseURL!, '/api/notes', {
      method: 'PUT',
      body: JSON.stringify({
        noteId: note!.id,
        aircraftId: seededUser.aircraftId,
        noteData: {
          content: 'Edited',
          pictures: ['https://evil.example.com/track.png'],
        },
      }),
    });
    expect(res.status).toBe(400);

    // Note's pictures must be unchanged.
    const { data: row } = await admin
      .from('aft_notes')
      .select('pictures, content')
      .eq('id', note!.id)
      .single();
    expect(row?.pictures).toEqual([]);
    expect(row?.content).toBe('Original note');
  });
});

test.describe('notes API — cross-user / scope guards', () => {
  test('user B cannot edit a note on user A aircraft', async ({ userA, userB, baseURL }) => {
    const admin = adminClient();
    const { data: note } = await admin
      .from('aft_notes')
      .insert({
        aircraft_id: userA.aircraftId,
        author_id: userA.userId,
        content: "User A's note",
      })
      .select('id')
      .single();

    const tokenB = await getAccessToken(userB.email, userB.password);
    // Attack 1: spoof the aircraftId to userA's aircraft.
    const res = await fetchAs(tokenB, baseURL!, '/api/notes', {
      method: 'PUT',
      body: JSON.stringify({
        noteId: note!.id,
        aircraftId: userA.aircraftId,
        noteData: { content: 'tampered' },
      }),
    });
    expect([403, 404]).toContain(res.status);

    const { data: row } = await admin
      .from('aft_notes')
      .select('content')
      .eq('id', note!.id)
      .single();
    expect(row?.content).toBe("User A's note");
  });

  test('user B cannot delete a note across the aircraft boundary', async ({ userA, userB, baseURL }) => {
    const admin = adminClient();
    const { data: note } = await admin
      .from('aft_notes')
      .insert({
        aircraft_id: userA.aircraftId,
        author_id: userA.userId,
        content: 'Cross-aircraft delete target',
      })
      .select('id')
      .single();

    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, '/api/notes', {
      method: 'DELETE',
      body: JSON.stringify({
        noteId: note!.id,
        aircraftId: userA.aircraftId,
      }),
    });
    expect([403, 404]).toContain(res.status);

    const { data: row } = await admin
      .from('aft_notes')
      .select('deleted_at')
      .eq('id', note!.id)
      .single();
    expect(row?.deleted_at).toBeNull();
  });

  test('admin override: aircraft admin can delete a note authored by another pilot', async ({ baseURL }) => {
    const admin = adminClient();

    // Admin user (aircraft admin via create_aircraft_atomic).
    const adminEmail = `e2e-admin-${randomUUID()}@skyward-test.local`;
    const adminPw = `pw-${randomUUID().slice(0, 12)}`;
    const { data: a } = await admin.auth.admin.createUser({
      email: adminEmail, password: adminPw, email_confirm: true,
    });
    const adminId = a!.user!.id;
    const { data: ac } = await admin.rpc('create_aircraft_atomic', {
      p_user_id: adminId,
      p_payload: { tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`, aircraft_type: 'Cessna 172S', engine_type: 'Piston' },
    });
    const aircraftId = (ac as { id: string }).id;

    // Pilot user with access to the same aircraft (not admin there).
    const pilotEmail = `e2e-pilot-${randomUUID()}@skyward-test.local`;
    const pilotPw = `pw-${randomUUID().slice(0, 12)}`;
    const { data: p } = await admin.auth.admin.createUser({
      email: pilotEmail, password: pilotPw, email_confirm: true,
    });
    const pilotId = p!.user!.id;
    await admin.from('aft_user_roles').upsert(
      { user_id: pilotId, role: 'pilot', email: pilotEmail, completed_onboarding: true },
      { onConflict: 'user_id' },
    );
    await admin.from('aft_user_aircraft_access').upsert(
      { user_id: pilotId, aircraft_id: aircraftId, aircraft_role: 'pilot' },
      { onConflict: 'user_id,aircraft_id' },
    );

    // Pilot writes a note.
    const { data: note } = await admin
      .from('aft_notes')
      .insert({
        aircraft_id: aircraftId,
        author_id: pilotId,
        content: 'Pilot-authored note that admin can delete',
      })
      .select('id')
      .single();

    // Admin deletes it.
    const adminToken = await getAccessToken(adminEmail, adminPw);
    const res = await fetchAs(adminToken, baseURL!, '/api/notes', {
      method: 'DELETE',
      body: JSON.stringify({ noteId: note!.id, aircraftId }),
    });
    expect(res.status).toBe(200);

    const { data: row } = await admin
      .from('aft_notes')
      .select('deleted_at, deleted_by')
      .eq('id', note!.id)
      .single();
    expect(row?.deleted_at).not.toBeNull();
    expect(row?.deleted_by).toBe(adminId);

    // Cleanup.
    await admin.from('aft_aircraft').delete().eq('id', aircraftId);
    await admin.auth.admin.deleteUser(adminId).then(undefined, () => {});
    await admin.auth.admin.deleteUser(pilotId).then(undefined, () => {});
  });
});

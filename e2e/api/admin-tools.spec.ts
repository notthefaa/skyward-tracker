import { test, expect } from '../fixtures/seeded-user';
import { test as crossTest } from '../fixtures/two-users';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';

/**
 * Admin tools — `/api/admin/db-health` GET, `/api/admin/users` GET/PUT.
 *
 * Destructive POST paths (db-health cleanup, account-delete) are NOT
 * exercised — they touch retention-policy-driven data and orphan
 * sweeps that would mutate real test state. Read-only admin coverage
 * is enough to lock in the auth gates + the read-error throws that
 * stop a partial table list rendering as "all clean".
 *
 * Each test promotes the seeded user to global admin first; the
 * fixture cleanup deletes the user, so the role change is scoped
 * to the test.
 */

async function promoteToAdmin(userId: string): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from('aft_user_roles')
    .update({ role: 'admin' })
    .eq('user_id', userId);
  if (error) throw new Error(`promote: ${error.message}`);
}

test.describe('admin/db-health GET — read-only stats', () => {
  test('admin sees row counts for the tracked tables', async ({ seededUser, baseURL }) => {
    await promoteToAdmin(seededUser.userId);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/admin/db-health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.table_row_counts).toBeTruthy();
    // Aircraft + user roles are guaranteed >= 1 because the fixture
    // seeded them.
    expect(body.table_row_counts.aft_aircraft).toBeGreaterThanOrEqual(1);
    expect(body.table_row_counts.aft_user_roles).toBeGreaterThanOrEqual(1);
    // The handler tracks these specific tables — sanity-check a few
    // so a typo in the constants list doesn't go unnoticed.
    for (const t of [
      'aft_flight_logs',
      'aft_maintenance_items',
      'aft_squawks',
      'aft_notes',
      'aft_reservations',
    ]) {
      expect(body.table_row_counts).toHaveProperty(t);
    }
  });

  test('non-admin pilot is rejected with 403', async ({ seededUser, baseURL }) => {
    // seededUser stays at default role='pilot'.
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/admin/db-health');
    expect(res.status).toBe(403);
  });
});

test.describe('admin/users GET — list users + aircraft assignments', () => {
  test('admin gets every user with aircraft assignments populated', async ({ seededUser, baseURL }) => {
    await promoteToAdmin(seededUser.userId);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/admin/users');
    expect(res.status).toBe(200);
    const { users } = await res.json();
    expect(Array.isArray(users)).toBe(true);

    const me = users.find((u: any) => u.user_id === seededUser.userId);
    expect(me).toBeTruthy();
    expect(me.role).toBe('admin');
    // The fixture set up an admin-role aircraft assignment via
    // create_aircraft_atomic — it must surface here.
    const tails = (me.aircraft as { tail_number: string; aircraft_role: string }[]).map(a => a.tail_number);
    expect(tails).toContain(seededUser.tailNumber);
    const myAircraft = me.aircraft.find((a: any) => a.tail_number === seededUser.tailNumber);
    expect(myAircraft.aircraft_role).toBe('admin');
  });

  test('non-admin pilot rejected with 403', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/admin/users');
    expect(res.status).toBe(403);
  });
});

crossTest.describe('admin/users PUT — promote / demote + self-demotion guard', () => {
  crossTest('admin can promote another user from pilot to admin', async ({ userA, userB, baseURL }) => {
    await promoteToAdmin(userA.userId);
    const tokenA = await getAccessToken(userA.email, userA.password);

    const res = await fetchAs(tokenA, baseURL!, '/api/admin/users', {
      method: 'PUT',
      body: JSON.stringify({ targetUserId: userB.userId, newRole: 'admin' }),
    });
    expect(res.status).toBe(200);

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_user_roles')
      .select('role')
      .eq('user_id', userB.userId)
      .single();
    expect(row?.role).toBe('admin');
  });

  crossTest('admin cannot demote their own account', async ({ userA, baseURL }) => {
    await promoteToAdmin(userA.userId);
    const tokenA = await getAccessToken(userA.email, userA.password);

    const res = await fetchAs(tokenA, baseURL!, '/api/admin/users', {
      method: 'PUT',
      body: JSON.stringify({ targetUserId: userA.userId, newRole: 'pilot' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/your own account/i);

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_user_roles')
      .select('role')
      .eq('user_id', userA.userId)
      .single();
    expect(row?.role).toBe('admin');
  });

  crossTest('PUT rejects role outside the admin/pilot allowlist', async ({ userA, userB, baseURL }) => {
    await promoteToAdmin(userA.userId);
    const tokenA = await getAccessToken(userA.email, userA.password);

    const res = await fetchAs(tokenA, baseURL!, '/api/admin/users', {
      method: 'PUT',
      body: JSON.stringify({ targetUserId: userB.userId, newRole: 'superadmin' }),
    });
    expect(res.status).toBe(400);
  });

  crossTest('non-admin pilot cannot promote anyone (403)', async ({ userA, userB, baseURL }) => {
    // Both stay pilots.
    const tokenA = await getAccessToken(userA.email, userA.password);
    const res = await fetchAs(tokenA, baseURL!, '/api/admin/users', {
      method: 'PUT',
      body: JSON.stringify({ targetUserId: userB.userId, newRole: 'admin' }),
    });
    expect(res.status).toBe(403);
  });
});

import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * /api/invite — "Aircraft Administrator" role option.
 *
 * Locks the contract that selecting `aircraft_admin` in the invite
 * dropdown produces:
 *   - aft_user_roles.role             = 'pilot'   (no global admin)
 *   - aft_user_aircraft_access.aircraft_role = 'admin' on each tail
 *
 * The 400 branches (validation) don't call Supabase Auth and so
 * don't consume the project-wide invite quota; the happy path does
 * and skips on 429 the same way pilot-invite.spec.ts does.
 */

test.describe('/api/invite — aircraft_admin role', () => {
  test('rejects aircraft_admin with no aircraft selected', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    await admin.from('aft_user_roles').update({ role: 'admin' }).eq('user_id', seededUser.userId);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/invite', {
      method: 'POST',
      body: JSON.stringify({
        email: `e2e-aa-novalid-${randomUUID()}@skyward-test.local`,
        role: 'aircraft_admin',
        aircraftIds: [],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least one aircraft/i);
  });

  test('rejects unknown role string', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    await admin.from('aft_user_roles').update({ role: 'admin' }).eq('user_id', seededUser.userId);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/invite', {
      method: 'POST',
      body: JSON.stringify({
        email: `e2e-bad-role-${randomUUID()}@skyward-test.local`,
        role: 'super_user',
        aircraftIds: [seededUser.aircraftId],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/admin.*aircraft_admin.*pilot/i);
  });

  test('aircraft_admin lands as global pilot + admin on each assigned aircraft', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    await admin.from('aft_user_roles').update({ role: 'admin' }).eq('user_id', seededUser.userId);
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const inviteEmail = `e2e-aa-${randomUUID()}@skyward-test.local`;

    const res = await fetchAs(token, baseURL!, '/api/invite', {
      method: 'POST',
      body: JSON.stringify({
        email: inviteEmail,
        role: 'aircraft_admin',
        aircraftIds: [seededUser.aircraftId],
      }),
    });

    if (res.status === 429) {
      test.skip(true, 'Supabase Auth invite rate limit hit; rerun in a few minutes.');
    }
    if (res.status !== 200) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`/api/invite returned ${res.status}: ${errBody}`);
    }

    // Find the user we just minted.
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const newUser = list?.users?.find((u: any) => u.email === inviteEmail);
    expect(newUser, 'invited user must exist in auth.users').toBeTruthy();

    // Global role: pilot, NOT admin. This is the whole point — an
    // aircraft admin should not get global authority.
    const { data: role } = await admin
      .from('aft_user_roles')
      .select('role, email')
      .eq('user_id', newUser!.id)
      .single();
    expect(role?.role).toBe('pilot');
    expect(role?.email).toBe(inviteEmail);

    // Per-aircraft role: admin on the assigned tail.
    const { data: access } = await admin
      .from('aft_user_aircraft_access')
      .select('aircraft_id, aircraft_role')
      .eq('user_id', newUser!.id)
      .eq('aircraft_id', seededUser.aircraftId)
      .single();
    expect(access?.aircraft_role).toBe('admin');

    await admin.auth.admin.deleteUser(newUser!.id).then(undefined, () => {});
  });
});

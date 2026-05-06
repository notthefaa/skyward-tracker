import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * Account self-delete + sole-admin guard.
 *
 * The /api/users DELETE route blocks deletion of a user who is the
 * only admin on at least one aircraft, to prevent stranding the
 * aircraft in a no-admin state. Migration 055 dropped the duplicate
 * SET-NULL FK on aft_aircraft.created_by so user-delete now strictly
 * cascades — the impact-preview that the UI shows before confirm
 * matches actual deletion semantics.
 *
 * /api/users DELETE requires global admin role. seededUser is global
 * 'pilot' (aircraft admin only), so we use the global-admin path
 * cautiously: promote a fresh test user to global admin, have them
 * try to delete another user, and verify the guard fires.
 */
test.describe('account-delete — sole-admin guard', () => {
  test('global admin cannot delete a user who is sole admin on an aircraft', async ({ baseURL }) => {
    const admin = adminClient();

    // 1. Set up a global admin caller.
    const callerEmail = `e2e-globadmin-${randomUUID()}@skyward-test.local`;
    const callerPw = `pw-${randomUUID().slice(0, 12)}`;
    const { data: callerU } = await admin.auth.admin.createUser({
      email: callerEmail, password: callerPw, email_confirm: true,
    });
    const callerId = callerU!.user!.id;
    await admin.from('aft_user_roles').upsert(
      { user_id: callerId, role: 'admin', email: callerEmail, completed_onboarding: true },
      { onConflict: 'user_id' },
    );

    // 2. Set up the would-be victim: sole admin on an aircraft.
    const victimEmail = `e2e-victim-${randomUUID()}@skyward-test.local`;
    const victimPw = `pw-${randomUUID().slice(0, 12)}`;
    const { data: victimU } = await admin.auth.admin.createUser({
      email: victimEmail, password: victimPw, email_confirm: true,
    });
    const victimId = victimU!.user!.id;
    const tail = `N${randomUUID().slice(0, 5).toUpperCase()}`;
    const { data: ac, error: rpcErr } = await admin.rpc('create_aircraft_atomic', {
      p_user_id: victimId,
      p_payload: {
        tail_number: tail,
        aircraft_type: 'Cessna 172S',
        engine_type: 'Piston',
      },
    });
    if (rpcErr) throw new Error(`create_aircraft_atomic: ${rpcErr.message}`);
    const acId = (ac as { id: string }).id;

    // 3. Caller signs in + tries to delete the victim.
    const token = await getAccessToken(callerEmail, callerPw);
    const res = await fetchAs(token, baseURL!, '/api/users', {
      method: 'DELETE',
      body: JSON.stringify({ userId: victimId }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/only admin/i);
    expect(body.error).toContain(tail); // helpful: tells caller WHICH aircraft is blocking

    // 4. Victim should still exist + still be admin on the aircraft.
    const { data: stillThere } = await admin.auth.admin.getUserById(victimId);
    expect(stillThere?.user?.id).toBe(victimId);
    const { data: stillAdmin } = await admin
      .from('aft_user_aircraft_access')
      .select('aircraft_role')
      .eq('user_id', victimId)
      .eq('aircraft_id', acId)
      .single();
    expect(stillAdmin?.aircraft_role).toBe('admin');

    // Cleanup.
    await admin.from('aft_aircraft').delete().eq('id', acId);
    await admin.auth.admin.deleteUser(victimId).then(undefined, () => {});
    await admin.auth.admin.deleteUser(callerId).then(undefined, () => {});
  });

  test('global admin cannot delete themselves', async ({ baseURL }) => {
    const admin = adminClient();
    const callerEmail = `e2e-self-${randomUUID()}@skyward-test.local`;
    const callerPw = `pw-${randomUUID().slice(0, 12)}`;
    const { data: callerU } = await admin.auth.admin.createUser({
      email: callerEmail, password: callerPw, email_confirm: true,
    });
    const callerId = callerU!.user!.id;
    await admin.from('aft_user_roles').upsert(
      { user_id: callerId, role: 'admin', email: callerEmail, completed_onboarding: true },
      { onConflict: 'user_id' },
    );

    const token = await getAccessToken(callerEmail, callerPw);
    const res = await fetchAs(token, baseURL!, '/api/users', {
      method: 'DELETE',
      body: JSON.stringify({ userId: callerId }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/cannot delete/i);

    // Caller should still be there.
    const { data: stillThere } = await admin.auth.admin.getUserById(callerId);
    expect(stillThere?.user?.id).toBe(callerId);

    await admin.auth.admin.deleteUser(callerId).then(undefined, () => {});
  });

  test('non-admin caller is rejected with 403', async ({ seededUser, baseURL }) => {
    // seededUser is global 'pilot', not 'admin' — should not be able to
    // call /api/users DELETE at all.
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/users', {
      method: 'DELETE',
      body: JSON.stringify({ userId: seededUser.userId }),
    });

    expect(res.status).toBe(403);
  });

  test('global admin CAN delete a user with no sole-admin aircraft', async ({ baseURL }) => {
    const admin = adminClient();

    // Caller: global admin.
    const callerEmail = `e2e-cleanup-caller-${randomUUID()}@skyward-test.local`;
    const callerPw = `pw-${randomUUID().slice(0, 12)}`;
    const { data: callerU } = await admin.auth.admin.createUser({
      email: callerEmail, password: callerPw, email_confirm: true,
    });
    const callerId = callerU!.user!.id;
    await admin.from('aft_user_roles').upsert(
      { user_id: callerId, role: 'admin', email: callerEmail, completed_onboarding: true },
      { onConflict: 'user_id' },
    );

    // Victim: pilot (no aircraft admin role anywhere).
    const victimEmail = `e2e-cleanup-victim-${randomUUID()}@skyward-test.local`;
    const victimPw = `pw-${randomUUID().slice(0, 12)}`;
    const { data: victimU } = await admin.auth.admin.createUser({
      email: victimEmail, password: victimPw, email_confirm: true,
    });
    const victimId = victimU!.user!.id;
    await admin.from('aft_user_roles').upsert(
      { user_id: victimId, role: 'pilot', email: victimEmail, completed_onboarding: true },
      { onConflict: 'user_id' },
    );

    const token = await getAccessToken(callerEmail, callerPw);
    const res = await fetchAs(token, baseURL!, '/api/users', {
      method: 'DELETE',
      body: JSON.stringify({ userId: victimId }),
    });

    expect(res.status).toBe(200);

    // Victim should be gone (auth.users + cascaded role).
    const { data: stillThere } = await admin.auth.admin.getUserById(victimId);
    expect(stillThere?.user).toBeNull();

    await admin.auth.admin.deleteUser(callerId).then(undefined, () => {});
  });
});

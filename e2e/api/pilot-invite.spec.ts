import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * /api/pilot-invite — verifies the launch-blocker fix from
 * 2026-05-06: invitee must land with completed_onboarding=true so
 * they don't get pushed into the welcome modal asking them to
 * create an aircraft they were just invited to.
 *
 * The seededUser fixture is aircraft-admin on their own aircraft,
 * which is enough auth to invite a pilot to that same aircraft.
 *
 * No real email is sent — Supabase's inviteUserByEmail mints the
 * auth.users row + signs an invite token, but the invite email
 * goes through Supabase Auth's SMTP. In local dev with no SMTP
 * configured, no email leaves the system; the user row + role
 * row + access row land regardless. We assert the DB state.
 */
test.describe('pilot-invite — onboarding flag', () => {
  test('invited user lands with completed_onboarding=true (skips welcome modal)', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const inviteEmail = `e2e-invite-${randomUUID()}@skyward-test.local`;

    const res = await fetchAs(token, baseURL!, '/api/pilot-invite', {
      method: 'POST',
      body: JSON.stringify({
        email: inviteEmail,
        aircraftId: seededUser.aircraftId,
        aircraftRole: 'pilot',
      }),
    });

    // Supabase Auth caps invite throughput per project; if a previous
    // test run exhausted the budget we see 429. Skip rather than fail —
    // the rate limit isn't a code regression.
    if (res.status === 429) {
      test.skip(true, 'Supabase Auth invite rate limit hit; rerun in a few minutes.');
    }
    if (res.status !== 200) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`pilot-invite returned ${res.status}: ${errBody}`);
    }
    const body = await res.json();
    expect(body.success).toBe(true);

    // Look up the invited user via admin API to get their userId.
    const admin = adminClient();
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const newUser = list?.users?.find((u: any) => u.email === inviteEmail);
    expect(newUser, 'invited user must exist in auth.users').toBeTruthy();

    // Role row: pilot + completed_onboarding=true (the actual fix).
    const { data: role } = await admin
      .from('aft_user_roles')
      .select('role, email, completed_onboarding')
      .eq('user_id', newUser!.id)
      .single();
    expect(role).toBeTruthy();
    expect(role!.role).toBe('pilot');
    expect(role!.email).toBe(inviteEmail);
    expect(role!.completed_onboarding).toBe(true);

    // Access row: pilot on this aircraft.
    const { data: access } = await admin
      .from('aft_user_aircraft_access')
      .select('aircraft_id, aircraft_role')
      .eq('user_id', newUser!.id)
      .eq('aircraft_id', seededUser.aircraftId)
      .single();
    expect(access).toBeTruthy();
    expect(access!.aircraft_role).toBe('pilot');

    // Cleanup the invited user (cascade handles role + access via FKs).
    await admin.auth.admin.deleteUser(newUser!.id).then(undefined, () => {});
  });

  test('inviting an already-existing user upserts access without re-creating auth.user', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const targetEmail = `e2e-existing-${randomUUID()}@skyward-test.local`;

    // Pre-seed an auth user. They have no role row yet (the trigger
    // path varies by project) — set one explicitly.
    const admin = adminClient();
    const { data: u, error: createErr } = await admin.auth.admin.createUser({
      email: targetEmail,
      password: `pw-${randomUUID().slice(0, 12)}`,
      email_confirm: true,
    });
    if (createErr) throw new Error(`pre-seed createUser: ${createErr.message}`);
    const targetUserId = u!.user!.id;

    // Pre-existing role row with completed_onboarding already true
    // (a returning pilot).
    await admin.from('aft_user_roles').upsert({
      user_id: targetUserId,
      role: 'pilot',
      email: targetEmail,
      completed_onboarding: true,
    }, { onConflict: 'user_id' });

    const res = await fetchAs(token, baseURL!, '/api/pilot-invite', {
      method: 'POST',
      body: JSON.stringify({
        email: targetEmail,
        aircraftId: seededUser.aircraftId,
        aircraftRole: 'pilot',
      }),
    });

    expect(res.status).toBe(200);

    // Existing user should now have access to the new aircraft.
    const { data: access } = await admin
      .from('aft_user_aircraft_access')
      .select('aircraft_id, aircraft_role')
      .eq('user_id', targetUserId)
      .eq('aircraft_id', seededUser.aircraftId)
      .single();
    expect(access?.aircraft_role).toBe('pilot');

    // Cleanup.
    await admin.auth.admin.deleteUser(targetUserId).then(undefined, () => {});
  });

  test('rejects invite from a non-admin caller', async ({ seededUser, baseURL }) => {
    // Create a second aircraft owned by someone else; seededUser has
    // no admin rights there.
    const admin = adminClient();
    const otherEmail = `e2e-other-${randomUUID()}@skyward-test.local`;
    const otherPassword = `pw-${randomUUID().slice(0, 12)}`;
    const { data: u } = await admin.auth.admin.createUser({
      email: otherEmail, password: otherPassword, email_confirm: true,
    });
    const otherUserId = u!.user!.id;

    const { data: otherAircraft, error: rpcErr } = await admin.rpc('create_aircraft_atomic', {
      p_user_id: otherUserId,
      p_payload: {
        tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`,
        aircraft_type: 'Cessna 172S',
        engine_type: 'Piston',
      },
    });
    if (rpcErr) throw new Error(`other aircraft: ${rpcErr.message}`);

    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/pilot-invite', {
      method: 'POST',
      body: JSON.stringify({
        email: `e2e-blocked-${randomUUID()}@skyward-test.local`,
        aircraftId: (otherAircraft as { id: string }).id,
        aircraftRole: 'pilot',
      }),
    });

    expect(res.status).toBe(403);

    // Cleanup.
    await admin.from('aft_aircraft').delete().eq('id', (otherAircraft as { id: string }).id);
    await admin.auth.admin.deleteUser(otherUserId).then(undefined, () => {});
  });
});

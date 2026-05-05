import { test as base, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../helpers/admin';

export type SeededUser = {
  email: string;
  password: string;
  userId: string;
  aircraftId: string;
  tailNumber: string;
};

type Fixtures = {
  /**
   * Test user that's already past the onboarding flow:
   *   - email confirmed
   *   - one Piston aircraft, owned (aircraft_role='admin')
   *   - completed_onboarding=true, tour_completed=true
   *   - role='pilot', faa_ratings=['PPL','IFR']
   *
   * First sign-in lands directly on the main app (Times tab), not
   * the welcome modal. Use this for any tab-level spec — it's
   * ~150ms of admin RPC instead of clicking through the form.
   *
   * Cleanup deletes the user; FK CASCADEs handle access/roles/preferences.
   * Aircraft has no auth.users CASCADE, so we explicitly delete it first.
   */
  seededUser: SeededUser;
};

export const test = base.extend<Fixtures>({
  seededUser: async ({}, use) => {
    const email = `e2e-seeded-${randomUUID()}@skyward-test.local`;
    const password = `pw-${randomUUID().slice(0, 12)}`;
    const tailNumber = `N${randomUUID().slice(0, 5).toUpperCase()}`;
    const admin = adminClient();

    const { data: u, error: userErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (userErr || !u.user) {
      throw new Error(`createUser failed: ${userErr?.message ?? 'no user'}`);
    }
    const userId = u.user.id;

    // Use the same RPC the app uses, so any breakage in the create
    // path surfaces in fixture setup (instead of being papered over
    // with raw inserts).
    const { data: aircraft, error: rpcErr } = await admin.rpc('create_aircraft_atomic', {
      p_user_id: userId,
      p_payload: {
        tail_number: tailNumber,
        aircraft_type: 'Cessna 172S',
        engine_type: 'Piston',
        total_airframe_time: 1000,
        total_engine_time: 1000,
        setup_hobbs: 1000,
        setup_tach: 1000,
      },
    });
    if (rpcErr || !aircraft) {
      await admin.auth.admin.deleteUser(userId).then(undefined, () => {});
      throw new Error(`create_aircraft_atomic failed: ${rpcErr?.message ?? 'no aircraft'}`);
    }
    const aircraftId = (aircraft as { id: string }).id;

    // Mark tour completed so first sign-in skips spotlight.
    const { error: roleErr } = await admin
      .from('aft_user_roles')
      .update({ tour_completed: true, faa_ratings: ['PPL', 'IFR'] })
      .eq('user_id', userId);
    if (roleErr) {
      throw new Error(`aft_user_roles update: ${roleErr.message}`);
    }

    await use({ email, password, userId, aircraftId, tailNumber });

    // Cleanup. supabase-js builders are thenables, not real Promises,
    // so we use await + best-effort try/catch instead of .catch().
    try {
      await admin.from('aft_aircraft').delete().eq('id', aircraftId);
    } catch { /* best-effort */ }
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch { /* best-effort */ }
  },
});

export { expect };

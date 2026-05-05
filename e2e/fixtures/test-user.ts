import { test as base, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../helpers/admin';

export type TestUser = {
  email: string;
  password: string;
  userId: string;
};

type Fixtures = {
  /**
   * Fresh test user, created via service-role admin API with email
   * already confirmed (so no /update-password redirect, no real email
   * sent). Cleaned up after the test.
   *
   * The user has no `aft_user_roles` row, so first sign-in lands on the
   * onboarding welcome modal.
   */
  testUser: TestUser;
};

export const test = base.extend<Fixtures>({
  testUser: async ({}, use) => {
    const email = `e2e-${randomUUID()}@skyward-test.local`;
    const password = `pw-${randomUUID().slice(0, 12)}`;

    const admin = adminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`createUser failed: ${error?.message ?? 'no user returned'}`);
    }

    await use({ email, password, userId: data.user.id });

    // Cleanup — best-effort.
    // Aircraft don't FK to auth.users (no cascade), so hard-delete any
    // rows this user created during the test before nuking the user.
    // The supabase-js builder is a thenable, not a real Promise, so
    // chain .then(undefined, …) instead of .catch(…).
    try {
      await admin.from('aft_aircraft').delete().eq('created_by', data.user.id);
    } catch { /* best-effort */ }
    // Auth user deletion CASCADEs to aft_user_preferences, aft_user_roles,
    // aft_user_aircraft_access via their auth.users FKs.
    try {
      await admin.auth.admin.deleteUser(data.user.id);
    } catch { /* best-effort */ }
  },
});

export { expect };

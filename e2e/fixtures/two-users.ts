import { test as base, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../helpers/admin';
import type { SeededUser } from './seeded-user';

/**
 * Cross-user fixture for RLS / scope-guard tests. Two unrelated
 * seeded users, each admin on their own aircraft. Lets a test
 * verify that user A's API calls can't reach user B's records.
 */
type Fixtures = { userA: SeededUser; userB: SeededUser };

async function seed(): Promise<SeededUser> {
  const email = `e2e-cross-${randomUUID()}@skyward-test.local`;
  const password = `pw-${randomUUID().slice(0, 12)}`;
  const tailNumber = `N${randomUUID().slice(0, 5).toUpperCase()}`;
  const admin = adminClient();

  const { data: u, error: e1 } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (e1 || !u.user) throw new Error(`createUser: ${e1?.message}`);

  const { data: aircraft, error: e2 } = await admin.rpc('create_aircraft_atomic', {
    p_user_id: u.user.id,
    p_payload: {
      tail_number: tailNumber,
      aircraft_type: 'Cessna 172S',
      engine_type: 'Piston',
      total_airframe_time: 500,
      total_engine_time: 500,
    },
  });
  if (e2 || !aircraft) throw new Error(`create_aircraft_atomic: ${e2?.message}`);

  await admin
    .from('aft_user_roles')
    .update({ tour_completed: true })
    .eq('user_id', u.user.id);

  return {
    email, password,
    userId: u.user.id,
    aircraftId: (aircraft as { id: string }).id,
    tailNumber,
  };
}

async function teardown(user: SeededUser): Promise<void> {
  const admin = adminClient();
  try { await admin.from('aft_aircraft').delete().eq('id', user.aircraftId); } catch {}
  try { await admin.auth.admin.deleteUser(user.userId); } catch {}
}

export const test = base.extend<Fixtures>({
  userA: async ({}, use) => { const u = await seed(); await use(u); await teardown(u); },
  userB: async ({}, use) => { const u = await seed(); await use(u); await teardown(u); },
});

export { expect };

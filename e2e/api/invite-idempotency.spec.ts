import { test, expect } from '../fixtures/seeded-user';
import { test as crossTest } from '../fixtures/two-users';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * Idempotency wiring on the admin/flight-logs and pilot-invite POSTs.
 *
 * The invite path is the highest-impact: a double-tap on Invite Pilot
 * fired two Supabase Auth invites — the second hits the project-wide
 * 429 throttle and surfaces as a confusing "rate limit" toast even
 * though the first invite landed cleanly.
 *
 * /api/invite (global-admin path) is exercised via Supabase Auth too,
 * which has the same project-wide throttle. We test the existing-user
 * branch of pilot-invite (no Auth call) here so the spec doesn't burn
 * the daily invite quota.
 *
 * /api/admin/flight-logs is exercised end-to-end since the RPC has no
 * external side effects.
 */

test.describe('admin/flight-logs — idempotency', () => {
  test('replay returns cached logId; only one row in DB', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    await admin.from('aft_user_roles').update({ role: 'admin' }).eq('user_id', seededUser.userId);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const idemKey = randomUUID();
    const body = JSON.stringify({
      aircraftId: seededUser.aircraftId,
      logData: {
        aftt: 0.5,
        ftt: 0.5,
        engine_cycles: 1,
        landings: 1,
        initials: 'IDM',
        occurred_at: '2026-04-15T15:00:00Z',
      },
    });

    const r1 = await fetchAs(token, baseURL!, '/api/admin/flight-logs', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(r1.status).toBe(200);
    const j1 = await r1.json();
    expect(j1.logId).toBeTruthy();

    const r2 = await fetchAs(token, baseURL!, '/api/admin/flight-logs', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(r2.status).toBe(200);
    expect(r2.headers.get('x-idempotent-replay')).toBe('true');
    const j2 = await r2.json();
    expect(j2.logId).toBe(j1.logId);

    // Exactly one log row with the probe initials.
    const { data: logs } = await admin
      .from('aft_flight_logs')
      .select('id')
      .eq('aircraft_id', seededUser.aircraftId)
      .eq('initials', 'IDM');
    expect((logs || []).length).toBe(1);
  });
});

crossTest.describe('pilot-invite — idempotency (existing-user branch)', () => {
  crossTest('admin double-tap on existing user only updates access once', async ({ userA, userB, baseURL }) => {
    const admin = adminClient();
    // The two-users fixture doesn't backfill aft_user_roles.email,
    // and pilot-invite only takes the existing-user branch when the
    // email matches a row there. Set it now.
    await admin.from('aft_user_roles').update({ email: userB.email }).eq('user_id', userB.userId);

    // userB exists but has no access to userA's aircraft yet.
    const tokenA = await getAccessToken(userA.email, userA.password);
    const idemKey = randomUUID();
    const body = JSON.stringify({
      email: userB.email,
      aircraftId: userA.aircraftId,
      aircraftRole: 'pilot',
    });

    const r1 = await fetchAs(tokenA, baseURL!, '/api/pilot-invite', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(r1.status).toBe(200);

    const r2 = await fetchAs(tokenA, baseURL!, '/api/pilot-invite', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(r2.status).toBe(200);
    expect(r2.headers.get('x-idempotent-replay')).toBe('true');

    // Without idempotency, the second call would have hit the
    // "already has access" 400 branch — and the user would see two
    // different toast messages for the same click. With it, the
    // cached "User added" body replays.
    const j2 = await r2.json();
    expect(j2.success).toBe(true);
    expect(j2.message).toMatch(/User added|User role updated/i);

    // Exactly one access row.
    const { data: rows } = await admin
      .from('aft_user_aircraft_access')
      .select('user_id')
      .eq('user_id', userB.userId)
      .eq('aircraft_id', userA.aircraftId);
    expect((rows || []).length).toBe(1);
  });
});

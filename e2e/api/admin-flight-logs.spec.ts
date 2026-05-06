import { test, expect } from '@playwright/test';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * /api/admin/flight-logs POST — global-admin-only insert of a missing
 * flight log. Backdated middle inserts must NOT stomp current aircraft
 * totals (the route passes `aircraftUpdate: {}` and relies on
 * log_flight_atomic re-deriving from latest-by-occurred_at).
 *
 * Carry-forward backlog: this route lacks idempotency. A network blip
 * + retry can land a phantom duplicate. Filed as P0 in
 * project_qa_checklist; this spec captures current behavior so the
 * fix doesn't regress it.
 */
test.describe('admin/flight-logs — backdated insert', () => {
  let adminEmail: string;
  let adminPw: string;
  let adminId: string;
  let pilotEmail: string;
  let pilotPw: string;
  let pilotId: string;
  let aircraftId: string;

  test.beforeAll(async () => {
    const sb = adminClient();
    adminEmail = `e2e-globadmin-fl-${randomUUID()}@skyward-test.local`;
    adminPw = `pw-${randomUUID().slice(0, 12)}`;
    const { data: a } = await sb.auth.admin.createUser({
      email: adminEmail, password: adminPw, email_confirm: true,
    });
    adminId = a!.user!.id;
    await sb.from('aft_user_roles').upsert(
      { user_id: adminId, role: 'admin', email: adminEmail, completed_onboarding: true },
      { onConflict: 'user_id' },
    );

    pilotEmail = `e2e-pilot-fl-${randomUUID()}@skyward-test.local`;
    pilotPw = `pw-${randomUUID().slice(0, 12)}`;
    const { data: p } = await sb.auth.admin.createUser({
      email: pilotEmail, password: pilotPw, email_confirm: true,
    });
    pilotId = p!.user!.id;
    const { data: ac } = await sb.rpc('create_aircraft_atomic', {
      p_user_id: pilotId,
      p_payload: {
        tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`,
        aircraft_type: 'Cessna 172S',
        engine_type: 'Piston',
        total_airframe_time: 500,
        total_engine_time: 500,
        setup_hobbs: 500,
        setup_tach: 500,
      },
    });
    aircraftId = (ac as { id: string }).id;
  });

  test.afterAll(async () => {
    const sb = adminClient();
    await sb.from('aft_aircraft').delete().eq('id', aircraftId);
    await sb.auth.admin.deleteUser(adminId).then(undefined, () => {});
    await sb.auth.admin.deleteUser(pilotId).then(undefined, () => {});
  });

  test('non-admin (regular pilot) is rejected with 403', async ({ baseURL }) => {
    const token = await getAccessToken(pilotEmail, pilotPw);
    const res = await fetchAs(token, baseURL!, '/api/admin/flight-logs', {
      method: 'POST',
      body: JSON.stringify({
        aircraftId,
        logData: { tach: 510, hobbs: 510, landings: 1, engine_cycles: 0, initials: 'TST' },
      }),
    });
    expect(res.status).toBe(403);
  });

  test('global admin inserts a backdated middle log; aircraft totals stay on latest', async ({ baseURL }) => {
    const sb = adminClient();
    const adminToken = await getAccessToken(adminEmail, adminPw);
    const pilotToken = await getAccessToken(pilotEmail, pilotPw);

    // 1. Pilot logs the most-recent leg.
    const today = new Date().toISOString();
    const recent = await fetchAs(pilotToken, baseURL!, '/api/flight-logs', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId,
        logData: { tach: 600, hobbs: 600, landings: 1, engine_cycles: 0, initials: 'TST', occurred_at: today },
      }),
    });
    expect(recent.status).toBe(200);

    let { data: ac } = await sb.from('aft_aircraft').select('total_engine_time').eq('id', aircraftId).single();
    expect(Number(ac?.total_engine_time)).toBe(600);

    // 2. Admin backfills a forgotten older flight (between setup=500 and recent=600).
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const backfill = await fetchAs(adminToken, baseURL!, '/api/admin/flight-logs', {
      method: 'POST',
      body: JSON.stringify({
        aircraftId,
        logData: { tach: 555, hobbs: 555, landings: 1, engine_cycles: 0, initials: 'ADM', occurred_at: lastWeek },
      }),
    });
    expect(backfill.status).toBe(200);
    const { logId, isLatest } = await backfill.json();
    expect(logId).toBeTruthy();
    expect(isLatest).toBe(false);

    // 3. Aircraft totals MUST still reflect the latest leg (600), not the backfilled (555).
    ({ data: ac } = await sb.from('aft_aircraft').select('total_engine_time').eq('id', aircraftId).single());
    expect(Number(ac?.total_engine_time)).toBe(600);

    // 4. Backfilled log exists in the right occurred_at slot.
    const { data: rows } = await sb
      .from('aft_flight_logs')
      .select('id, tach, occurred_at')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('occurred_at');
    expect(rows?.length).toBe(2);
    expect(Number(rows?.[0].tach)).toBe(555); // older
    expect(Number(rows?.[1].tach)).toBe(600); // recent
  });

  test('rejects implausible 24hr+ delta', async ({ baseURL }) => {
    const adminToken = await getAccessToken(adminEmail, adminPw);
    const res = await fetchAs(adminToken, baseURL!, '/api/admin/flight-logs', {
      method: 'POST',
      body: JSON.stringify({
        aircraftId,
        // The prior-by-occurred_at log on this aircraft has tach in the
        // 555–600 range; a tach delta of >24 hr from any prior should
        // be rejected by log_flight_atomic's sanity guard.
        logData: { tach: 9999, hobbs: 9999, landings: 1, engine_cycles: 0, initials: 'BAD' },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/implausible|delta/i);
  });
});

import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * /api/flight-logs DELETE — soft-delete via delete_flight_log_atomic
 * RPC + aircraft totals re-derive from the latest remaining log.
 *
 * Existing happy + edit + cross-user specs live in flight-logs.spec.ts.
 * This file covers the DELETE path and out-of-order replay semantics
 * since both can silently produce incorrect totals if broken.
 */
test.describe('flight-logs API — delete + total re-derivation', () => {
  test('delete latest log → aircraft totals roll back to next-latest', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);

    // Two logs, ascending occurred_at + ascending tach.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const today = new Date().toISOString();

    const r1 = await fetchAs(token, baseURL!, '/api/flight-logs', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        logData: { tach: 1100, hobbs: 1100, landings: 1, engine_cycles: 0, initials: 'TST', occurred_at: yesterday },
      }),
    });
    expect(r1.status).toBe(200);
    const r2 = await fetchAs(token, baseURL!, '/api/flight-logs', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        logData: { tach: 1110, hobbs: 1110, landings: 1, engine_cycles: 0, initials: 'TST', occurred_at: today },
      }),
    });
    expect(r2.status).toBe(200);
    const { logId: logId2 } = await r2.json();

    const admin = adminClient();
    let { data: ac } = await admin
      .from('aft_aircraft')
      .select('total_engine_time, total_airframe_time')
      .eq('id', seededUser.aircraftId)
      .single();
    expect(Number(ac?.total_engine_time)).toBe(1110);

    // Delete the latest log → totals should drop back to log 1.
    const del = await fetchAs(token, baseURL!, '/api/flight-logs', {
      method: 'DELETE',
      body: JSON.stringify({ logId: logId2, aircraftId: seededUser.aircraftId }),
    });
    expect(del.status).toBe(200);

    ({ data: ac } = await admin
      .from('aft_aircraft')
      .select('total_engine_time, total_airframe_time')
      .eq('id', seededUser.aircraftId)
      .single());
    expect(Number(ac?.total_engine_time)).toBe(1100);

    // The deleted row should still exist (soft-delete) but be filtered.
    const { data: rows } = await admin
      .from('aft_flight_logs')
      .select('id, deleted_at')
      .eq('aircraft_id', seededUser.aircraftId)
      .order('occurred_at');
    expect(rows?.length).toBe(2);
    const deletedRow = rows?.find(r => r.id === logId2);
    expect(deletedRow?.deleted_at).not.toBeNull();
  });

  test('delete the only log → totals stay at deleted-log value (documented edge case)', async ({ seededUser, baseURL }) => {
    // KNOWN behavior of `delete_flight_log_atomic`: when no logs remain
    // the RPC's `coalesce(v_latest_*, total_*)` keeps the totals at
    // their pre-delete value (which is the deleted log's reading).
    // The setup_* baseline is NOT used as a fallback — once any log
    // has ever been written, totals are derived from "latest non-
    // deleted log" with the previous total as the only fallback.
    //
    // BACKLOG (filed in project_qa_checklist): for UX symmetry, a
    // delete-the-only-log path arguably should fall back to setup_*
    // — a user who creates a single log by mistake currently can't
    // get the aircraft back to its original-known state without
    // editing the totals manually. Tracking, not blocking.
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();

    const create = await fetchAs(token, baseURL!, '/api/flight-logs', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        logData: { tach: 1200, hobbs: 1200, landings: 1, engine_cycles: 0, initials: 'TST', occurred_at: new Date().toISOString() },
      }),
    });
    const { logId } = await create.json();

    const del = await fetchAs(token, baseURL!, '/api/flight-logs', {
      method: 'DELETE',
      body: JSON.stringify({ logId, aircraftId: seededUser.aircraftId }),
    });
    expect(del.status).toBe(200);

    const { data: ac } = await admin
      .from('aft_aircraft')
      .select('total_engine_time')
      .eq('id', seededUser.aircraftId)
      .single();
    expect(Number(ac?.total_engine_time)).toBe(1200);
  });

  test('out-of-order replay — late-arriving older log does not stomp newer totals', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();

    // Most-recent leg lands first (companion-app online).
    const today = new Date().toISOString();
    const r1 = await fetchAs(token, baseURL!, '/api/flight-logs', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        logData: { tach: 1300, hobbs: 1300, landings: 1, engine_cycles: 0, initials: 'TST', occurred_at: today },
      }),
    });
    expect(r1.status).toBe(200);

    let { data: ac } = await admin
      .from('aft_aircraft')
      .select('total_engine_time')
      .eq('id', seededUser.aircraftId)
      .single();
    expect(Number(ac?.total_engine_time)).toBe(1300);

    // Companion app then flushes an OLDER offline leg.
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const r2 = await fetchAs(token, baseURL!, '/api/flight-logs', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        logData: { tach: 1250, hobbs: 1250, landings: 1, engine_cycles: 0, initials: 'TST', occurred_at: lastWeek },
      }),
    });
    expect(r2.status).toBe(200);

    // Totals MUST stay at 1300 — log_flight_atomic derives from latest-by-
    // occurred_at, so the older leg shouldn't downshift the live totals.
    ({ data: ac } = await admin
      .from('aft_aircraft')
      .select('total_engine_time')
      .eq('id', seededUser.aircraftId)
      .single());
    expect(Number(ac?.total_engine_time)).toBe(1300);
  });

  test('non-admin caller cannot delete a log', async ({ seededUser, baseURL }) => {
    // Insert a log via the admin client (column names from
    // aft_flight_logs schema: initials, NOT pilot_initials; no date
    // column — occurred_at is the canonical timestamp).
    const admin = adminClient();
    const { data: log, error: insErr } = await admin
      .from('aft_flight_logs')
      .insert({
        aircraft_id: seededUser.aircraftId,
        user_id: seededUser.userId,
        occurred_at: new Date().toISOString(),
        initials: 'TST',
        landings: 1,
        engine_cycles: 0,
      })
      .select('id')
      .single();
    if (insErr) throw new Error(`seed flight log: ${insErr.message}`);

    // Make a separate non-admin user with access to this aircraft.
    const otherEmail = `e2e-pilot-${randomUUID()}@skyward-test.local`;
    const otherPw = `pw-${randomUUID().slice(0, 12)}`;
    const { data: otherU } = await admin.auth.admin.createUser({
      email: otherEmail, password: otherPw, email_confirm: true,
    });
    const otherUserId = otherU!.user!.id;
    await admin.from('aft_user_roles').upsert(
      { user_id: otherUserId, role: 'pilot', email: otherEmail, completed_onboarding: true },
      { onConflict: 'user_id' },
    );
    await admin.from('aft_user_aircraft_access').upsert(
      { user_id: otherUserId, aircraft_id: seededUser.aircraftId, aircraft_role: 'pilot' },
      { onConflict: 'user_id,aircraft_id' },
    );

    const token = await getAccessToken(otherEmail, otherPw);
    const res = await fetchAs(token, baseURL!, '/api/flight-logs', {
      method: 'DELETE',
      body: JSON.stringify({ logId: log!.id, aircraftId: seededUser.aircraftId }),
    });
    expect(res.status).toBe(403);

    // Log must still be present + not soft-deleted.
    const { data: logAfter } = await admin
      .from('aft_flight_logs')
      .select('deleted_at')
      .eq('id', log!.id)
      .single();
    expect(logAfter?.deleted_at).toBeNull();

    await admin.from('aft_flight_logs').delete().eq('id', log!.id);
    await admin.auth.admin.deleteUser(otherUserId).then(undefined, () => {});
  });
});

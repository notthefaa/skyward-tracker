import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';
import { getOilConsumptionStatus, hoursSinceLastOilAdd } from '../../src/lib/oilConsumption';

/**
 * Phase 2 — Oil consumption 2-event floor.
 *
 * The helper holds back red/orange warnings until at least 2 oil-add
 * events are on file. With one log, "hours since last add" is just an
 * elapsed timestamp — not a consumption rate. Locks in the wiring
 * across:
 *   - the supabase count query (`gt('oil_added', 0)` filter)
 *   - the helper's count gating (commit `0aa3210`)
 *   - the threshold logic still firing once count >= 2
 *
 * AI-free; uses /api/oil-logs as the write path + supabase reads that
 * mirror the Howard route + ChecksTab dial fetch.
 */

const TOTAL_HRS = 1000; // matches seededUser fixture's total_engine_time

async function postOilAdd(
  token: string,
  baseURL: string,
  aircraftId: string,
  engineHours: number,
  oilAdded: number | null,
) {
  return fetchAs(token, baseURL, '/api/oil-logs', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      aircraftId,
      logData: {
        oil_qty: 5,
        oil_added: oilAdded,
        engine_hours: engineHours,
        initials: 'TST',
        occurred_at: new Date(Date.now() - (TOTAL_HRS - engineHours) * 60 * 1000).toISOString(),
      },
    }),
  });
}

async function readOilState(aircraftId: string) {
  const admin = adminClient();
  const [lastAddRes, countRes] = await Promise.all([
    admin
      .from('aft_oil_logs')
      .select('engine_hours')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .gt('oil_added', 0)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('aft_oil_logs')
      .select('id', { count: 'exact', head: true })
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .gt('oil_added', 0),
  ]);
  return {
    lastAddHrs: (lastAddRes.data as any)?.engine_hours ?? null,
    addCount: countRes.count ?? 0,
  };
}

test.describe('oil consumption — 2-event floor', () => {
  test('count=0 → gray ("no additions logged")', async ({ seededUser }) => {
    const { lastAddHrs, addCount } = await readOilState(seededUser.aircraftId);
    expect(addCount).toBe(0);
    expect(lastAddHrs).toBeNull();

    const hrsSince = hoursSinceLastOilAdd(lastAddHrs, TOTAL_HRS);
    const status = getOilConsumptionStatus(hrsSince, 'Piston', addCount);
    expect(status.level).toBe('gray');
    expect(status.add_event_count).toBe(0);
    expect(status.howard_message).toMatch(/no oil additions/i);
  });

  test('count=1 suppresses red even when hrs would trip the threshold', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);

    // One add at 998 hrs → 2 hrs since add → would normally trip RED
    // for a piston (< 5 hrs band). But with only one event on file,
    // we don't have a baseline rate to call it that.
    const res = await postOilAdd(token, baseURL!, seededUser.aircraftId, 998, 1);
    expect(res.status).toBe(200);

    const { lastAddHrs, addCount } = await readOilState(seededUser.aircraftId);
    expect(addCount).toBe(1);
    expect(lastAddHrs).toBe(998);

    const hrsSince = hoursSinceLastOilAdd(lastAddHrs, TOTAL_HRS);
    expect(hrsSince).toBe(2);

    const status = getOilConsumptionStatus(hrsSince, 'Piston', addCount);
    expect(status.level).toBe('gray');
    expect(status.add_event_count).toBe(1);
    expect(status.ui_warning).toBeNull();
    expect(status.howard_message).toMatch(/only one oil add/i);
  });

  test('count=2 with short interval → red (threshold logic kicks in)', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);

    // Two adds. Latest at 998 → 2 hrs since add. With count >= 2, the
    // threshold logic runs and trips red.
    for (const eh of [990, 998]) {
      const res = await postOilAdd(token, baseURL!, seededUser.aircraftId, eh, 1);
      expect(res.status).toBe(200);
    }

    const { lastAddHrs, addCount } = await readOilState(seededUser.aircraftId);
    expect(addCount).toBe(2);
    expect(lastAddHrs).toBe(998);

    const hrsSince = hoursSinceLastOilAdd(lastAddHrs, TOTAL_HRS);
    const status = getOilConsumptionStatus(hrsSince, 'Piston', addCount);
    expect(status.level).toBe('red');
    expect(status.add_event_count).toBe(2);
    expect(status.ui_warning).toBe('Check Oil Consumption');
  });

  test('count=2 with healthy interval → green', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);

    // Two adds, latest at 985 → 15 hrs since add → green for piston (>= 10).
    for (const eh of [970, 985]) {
      const res = await postOilAdd(token, baseURL!, seededUser.aircraftId, eh, 1);
      expect(res.status).toBe(200);
    }

    const { lastAddHrs, addCount } = await readOilState(seededUser.aircraftId);
    expect(addCount).toBe(2);

    const hrsSince = hoursSinceLastOilAdd(lastAddHrs, TOTAL_HRS);
    expect(hrsSince).toBe(15);

    const status = getOilConsumptionStatus(hrsSince, 'Piston', addCount);
    expect(status.level).toBe('green');
    expect(status.ui_warning).toBeNull();
  });

  test('level-only logs (oil_added null) do not count toward floor', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);

    // Three pure level checks (no oil added). The query filter
    // `gt('oil_added', 0)` should exclude every one.
    for (const eh of [990, 995, 998]) {
      const res = await postOilAdd(token, baseURL!, seededUser.aircraftId, eh, null);
      expect(res.status).toBe(200);
    }

    const { addCount } = await readOilState(seededUser.aircraftId);
    expect(addCount).toBe(0);

    // Sanity: confirm the rows landed (just not as add events).
    const admin = adminClient();
    const { count: totalCount } = await admin
      .from('aft_oil_logs')
      .select('id', { count: 'exact', head: true })
      .eq('aircraft_id', seededUser.aircraftId)
      .is('deleted_at', null);
    expect(totalCount).toBe(3);

    const status = getOilConsumptionStatus(null, 'Piston', 0);
    expect(status.level).toBe('gray');
    expect(status.howard_message).toMatch(/no oil additions/i);
  });
});

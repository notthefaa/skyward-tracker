import { test, expect } from '../fixtures/seeded-user';
import { test as crossTest } from '../fixtures/two-users';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * /api/batch-submit — companion-app offline-queue flush.
 *
 * The route accepts up to 100 mixed-type submissions, processes each
 * as its own transaction, and returns per-item status in `results[]`.
 * HTTP status reflects only the *overall* request shape (auth, body,
 * batch-size limits) — per-item failures live in the result objects.
 *
 * Coverage:
 *   - Happy path: mixed-type batch lands; results indexed correctly
 *   - Partial failure: some items NO_AIRCRAFT_ACCESS / VALIDATION_ERROR
 *   - Per-item idempotency replay returns cached responses; no
 *     duplicate DB rows
 *   - Idempotency route-scoping: key reuse across types isolated
 *   - occurred_at sort: out-of-order client batch commits in time order
 *   - 400 surfaces: empty / >100 / non-array body
 *   - Cross-user 403 via NO_AIRCRAFT_ACCESS coded error
 */

const VALID_INITIALS = 'TP';

function flightLogPayload(occurredAt: string, hobbs: number, tach: number) {
  // seededUser is a Piston aircraft (engine_type='Piston'), so the
  // log_flight_atomic RPC tracks via hobbs+tach (not ftt+aftt).
  return { initials: VALID_INITIALS, hobbs, tach, landings: 1, occurred_at: occurredAt };
}
function oilLogPayload(qty: number) {
  return { oil_qty: qty, oil_added: 0, engine_hours: 1000, initials: VALID_INITIALS, notes: null };
}
function tireCheckPayload() {
  return { nose_psi: 50, left_main_psi: 60, right_main_psi: 60, initials: VALID_INITIALS, notes: null };
}
function vorCheckPayload() {
  return {
    check_type: 'VOT',
    station: 'KOAK VOT',
    bearing_error: 1,
    initials: VALID_INITIALS,
  };
}
function squawkPayload(description: string) {
  return { description, affects_airworthiness: false, reporter_initials: VALID_INITIALS };
}

test.describe('batch-submit — happy path + indexing', () => {
  test('mixed-type batch lands; results sorted back to original index order', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const submissions = [
      // Index 0 — flight-log (gets sorted later because occurred_at is recent)
      { type: 'flight-log', aircraftId: seededUser.aircraftId, idempotencyKey: randomUUID(),
        payload: flightLogPayload(new Date().toISOString(), 1010, 1010) },
      // Index 1 — oil log
      { type: 'oil', aircraftId: seededUser.aircraftId, idempotencyKey: randomUUID(),
        payload: oilLogPayload(7) },
      // Index 2 — tire check
      { type: 'tire', aircraftId: seededUser.aircraftId, idempotencyKey: randomUUID(),
        payload: tireCheckPayload() },
      // Index 3 — VOR check
      { type: 'vor', aircraftId: seededUser.aircraftId, idempotencyKey: randomUUID(),
        payload: vorCheckPayload() },
      // Index 4 — squawk
      { type: 'squawk', aircraftId: seededUser.aircraftId, idempotencyKey: randomUUID(),
        payload: squawkPayload('Batch happy-path probe squawk') },
    ];

    const res = await fetchAs(token, baseURL!, '/api/batch-submit', {
      method: 'POST',
      body: JSON.stringify({ submissions }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data?.results)).toBe(true);
    expect(body.data.results.length).toBe(5);

    // results sorted by original index (0..4) regardless of internal
    // occurred_at sort.
    for (let i = 0; i < 5; i++) {
      expect(body.data.results[i].index).toBe(i);
      expect(body.data.results[i].ok).toBe(true);
      expect(body.data.results[i].id).toBeTruthy();
    }
    expect(body.data.results[0].type).toBe('flight-log');
    expect(body.data.results[1].type).toBe('oil');
    expect(body.data.results[2].type).toBe('tire');
    expect(body.data.results[3].type).toBe('vor');
    expect(body.data.results[4].type).toBe('squawk');

    // DB sanity: each row references seededUser.aircraftId.
    for (const r of body.data.results) {
      const tableMap: Record<string, string> = {
        'flight-log': 'aft_flight_logs',
        'oil': 'aft_oil_logs',
        'tire': 'aft_tire_checks',
        'vor': 'aft_vor_checks',
        'squawk': 'aft_squawks',
      };
      const table = tableMap[r.type];
      const { data } = await admin.from(table).select('aircraft_id').eq('id', r.id).single();
      expect(data?.aircraft_id).toBe(seededUser.aircraftId);
    }
  });
});

test.describe('batch-submit — partial failure', () => {
  test('mix of valid + invalid items: per-item results capture each outcome', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const fakeAircraftId = randomUUID();

    const submissions = [
      // Index 0 — valid oil log (should succeed)
      { type: 'oil', aircraftId: seededUser.aircraftId, idempotencyKey: randomUUID(),
        payload: oilLogPayload(8) },
      // Index 1 — missing aircraftId (AIRCRAFT_ID_REQUIRED)
      { type: 'tire', aircraftId: '', payload: tireCheckPayload() },
      // Index 2 — unknown type (VALIDATION_ERROR)
      { type: 'made-up-type', aircraftId: seededUser.aircraftId, payload: {} },
      // Index 3 — foreign aircraft (NO_AIRCRAFT_ACCESS)
      { type: 'oil', aircraftId: fakeAircraftId, payload: oilLogPayload(9) },
      // Index 4 — invalid payload (VALIDATION_ERROR via validate*)
      { type: 'tire', aircraftId: seededUser.aircraftId,
        payload: { /* missing initials */ nose_psi: 50, left_main_psi: 60, right_main_psi: 60, notes: null } },
    ];

    const res = await fetchAs(token, baseURL!, '/api/batch-submit', {
      method: 'POST',
      body: JSON.stringify({ submissions }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results.length).toBe(5);

    expect(body.data.results[0].ok).toBe(true);
    expect(body.data.results[0].id).toBeTruthy();

    expect(body.data.results[1].ok).toBe(false);
    expect(body.data.results[1].code).toBe('AIRCRAFT_ID_REQUIRED');

    expect(body.data.results[2].ok).toBe(false);
    expect(body.data.results[2].code).toBe('VALIDATION_ERROR');

    expect(body.data.results[3].ok).toBe(false);
    expect(body.data.results[3].code).toBe('NO_AIRCRAFT_ACCESS');

    expect(body.data.results[4].ok).toBe(false);
    expect(body.data.results[4].code).toBe('VALIDATION_ERROR');
  });
});

test.describe('batch-submit — idempotency', () => {
  test('replay returns cached responses; no duplicate DB rows', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const oilKey = randomUUID();
    const squawkKey = randomUUID();

    const submissions = [
      { type: 'oil', aircraftId: seededUser.aircraftId, idempotencyKey: oilKey,
        payload: { ...oilLogPayload(7), notes: 'Batch idem probe — single instance' } },
      { type: 'squawk', aircraftId: seededUser.aircraftId, idempotencyKey: squawkKey,
        payload: squawkPayload('Batch idem probe squawk — single instance') },
    ];

    const res1 = await fetchAs(token, baseURL!, '/api/batch-submit', {
      method: 'POST',
      body: JSON.stringify({ submissions }),
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.data.results.every((r: any) => r.ok)).toBe(true);
    const oilId1 = body1.data.results[0].id;

    // Second call with the SAME idempotency keys.
    const res2 = await fetchAs(token, baseURL!, '/api/batch-submit', {
      method: 'POST',
      body: JSON.stringify({ submissions }),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.data.results.every((r: any) => r.ok)).toBe(true);
    expect(body2.data.results[0].id).toBe(oilId1);

    // DB: exactly ONE oil log + ONE squawk for these probe strings.
    const { data: oilRows } = await admin
      .from('aft_oil_logs')
      .select('id')
      .eq('aircraft_id', seededUser.aircraftId)
      .eq('notes', 'Batch idem probe — single instance');
    expect((oilRows || []).length).toBe(1);

    const { data: sqRows } = await admin
      .from('aft_squawks')
      .select('id')
      .eq('aircraft_id', seededUser.aircraftId)
      .eq('description', 'Batch idem probe squawk — single instance');
    expect((sqRows || []).length).toBe(1);
  });

  test('same key reused across types is route-scoped (no cross-pollution)', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const sharedKey = randomUUID();

    // Batch 1: key K used for type=oil.
    const r1 = await fetchAs(token, baseURL!, '/api/batch-submit', {
      method: 'POST',
      body: JSON.stringify({ submissions: [
        { type: 'oil', aircraftId: seededUser.aircraftId, idempotencyKey: sharedKey,
          payload: { ...oilLogPayload(8), notes: 'Cross-route oil probe' } },
      ]}),
    });
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.data.results[0].ok).toBe(true);
    const oilId = b1.data.results[0].id;

    // Batch 2: key K used for type=tire — must NOT replay the oil cache.
    const r2 = await fetchAs(token, baseURL!, '/api/batch-submit', {
      method: 'POST',
      body: JSON.stringify({ submissions: [
        { type: 'tire', aircraftId: seededUser.aircraftId, idempotencyKey: sharedKey,
          payload: { ...tireCheckPayload(), notes: 'Cross-route tire probe' } },
      ]}),
    });
    expect(r2.status).toBe(200);
    const b2 = await r2.json();
    expect(b2.data.results[0].ok).toBe(true);
    expect(b2.data.results[0].type).toBe('tire');
    expect(b2.data.results[0].id).not.toBe(oilId);

    // DB: both rows landed (proving the second call wasn't a cache hit).
    const { data: tireRows } = await admin
      .from('aft_tire_checks')
      .select('id')
      .eq('id', b2.data.results[0].id);
    expect((tireRows || []).length).toBe(1);

    const { data: oilRows } = await admin
      .from('aft_oil_logs')
      .select('id')
      .eq('id', oilId);
    expect((oilRows || []).length).toBe(1);
  });
});

test.describe('batch-submit — input validation', () => {
  test('empty body / no submissions → 400', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/batch-submit', {
      method: 'POST',
      body: JSON.stringify({ submissions: [] }),
    });
    expect(res.status).toBe(400);
  });

  test('non-array body → 400', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/batch-submit', {
      method: 'POST',
      body: JSON.stringify({ submissions: 'not-an-array' }),
    });
    expect(res.status).toBe(400);
  });

  test('over 100 submissions → 400', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const submissions = Array.from({ length: 101 }, () => ({
      type: 'oil', aircraftId: seededUser.aircraftId, payload: oilLogPayload(7),
    }));
    const res = await fetchAs(token, baseURL!, '/api/batch-submit', {
      method: 'POST',
      body: JSON.stringify({ submissions }),
    });
    expect(res.status).toBe(400);
  });

  test('no Authorization header → 401', async ({ baseURL, request }) => {
    const res = await request.post(`${baseURL}/api/batch-submit`, {
      data: { submissions: [{ type: 'oil', aircraftId: 'x', payload: {} }] },
    });
    expect(res.status()).toBe(401);
  });
});

crossTest.describe('batch-submit — cross-user', () => {
  crossTest('user B submitting for user A aircraft → NO_AIRCRAFT_ACCESS in result', async ({ userA, userB, baseURL }) => {
    const tokenB = await getAccessToken(userB.email, userB.password);
    const submissions = [
      { type: 'oil', aircraftId: userA.aircraftId, payload: oilLogPayload(7) },
    ];
    const res = await fetchAs(tokenB, baseURL!, '/api/batch-submit', {
      method: 'POST',
      body: JSON.stringify({ submissions }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results[0].ok).toBe(false);
    expect(body.data.results[0].code).toBe('NO_AIRCRAFT_ACCESS');

    // DB: no oil log for user A from this attempt.
    const admin = adminClient();
    const { data } = await admin
      .from('aft_oil_logs')
      .select('id')
      .eq('aircraft_id', userA.aircraftId)
      .eq('user_id', userB.userId);
    expect((data || []).length).toBe(0);
  });
});

test.describe('batch-submit — occurred_at ordering', () => {
  test('out-of-order client batch commits in occurred_at sort order', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const token = await getAccessToken(seededUser.email, seededUser.password);

    // Three flight logs submitted in REVERSE chronological order.
    // The route MUST sort by occurred_at ASC before processing so the
    // 24-hour bound check on log N sees log N-1's stable history.
    const t0 = new Date(Date.now() - 6 * 3600_000); // 6h ago
    const t1 = new Date(Date.now() - 4 * 3600_000); // 4h ago
    const t2 = new Date(Date.now() - 2 * 3600_000); // 2h ago

    const submissions = [
      // Index 0 — most recent
      { type: 'flight-log', aircraftId: seededUser.aircraftId, idempotencyKey: randomUUID(),
        payload: flightLogPayload(t2.toISOString(), 1030, 1030) },
      // Index 1 — earliest
      { type: 'flight-log', aircraftId: seededUser.aircraftId, idempotencyKey: randomUUID(),
        payload: flightLogPayload(t0.toISOString(), 1010, 1010) },
      // Index 2 — middle
      { type: 'flight-log', aircraftId: seededUser.aircraftId, idempotencyKey: randomUUID(),
        payload: flightLogPayload(t1.toISOString(), 1020, 1020) },
    ];

    const res = await fetchAs(token, baseURL!, '/api/batch-submit', {
      method: 'POST',
      body: JSON.stringify({ submissions }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results.every((r: any) => r.ok)).toBe(true);

    // DB: rows present with the expected occurred_at order. The
    // happy-path proves the sort didn't crash; the existence of all
    // three rows proves no row failed the 24-hour bound (which would
    // have happened if the route processed in client-submit order
    // and a later log saw an empty history).
    const { data: rows } = await admin
      .from('aft_flight_logs')
      .select('occurred_at, hobbs')
      .eq('aircraft_id', seededUser.aircraftId)
      .gte('occurred_at', t0.toISOString())
      .lte('occurred_at', t2.toISOString())
      .order('occurred_at', { ascending: true });
    expect((rows || []).length).toBe(3);
    expect(Number((rows![0] as any).hobbs)).toBe(1010);
    expect(Number((rows![1] as any).hobbs)).toBe(1020);
    expect(Number((rows![2] as any).hobbs)).toBe(1030);
  });
});

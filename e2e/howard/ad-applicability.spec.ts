import { test, expect } from '../fixtures/seeded-user';
import { test as crossTest } from '../fixtures/two-users';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * AD applicability drill-down — `/api/ads/check-applicability`.
 *
 * The endpoint:
 *   1. Looks up the AD + aircraft + equipment.
 *   2. Cache check (aft_ad_applicability_cache, keyed by
 *      ad_number + source_hash). Hit → return cached parse, no
 *      Haiku call.
 *   3. Miss → Haiku 4.5 call with a structured-output tool
 *      ("report_applicability"); persist cache.
 *   4. Apply parsed verdict against THIS aircraft's serial /
 *      engine / prop and persist applicability_status to the AD row.
 *
 * Cost discipline: most cases are exercised with a pre-seeded cache
 * row so they don't burn an Anthropic call. ONE test (gated on
 * ANTHROPIC_API_KEY) exercises the real Haiku path end-to-end.
 */

async function seedAd(
  aircraftId: string,
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; ad_number: string; sync_hash: string }> {
  const adNumber = `2024-${Math.floor(Math.random() * 99)
    .toString()
    .padStart(2, '0')}-${Math.floor(Math.random() * 99).toString().padStart(2, '0')}`;
  const syncHash = `e2e-hash-${randomUUID()}`;
  const admin = adminClient();
  const { data, error } = await admin
    .from('aft_airworthiness_directives')
    .insert({
      aircraft_id: aircraftId,
      ad_number: adNumber,
      subject: 'Lycoming O-360 oil pump shaft inspection',
      applicability: 'Lycoming Engines O-360 series engines, all serial numbers.',
      compliance_type: 'one_time',
      source: 'manual',
      sync_hash: syncHash,
      created_by: userId,
      ...overrides,
    })
    .select('id, ad_number, sync_hash')
    .single();
  if (error || !data) throw new Error(`seed AD: ${error?.message}`);
  return data as { id: string; ad_number: string; sync_hash: string };
}

test.describe('AD applicability — cached parse (no paid call)', () => {
  test('cache hit returns the stored parse, persists verdict, fromCache=true', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();

    // Equip the aircraft with a Lycoming O-360 engine so the verdict
    // hits the engine_references arm.
    await admin.from('aft_aircraft_equipment').insert({
      aircraft_id: seededUser.aircraftId,
      name: 'Primary engine',
      category: 'engine',
      make: 'Lycoming',
      model: 'O-360',
      created_by: seededUser.userId,
    });

    const ad = await seedAd(seededUser.aircraftId, seededUser.userId);

    // Pre-seed cache so the route doesn't call Haiku.
    await admin.from('aft_ad_applicability_cache').insert({
      ad_number: ad.ad_number,
      source_hash: ad.sync_hash,
      parsed: {
        serial_ranges: [],
        specific_serials: [],
        engine_references: ['Lycoming O-360'],
        prop_references: [],
        notes: 'Pre-seeded for test.',
      },
    });

    const res = await fetchAs(token, baseURL!, '/api/ads/check-applicability', {
      method: 'POST',
      body: JSON.stringify({ adId: ad.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fromCache).toBe(true);
    expect(body.status).toBe('applies');
    expect(body.reason).toMatch(/engine/i);

    // Verdict persisted to the AD row.
    const { data: row } = await admin
      .from('aft_airworthiness_directives')
      .select('applicability_status, applicability_reason, applicability_checked_at')
      .eq('id', ad.id)
      .single();
    expect(row?.applicability_status).toBe('applies');
    expect(row?.applicability_reason).toMatch(/engine/i);
    expect(row?.applicability_checked_at).not.toBeNull();
  });

  test('serial-only AD with out-of-range serial yields does_not_apply', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();

    // Set the aircraft's serial number outside the AD range.
    await admin
      .from('aft_aircraft')
      .update({ serial_number: 'SN-15500' })
      .eq('id', seededUser.aircraftId);

    const ad = await seedAd(seededUser.aircraftId, seededUser.userId, {
      subject: 'Serial-range AD',
      applicability: 'Cessna 172 serials 17200001 through 17299999.',
    });

    await admin.from('aft_ad_applicability_cache').insert({
      ad_number: ad.ad_number,
      source_hash: ad.sync_hash,
      parsed: {
        serial_ranges: [{ start: 17200001, end: 17299999, inclusive: true }],
        specific_serials: [],
        engine_references: [],
        prop_references: [],
        notes: 'Serials only.',
      },
    });

    const res = await fetchAs(token, baseURL!, '/api/ads/check-applicability', {
      method: 'POST',
      body: JSON.stringify({ adId: ad.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fromCache).toBe(true);
    expect(body.status).toBe('does_not_apply');
  });

  test('returns 404 for unknown adId', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/ads/check-applicability', {
      method: 'POST',
      body: JSON.stringify({ adId: randomUUID() }),
    });
    expect(res.status).toBe(404);
  });

  test('returns 400 when adId is missing', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/ads/check-applicability', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

crossTest.describe('AD applicability — cross-aircraft auth', () => {
  crossTest('user B cannot drill-down on user A AD', async ({ userA, userB, baseURL }) => {
    const admin = adminClient();
    const { data: ad } = await admin
      .from('aft_airworthiness_directives')
      .insert({
        aircraft_id: userA.aircraftId,
        ad_number: '2024-99-AC',
        subject: 'A-only',
        applicability: 'whatever',
        compliance_type: 'one_time',
        source: 'manual',
        sync_hash: 'a-only-hash',
        created_by: userA.userId,
      })
      .select('id, ad_number, sync_hash')
      .single();

    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, '/api/ads/check-applicability', {
      method: 'POST',
      body: JSON.stringify({ adId: ad!.id }),
    });
    expect([401, 403, 404]).toContain(res.status);
  });
});

test.describe('AD applicability — Haiku end-to-end (paid)', () => {
  // Single targeted Haiku call: no cache, single AD, asserts the
  // route makes the call, persists to cache, and persists verdict
  // on the AD row. ~$0.001 per run.
  test.skip(!process.env.ANTHROPIC_API_KEY, 'Anthropic key not set');

  test('parses + caches + persists verdict on first call', async ({ seededUser, baseURL }) => {
    test.setTimeout(120_000);
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();

    // Cessna 172 owned aircraft. Use a serial in a plausible range.
    await admin
      .from('aft_aircraft')
      .update({ serial_number: '17280155' })
      .eq('id', seededUser.aircraftId);

    const ad = await seedAd(seededUser.aircraftId, seededUser.userId, {
      subject: 'Cessna 172 forward-cabin window — installation inspection',
      applicability: 'This AD applies to all Cessna Aircraft Company Model 172 series airplanes, all serial numbers.',
    });

    // Make sure the cache is empty for this (ad_number, sync_hash).
    await admin
      .from('aft_ad_applicability_cache')
      .delete()
      .eq('ad_number', ad.ad_number)
      .eq('source_hash', ad.sync_hash);

    const res = await fetchAs(token, baseURL!, '/api/ads/check-applicability', {
      method: 'POST',
      body: JSON.stringify({ adId: ad.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fromCache).toBe(false);
    expect(['applies', 'does_not_apply', 'review_required']).toContain(body.status);
    expect(body.parsed).toBeTruthy();
    expect(body.parsed.serial_ranges).toBeDefined();

    // Cache row written.
    const { data: cached } = await admin
      .from('aft_ad_applicability_cache')
      .select('parsed')
      .eq('ad_number', ad.ad_number)
      .eq('source_hash', ad.sync_hash)
      .maybeSingle();
    expect(cached?.parsed).toBeTruthy();

    // Verdict persisted to AD row.
    const { data: row } = await admin
      .from('aft_airworthiness_directives')
      .select('applicability_status, applicability_checked_at')
      .eq('id', ad.id)
      .single();
    expect(row?.applicability_status).toBe(body.status);
    expect(row?.applicability_checked_at).not.toBeNull();

    // Second call hits cache — no extra Haiku spend.
    const res2 = await fetchAs(token, baseURL!, '/api/ads/check-applicability', {
      method: 'POST',
      body: JSON.stringify({ adId: ad.id }),
    });
    const body2 = await res2.json();
    expect(body2.fromCache).toBe(true);
    expect(body2.status).toBe(body.status);
  });
});

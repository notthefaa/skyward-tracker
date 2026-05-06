import { test, expect } from '../fixtures/seeded-user';
import { test as crossTest } from '../fixtures/two-users';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';

/**
 * Airworthiness Directives API contract — manual CRUD, protected
 * fields, dup handling, cross-aircraft scope. The DRS sync path
 * lives behind a fetch-the-Federal-Register call we don't exercise
 * in CI; the applicability drill-down (Haiku) lives in
 * `e2e/howard/ad-applicability.spec.ts`.
 *
 * Key invariants:
 *   - POST always stamps source='manual' even if the client lies.
 *   - PUT cannot touch DRS-managed fields (source, is_superseded,
 *     superseded_by, sync_hash, applicability_*).
 *   - Duplicate (aircraft_id, ad_number) returns 409 with a friendly
 *     message.
 *   - DELETE soft-deletes; cross-aircraft PUT/DELETE rejected.
 */
test.describe('ADs API — manual create + protected fields', () => {
  test('POST creates a manual AD; source forced to "manual" even if client claims drs_sync', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/ads', {
      method: 'POST',
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        adData: {
          ad_number: '2024-12-01',
          subject: 'Test AD — Cessna magneto inspection',
          effective_date: '2024-12-15',
          applicability: 'All Cessna 172 aircraft',
          compliance_type: 'one_time',
          // Spoof attempts the route must override / strip:
          source: 'drs_sync',
          is_superseded: true,
          sync_hash: 'spoofed-hash',
          applicability_status: 'applies',
        },
      }),
    });
    expect(res.status).toBe(200);
    const { ad } = await res.json();

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_airworthiness_directives')
      .select('source, is_superseded, sync_hash, applicability_status, created_by')
      .eq('id', ad.id)
      .single();
    expect(row?.source).toBe('manual');
    expect(row?.is_superseded).toBe(false);
    expect(row?.sync_hash).toBeNull();
    expect(row?.applicability_status).toBeNull();
    expect(row?.created_by).toBe(seededUser.userId);
  });

  test('POST returns 409 when (aircraft_id, ad_number) already exists', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const adNumber = '2024-12-99';

    const r1 = await fetchAs(token, baseURL!, '/api/ads', {
      method: 'POST',
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        adData: { ad_number: adNumber, subject: 'First insert', compliance_type: 'one_time' },
      }),
    });
    expect(r1.status).toBe(200);

    const r2 = await fetchAs(token, baseURL!, '/api/ads', {
      method: 'POST',
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        adData: { ad_number: adNumber, subject: 'Dup attempt', compliance_type: 'one_time' },
      }),
    });
    expect(r2.status).toBe(409);
    const body = await r2.json();
    expect(body.error).toMatch(/already tracked/i);
  });

  test('POST rejects empty ad_number / subject', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/ads', {
      method: 'POST',
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        adData: { ad_number: '', subject: '' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('PUT logs compliance (last_complied_date / next_due_date)', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();
    const { data: ad } = await admin
      .from('aft_airworthiness_directives')
      .insert({
        aircraft_id: seededUser.aircraftId,
        ad_number: '2024-13-01',
        subject: 'Recurring inspection',
        compliance_type: 'recurring',
        recurring_interval_months: 12,
        source: 'manual',
        created_by: seededUser.userId,
      })
      .select('id')
      .single();

    const res = await fetchAs(token, baseURL!, '/api/ads', {
      method: 'PUT',
      body: JSON.stringify({
        adId: ad!.id,
        aircraftId: seededUser.aircraftId,
        adData: {
          last_complied_date: '2026-05-01',
          last_complied_time: 1234.5,
          last_complied_by: 'A&P 12345',
          compliance_method: 'Inspected per AD',
          next_due_date: '2027-05-01',
        },
      }),
    });
    expect(res.status).toBe(200);

    const { data: row } = await admin
      .from('aft_airworthiness_directives')
      .select('last_complied_date, last_complied_time, last_complied_by, compliance_method, next_due_date')
      .eq('id', ad!.id)
      .single();
    expect(row?.last_complied_date).toBe('2026-05-01');
    expect(Number(row?.last_complied_time)).toBe(1234.5);
    expect(row?.last_complied_by).toBe('A&P 12345');
    expect(row?.compliance_method).toBe('Inspected per AD');
    expect(row?.next_due_date).toBe('2027-05-01');
  });

  test('PUT cannot mark a manual AD as DRS-synced or set applicability_status', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();
    const { data: ad } = await admin
      .from('aft_airworthiness_directives')
      .insert({
        aircraft_id: seededUser.aircraftId,
        ad_number: '2024-14-01',
        subject: 'Manual AD',
        compliance_type: 'one_time',
        source: 'manual',
        created_by: seededUser.userId,
      })
      .select('id')
      .single();

    const res = await fetchAs(token, baseURL!, '/api/ads', {
      method: 'PUT',
      body: JSON.stringify({
        adId: ad!.id,
        aircraftId: seededUser.aircraftId,
        adData: {
          // Each of these is in the 'ads' strip set; PUT must drop them.
          source: 'drs_sync',
          is_superseded: true,
          superseded_by: 'fake-id',
          sync_hash: 'spoofed-hash',
          applicability_status: 'applies',
          applicability_reason: 'spoofed',
          applicability_checked_at: new Date().toISOString(),
          // This one IS allowed — proves the strip is selective.
          notes: 'Bench-tested 2026-05-06',
        },
      }),
    });
    expect(res.status).toBe(200);

    const { data: row } = await admin
      .from('aft_airworthiness_directives')
      .select('source, is_superseded, superseded_by, sync_hash, applicability_status, applicability_reason, applicability_checked_at, notes')
      .eq('id', ad!.id)
      .single();
    expect(row?.source).toBe('manual');
    expect(row?.is_superseded).toBe(false);
    expect(row?.superseded_by).toBeNull();
    expect(row?.sync_hash).toBeNull();
    expect(row?.applicability_status).toBeNull();
    expect(row?.applicability_reason).toBeNull();
    expect(row?.applicability_checked_at).toBeNull();
    expect(row?.notes).toBe('Bench-tested 2026-05-06');
  });

  test('DELETE soft-deletes the AD', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();
    const { data: ad } = await admin
      .from('aft_airworthiness_directives')
      .insert({
        aircraft_id: seededUser.aircraftId,
        ad_number: '2024-15-01',
        subject: 'About to be deleted',
        compliance_type: 'one_time',
        source: 'manual',
        created_by: seededUser.userId,
      })
      .select('id')
      .single();

    const res = await fetchAs(token, baseURL!, '/api/ads', {
      method: 'DELETE',
      body: JSON.stringify({ adId: ad!.id, aircraftId: seededUser.aircraftId }),
    });
    expect(res.status).toBe(200);

    const { data: row } = await admin
      .from('aft_airworthiness_directives')
      .select('deleted_at, deleted_by')
      .eq('id', ad!.id)
      .single();
    expect(row?.deleted_at).not.toBeNull();
    expect(row?.deleted_by).toBe(seededUser.userId);
  });

  test('GET filters out superseded by default; includeSuperseded=true returns them', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();
    await admin
      .from('aft_airworthiness_directives')
      .insert([
        {
          aircraft_id: seededUser.aircraftId,
          ad_number: '2024-16-01',
          subject: 'Live AD',
          compliance_type: 'one_time',
          source: 'manual',
          is_superseded: false,
          created_by: seededUser.userId,
        },
        {
          aircraft_id: seededUser.aircraftId,
          ad_number: '2024-16-02',
          subject: 'Superseded AD',
          compliance_type: 'one_time',
          source: 'manual',
          is_superseded: true,
          created_by: seededUser.userId,
        },
      ]);

    const r1 = await fetchAs(token, baseURL!, `/api/ads?aircraftId=${seededUser.aircraftId}`);
    expect(r1.status).toBe(200);
    const j1 = await r1.json();
    const subjects1 = (j1.ads as { subject: string }[]).map(a => a.subject);
    expect(subjects1).toContain('Live AD');
    expect(subjects1).not.toContain('Superseded AD');

    const r2 = await fetchAs(token, baseURL!, `/api/ads?aircraftId=${seededUser.aircraftId}&includeSuperseded=true`);
    const j2 = await r2.json();
    const subjects2 = (j2.ads as { subject: string }[]).map(a => a.subject);
    expect(subjects2).toContain('Live AD');
    expect(subjects2).toContain('Superseded AD');
  });
});

crossTest.describe('ADs API — cross-aircraft scope', () => {
  crossTest('user B cannot edit user A AD via spoofed aircraftId', async ({ userA, userB, baseURL }) => {
    const admin = adminClient();
    const { data: ad } = await admin
      .from('aft_airworthiness_directives')
      .insert({
        aircraft_id: userA.aircraftId,
        ad_number: '2024-99-01',
        subject: 'A-only AD',
        compliance_type: 'one_time',
        source: 'manual',
        created_by: userA.userId,
      })
      .select('id')
      .single();

    const tokenB = await getAccessToken(userB.email, userB.password);

    const r1 = await fetchAs(tokenB, baseURL!, '/api/ads', {
      method: 'PUT',
      body: JSON.stringify({
        adId: ad!.id,
        aircraftId: userA.aircraftId,
        adData: { subject: 'Hijacked' },
      }),
    });
    expect([401, 403, 404]).toContain(r1.status);

    const { data: row } = await admin
      .from('aft_airworthiness_directives')
      .select('subject')
      .eq('id', ad!.id)
      .single();
    expect(row?.subject).toBe('A-only AD');
  });

  crossTest('user B cannot delete user A AD', async ({ userA, userB, baseURL }) => {
    const admin = adminClient();
    const { data: ad } = await admin
      .from('aft_airworthiness_directives')
      .insert({
        aircraft_id: userA.aircraftId,
        ad_number: '2024-99-02',
        subject: 'A-only AD to delete',
        compliance_type: 'one_time',
        source: 'manual',
        created_by: userA.userId,
      })
      .select('id')
      .single();

    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, '/api/ads', {
      method: 'DELETE',
      body: JSON.stringify({ adId: ad!.id, aircraftId: userA.aircraftId }),
    });
    expect([401, 403, 404]).toContain(res.status);

    const { data: row } = await admin
      .from('aft_airworthiness_directives')
      .select('deleted_at')
      .eq('id', ad!.id)
      .single();
    expect(row?.deleted_at).toBeNull();
  });
});

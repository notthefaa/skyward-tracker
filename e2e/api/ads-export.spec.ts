import { test, expect } from '../fixtures/seeded-user';
import { test as crossTest } from '../fixtures/two-users';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';

/**
 * 91.417(b) AD compliance export — `/api/ads/export`.
 *
 * Pilots and mechanics rely on this CSV at annual / sale time, so:
 *   - It MUST throw on a read failure (no silent "all clean").
 *   - It MUST include superseded + complied rows (full audit history).
 *   - JSON format is supported for programmatic consumers.
 *   - Cross-aircraft access is gated.
 */
test.describe('ADs export — CSV + JSON', () => {
  test('CSV export includes header + comment lines + every AD row', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();

    // Seed a representative mix: live, complied, superseded.
    await admin.from('aft_airworthiness_directives').insert([
      {
        aircraft_id: seededUser.aircraftId,
        ad_number: '2024-EX-01',
        subject: 'Live one-time AD',
        compliance_type: 'one_time',
        source: 'manual',
        is_superseded: false,
        created_by: seededUser.userId,
      },
      {
        aircraft_id: seededUser.aircraftId,
        ad_number: '2024-EX-02',
        subject: 'Recurring complied AD',
        compliance_type: 'recurring',
        recurring_interval_months: 12,
        last_complied_date: '2026-01-15',
        last_complied_time: 1500.5,
        last_complied_by: 'A&P 99999',
        compliance_method: 'Inspected per AD body',
        next_due_date: '2027-01-15',
        source: 'manual',
        is_superseded: false,
        created_by: seededUser.userId,
      },
      {
        aircraft_id: seededUser.aircraftId,
        ad_number: '2024-EX-03',
        subject: 'Superseded AD',
        compliance_type: 'one_time',
        source: 'manual',
        is_superseded: true,
        superseded_by: '2025-EX-03',
        created_by: seededUser.userId,
      },
    ]);

    const res = await fetchAs(token, baseURL!, `/api/ads/export?aircraftId=${seededUser.aircraftId}&format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/text\/csv/);
    expect(res.headers.get('content-disposition') ?? '').toMatch(/attachment.*\.csv/);

    const csv = await res.text();
    const lines = csv.split('\n');

    // Header is the first line; comment lines (#) follow.
    expect(lines[0]).toMatch(/AD Number,Subject,Effective Date/);
    expect(csv).toMatch(new RegExp(`^# ${seededUser.tailNumber}`, 'm'));
    expect(csv).toMatch(/91\.417\(b\)/);

    // Every AD must appear, INCLUDING the superseded one — annual
    // audits need the full history. The CSV's "Superseded?" column
    // distinguishes them.
    expect(csv).toMatch(/2024-EX-01,/);
    expect(csv).toMatch(/2024-EX-02,/);
    expect(csv).toMatch(/2024-EX-03,/);
    expect(csv).toMatch(/Recurring complied AD/);
    expect(csv).toMatch(/Superseded AD/);
    expect(csv).toMatch(/A&P 99999/);
    expect(csv).toMatch(/2025-EX-03/);
    // `is_superseded` rendered as Yes/No.
    const supersededLine = lines.find(l => l.startsWith('2024-EX-03,'));
    expect(supersededLine ?? '').toMatch(/,Yes,/);
  });

  test('JSON format returns aircraft + ads array', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();
    await admin.from('aft_airworthiness_directives').insert({
      aircraft_id: seededUser.aircraftId,
      ad_number: '2024-EX-99',
      subject: 'JSON export AD',
      compliance_type: 'one_time',
      source: 'manual',
      created_by: seededUser.userId,
    });

    const res = await fetchAs(token, baseURL!, `/api/ads/export?aircraftId=${seededUser.aircraftId}&format=json`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aircraft?.tail_number).toBe(seededUser.tailNumber);
    expect(Array.isArray(body.ads)).toBe(true);
    const adNumbers = (body.ads as { ad_number: string }[]).map(a => a.ad_number);
    expect(adNumbers).toContain('2024-EX-99');
  });

  test('soft-deleted ADs are excluded from the export', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();
    await admin.from('aft_airworthiness_directives').insert([
      {
        aircraft_id: seededUser.aircraftId,
        ad_number: '2024-EX-LIVE',
        subject: 'Live AD that should appear',
        compliance_type: 'one_time',
        source: 'manual',
        created_by: seededUser.userId,
      },
      {
        aircraft_id: seededUser.aircraftId,
        ad_number: '2024-EX-DEAD',
        subject: 'Soft-deleted AD',
        compliance_type: 'one_time',
        source: 'manual',
        created_by: seededUser.userId,
        deleted_at: new Date().toISOString(),
      },
    ]);

    const res = await fetchAs(token, baseURL!, `/api/ads/export?aircraftId=${seededUser.aircraftId}&format=json`);
    const body = await res.json();
    const adNumbers = (body.ads as { ad_number: string }[]).map(a => a.ad_number);
    expect(adNumbers).toContain('2024-EX-LIVE');
    expect(adNumbers).not.toContain('2024-EX-DEAD');
  });

  test('returns 400 when aircraftId is missing', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/ads/export');
    expect(res.status).toBe(400);
  });
});

crossTest.describe('ADs export — cross-user access', () => {
  crossTest('user B cannot export user A AD compliance', async ({ userA, userB, baseURL }) => {
    const admin = adminClient();
    await admin.from('aft_airworthiness_directives').insert({
      aircraft_id: userA.aircraftId,
      ad_number: '2024-EX-XX',
      subject: 'A-only AD',
      compliance_type: 'one_time',
      source: 'manual',
      created_by: userA.userId,
    });

    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, `/api/ads/export?aircraftId=${userA.aircraftId}&format=json`);
    expect([401, 403, 404]).toContain(res.status);
  });
});

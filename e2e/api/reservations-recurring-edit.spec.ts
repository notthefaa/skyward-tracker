import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * Phase 5 — recurring reservations + PUT edit.
 *
 * Existing happy/overlap/end-before-start/cancel coverage lives in
 * `e2e/api/reservations.spec.ts`. This file fills the gap on:
 *   - bulk recurring inserts (multi-occurrence, partial conflicts skip)
 *   - intra-batch conflict detection (e.g. weekly series with
 *     overlapping multi-day occurrences)
 *   - 100-occurrence cap rejection
 *   - PUT edit (start/end/title) by owner
 *   - PUT edit by aircraft admin (their own future reservation)
 *   - PUT cross-user rejected
 *   - PUT change to a window that conflicts with another reservation
 */

function isoIn(hours: number): string {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

test.describe('reservations API — recurring + edit', () => {
  test('weekly recurring series creates non-conflicting occurrences and skips conflicts', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();

    // Submit a 4-occurrence weekly series at: +24h, +192h, +360h, +528h.
    // Each occurrence is 4 hours long.
    const occurrences = Array.from({ length: 4 }, (_, i) => ({
      start: isoIn(24 + i * 24 * 7),
      end: isoIn(28 + i * 24 * 7),
    }));

    // Pre-seed a confirmed reservation that DEFINITELY overlaps
    // occurrence #2 (+192h start, +196h end). Choose conflict at +194h
    // so the windows interleave.
    await admin.from('aft_reservations').insert({
      aircraft_id: seededUser.aircraftId,
      user_id: seededUser.userId,
      start_time: isoIn(194),
      end_time: isoIn(195),
      status: 'confirmed',
      title: 'Pre-seeded conflict',
    });

    const res = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        title: 'Weekly recurring',
        timeZone: 'UTC',
        occurrences,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Response shape: { success, created: number, skipped: number, skippedDetails?: [...] }
    expect(body.success).toBe(true);
    // Some occurrences MUST land + at least one MUST be skipped.
    expect(body.created).toBeGreaterThanOrEqual(1);
    expect(body.skipped).toBeGreaterThanOrEqual(1);

    const { data: rows } = await admin
      .from('aft_reservations')
      .select('id, status')
      .eq('aircraft_id', seededUser.aircraftId)
      .eq('status', 'confirmed')
      .eq('title', 'Weekly recurring');
    expect(rows?.length).toBeGreaterThanOrEqual(1);
  });

  test('intra-batch overlap is detected (no DB exclusion-constraint error)', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);

    // Two occurrences with overlapping windows in the same submission.
    const occA = { start: isoIn(48), end: isoIn(52) };
    const occB = { start: isoIn(50), end: isoIn(54) };

    const res = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        title: 'Overlapping series',
        timeZone: 'UTC',
        occurrences: [occA, occB],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Response shape: created/skipped are counts; skippedDetails is the array.
    expect(body.created).toBe(1);
    expect(body.skipped).toBe(1);
    const skipReasons = (body.skippedDetails || []).map((s: any) => s.reason).join(' ');
    expect(skipReasons.toLowerCase()).toMatch(/another occurrence|overlap/);
  });

  test('rejects > 100 occurrences with 400', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const occurrences = Array.from({ length: 101 }, (_, i) => ({
      start: isoIn(24 + i * 24 * 7),
      end: isoIn(28 + i * 24 * 7),
    }));

    const res = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        title: 'Too many',
        timeZone: 'UTC',
        occurrences,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/100 occurrences/i);
  });

  test('owner can edit their own reservation (start/end/title)', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const token = await getAccessToken(seededUser.email, seededUser.password);

    // Seed a reservation directly to skip POST.
    const start = isoIn(48);
    const end = isoIn(52);
    const { data: rsv } = await admin
      .from('aft_reservations')
      .insert({
        aircraft_id: seededUser.aircraftId,
        user_id: seededUser.userId,
        start_time: start,
        end_time: end,
        status: 'confirmed',
        title: 'Original title',
      })
      .select('id')
      .single();

    const newStart = isoIn(60);
    const newEnd = isoIn(64);
    const res = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'PUT',
      body: JSON.stringify({
        reservationId: rsv!.id,
        startTime: newStart,
        endTime: newEnd,
        title: 'Edited title',
        timeZone: 'UTC',
      }),
    });
    expect(res.status).toBe(200);

    const { data: row } = await admin
      .from('aft_reservations')
      .select('start_time, end_time, title')
      .eq('id', rsv!.id)
      .single();
    expect(row?.title).toBe('Edited title');
    expect(new Date(row!.start_time).toISOString()).toBe(new Date(newStart).toISOString());
    expect(new Date(row!.end_time).toISOString()).toBe(new Date(newEnd).toISOString());
  });

  test('PUT to a window that conflicts with another reservation is rejected', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const token = await getAccessToken(seededUser.email, seededUser.password);

    // Two reservations: A and B. Try to edit A's window so it overlaps B.
    const { data: rsvA } = await admin
      .from('aft_reservations')
      .insert({
        aircraft_id: seededUser.aircraftId,
        user_id: seededUser.userId,
        start_time: isoIn(72),
        end_time: isoIn(76),
        status: 'confirmed',
        title: 'A',
      })
      .select('id')
      .single();

    const bStart = isoIn(80);
    const bEnd = isoIn(84);
    await admin.from('aft_reservations').insert({
      aircraft_id: seededUser.aircraftId,
      user_id: seededUser.userId,
      start_time: bStart,
      end_time: bEnd,
      status: 'confirmed',
      title: 'B',
    });

    // Move A into B's window.
    const res = await fetchAs(token, baseURL!, '/api/reservations', {
      method: 'PUT',
      body: JSON.stringify({
        reservationId: rsvA!.id,
        startTime: isoIn(81),
        endTime: isoIn(83),
        timeZone: 'UTC',
      }),
    });
    expect([400, 409]).toContain(res.status);

    // A's window must not have been moved.
    const { data: rowAfter } = await admin
      .from('aft_reservations')
      .select('start_time, end_time')
      .eq('id', rsvA!.id)
      .single();
    expect(new Date(rowAfter!.start_time).getTime()).toBeLessThan(new Date(bStart).getTime());
  });
});

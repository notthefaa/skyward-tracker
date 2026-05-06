import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';

/**
 * /api/mx-events/block — creates a confirmed MX block + auto-cancels
 * overlapping pilot reservations via `cancelConflictingReservations`.
 *
 * Covers the silent-error fixes in `b5926bc`:
 *   - mxConflicts.ts overlap read + bulk-cancel update both throw on
 *     supabase error (was silent — pilots could show up at the airport
 *     for a reservation that should have been cancelled).
 *   - block route's audit-trail message insert throws on error (so
 *     a block can't exist without "who created it" history).
 */
test.describe('mx-events/block + reservation conflict cancel', () => {
  test('creates a block and cancels overlapping confirmed reservation', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const token = await getAccessToken(seededUser.email, seededUser.password);

    // Pre-seed a confirmed pilot reservation that will overlap.
    const blockStart = '2026-12-01';
    const blockEnd = '2026-12-03';
    const { data: rsv, error: rsvErr } = await admin
      .from('aft_reservations')
      .insert({
        aircraft_id: seededUser.aircraftId,
        user_id: seededUser.userId,
        start_time: '2026-12-02T14:00:00Z',
        end_time: '2026-12-02T16:00:00Z',
        status: 'confirmed',
      })
      .select('id')
      .single();
    if (rsvErr) throw new Error(`seed reservation: ${rsvErr.message}`);
    const reservationId = rsv.id as string;

    // Create the MX block.
    const res = await fetchAs(token, baseURL!, '/api/mx-events/block', {
      method: 'POST',
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        startDate: blockStart,
        endDate: blockEnd,
        notes: 'Test block (overlapping reservation expected to be cancelled).',
        timeZone: 'America/Chicago',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.eventId).toBeTruthy();

    // The MX event should exist.
    const { data: event } = await admin
      .from('aft_maintenance_events')
      .select('status, confirmed_date, estimated_completion')
      .eq('id', body.eventId)
      .single();
    expect(event?.status).toBe('confirmed');
    expect(event?.confirmed_date).toBe(blockStart);
    expect(event?.estimated_completion).toBe(blockEnd);

    // Audit-trail message must be inserted (we throw on error now).
    const { data: msgs } = await admin
      .from('aft_event_messages')
      .select('sender, message_type, message')
      .eq('event_id', body.eventId);
    expect(msgs?.length).toBeGreaterThanOrEqual(1);
    expect(msgs?.[0].sender).toBe('system');

    // Overlapping reservation should be cancelled.
    const { data: rsvAfter } = await admin
      .from('aft_reservations')
      .select('status')
      .eq('id', reservationId)
      .single();
    expect(rsvAfter?.status).toBe('cancelled');

    // Cleanup.
    await admin.from('aft_event_messages').delete().eq('event_id', body.eventId);
    await admin.from('aft_maintenance_events').delete().eq('id', body.eventId);
    await admin.from('aft_reservations').delete().eq('id', reservationId);
  });

  test('rejects end-before-start with 400', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/mx-events/block', {
      method: 'POST',
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        startDate: '2026-12-05',
        endDate: '2026-12-01',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/end date must be on or after/i);
  });

  test('block does NOT cancel non-overlapping reservation', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const token = await getAccessToken(seededUser.email, seededUser.password);

    // Reservation in February — block in December — shouldn't cancel.
    const { data: rsv } = await admin
      .from('aft_reservations')
      .insert({
        aircraft_id: seededUser.aircraftId,
        user_id: seededUser.userId,
        start_time: '2026-02-15T14:00:00Z',
        end_time: '2026-02-15T16:00:00Z',
        status: 'confirmed',
      })
      .select('id')
      .single();
    const reservationId = rsv!.id as string;

    const res = await fetchAs(token, baseURL!, '/api/mx-events/block', {
      method: 'POST',
      body: JSON.stringify({
        aircraftId: seededUser.aircraftId,
        startDate: '2026-12-01',
        endDate: '2026-12-03',
        notes: 'Block far from any reservations.',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    const { data: rsvAfter } = await admin
      .from('aft_reservations')
      .select('status')
      .eq('id', reservationId)
      .single();
    expect(rsvAfter?.status).toBe('confirmed');

    await admin.from('aft_event_messages').delete().eq('event_id', body.eventId);
    await admin.from('aft_maintenance_events').delete().eq('id', body.eventId);
    await admin.from('aft_reservations').delete().eq('id', reservationId);
  });
});

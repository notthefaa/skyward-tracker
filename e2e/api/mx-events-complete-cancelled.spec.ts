import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';

/**
 * /api/mx-events/complete must reject when the event is already
 * cancelled. The route used to filter only on `deleted_at IS NULL`,
 * but cancel doesn't soft-delete — it sets status='cancelled' and
 * rotates the access_token. Without a status guard, an admin could
 * "Complete" a cancelled event, calling complete_mx_event_atomic RPC
 * which would advance MX intervals and resolve squawks linked to
 * line items — silently undoing the cancel.
 *
 * Mirrors the symmetric guard added to owner-action/route.ts and
 * the existing one in respond/route.ts.
 */

test.describe('mx-events/complete — cancelled-event guard', () => {
  test('returns 409 on a cancelled event without advancing MX intervals', async ({ seededUser, baseURL }) => {
    const admin = adminClient();

    // Seed a cancelled event directly. The status='cancelled' alone
    // (deleted_at left null) is what would slip past the old route.
    const { data: ev, error: evErr } = await admin
      .from('aft_maintenance_events')
      .insert({
        aircraft_id: seededUser.aircraftId,
        created_by: seededUser.userId,
        status: 'cancelled',
      })
      .select('id')
      .single();
    if (evErr || !ev) throw new Error(`seed cancelled event: ${evErr?.message ?? 'no row'}`);
    const eventId = ev.id as string;

    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/mx-events/complete', {
      method: 'POST',
      body: JSON.stringify({
        eventId,
        lineCompletions: [],
      }),
    });
    expect(res.status).toBe(409);

    // Status must NOT have flipped to 'complete'.
    const { data: after } = await admin
      .from('aft_maintenance_events')
      .select('status, completed_at')
      .eq('id', eventId)
      .single();
    expect(after?.status).toBe('cancelled');
    expect(after?.completed_at).toBeNull();

    await admin.from('aft_event_messages').delete().eq('event_id', eventId);
    await admin.from('aft_maintenance_events').delete().eq('id', eventId);
  });

  test('returns 404 on a soft-deleted event (regression guard)', async ({ seededUser, baseURL }) => {
    const admin = adminClient();

    const { data: ev, error: evErr } = await admin
      .from('aft_maintenance_events')
      .insert({
        aircraft_id: seededUser.aircraftId,
        created_by: seededUser.userId,
        status: 'confirmed',
        deleted_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (evErr || !ev) throw new Error(`seed deleted event: ${evErr?.message ?? 'no row'}`);
    const eventId = ev.id as string;

    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/mx-events/complete', {
      method: 'POST',
      body: JSON.stringify({ eventId, lineCompletions: [] }),
    });
    expect(res.status).toBe(404);

    await admin.from('aft_maintenance_events').delete().eq('id', eventId);
  });
});

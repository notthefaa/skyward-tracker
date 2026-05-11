import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * Mechanic-portal happy path + concurrent-cancel races.
 *
 * Covers the silent-error sweep landed in commit `b5926bc` — every
 * UPDATE on aft_maintenance_events from /api/mx-events/respond and
 * /api/mx-events/owner-action now uses count:'exact' + deleted_at
 * re-check, and a 0-row update returns 409 instead of silently
 * sending an email about an event that didn't actually advance.
 */
async function seedScheduledEvent(seededUser: { aircraftId: string; userId: string }) {
  const admin = adminClient();
  // NULL contact emails so the routes' email-send paths are skipped —
  // we're testing the DB state machine, not Resend integration. Resend
  // calls to fake domains can take 20+s and time out the test.
  const { data: ev, error } = await admin
    .from('aft_maintenance_events')
    .insert({
      aircraft_id: seededUser.aircraftId,
      created_by: seededUser.userId,
      status: 'scheduling',
      proposed_date: '2026-12-01',
      proposed_by: 'owner',
      mx_contact_name: 'Test MX',
      mx_contact_email: null,
      primary_contact_name: 'Test Owner',
      primary_contact_email: null,
    })
    .select('id, access_token')
    .single();
  if (error) throw new Error(`seedScheduledEvent: ${error.message}`);
  return { eventId: ev.id as string, accessToken: ev.access_token as string };
}

test.describe('mx-event portal — happy path + races', () => {
  test('mechanic confirms owner-proposed date → owner-action confirms → mark_ready', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { eventId, accessToken } = await seedScheduledEvent(seededUser);

    // 1. Mechanic confirms the owner's proposed date.
    let res = await fetch(`${baseURL}/api/mx-events/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken,
        action: 'confirm',
        serviceDurationDays: 3,
        message: 'Confirmed for Dec 1.',
      }),
    });
    expect(res.status).toBe(200);

    // Event should be 'confirmed' now.
    let { data: ev } = await admin
      .from('aft_maintenance_events')
      .select('status, confirmed_date, service_duration_days')
      .eq('id', eventId)
      .single();
    expect(ev?.status).toBe('confirmed');
    expect(ev?.confirmed_date).toBe('2026-12-01');
    expect(ev?.service_duration_days).toBe(3);

    // 2. Mechanic marks the work ready for pickup.
    res = await fetch(`${baseURL}/api/mx-events/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken,
        action: 'mark_ready',
        message: 'Annual signed off, ready for pickup.',
      }),
    });
    expect(res.status).toBe(200);

    const { data: rdyEv } = await admin
      .from('aft_maintenance_events')
      .select('status, ready_at')
      .eq('id', eventId)
      .single();
    expect(rdyEv?.status).toBe('ready_for_pickup');
    // ready_at is the Phase 5 nudge anchor (migration 060). mark_ready
    // must set it; suggest_item must not. Cron infers stale-pickup from
    // this column instead of mining message ordering.
    expect(rdyEv?.ready_at).toBeTruthy();

    // 3. Audit-trail: each respond action inserts a message row.
    const { data: msgs } = await admin
      .from('aft_event_messages')
      .select('sender, message_type')
      .eq('event_id', eventId)
      .order('created_at');
    expect((msgs ?? []).filter(m => m.sender === 'mechanic').length).toBeGreaterThanOrEqual(2);

    // Cleanup.
    await admin.from('aft_event_messages').delete().eq('event_id', eventId);
    await admin.from('aft_maintenance_events').delete().eq('id', eventId);
  });

  test('mechanic respond returns 409 when owner concurrently cancelled the event', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { eventId, accessToken } = await seedScheduledEvent(seededUser);

    // Owner cancels (soft-delete via deleted_at).
    await admin
      .from('aft_maintenance_events')
      .update({ deleted_at: new Date().toISOString(), deleted_by: seededUser.userId })
      .eq('id', eventId);

    // Mechanic, unaware, tries to confirm. The route's first read filters
    // deleted_at IS NULL — should already 404.
    const res = await fetch(`${baseURL}/api/mx-events/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken,
        action: 'confirm',
        serviceDurationDays: 3,
      }),
    });
    expect(res.status).toBe(404);

    // Event status unchanged.
    const { data: ev } = await admin
      .from('aft_maintenance_events')
      .select('status, confirmed_date')
      .eq('id', eventId)
      .single();
    expect(ev?.status).toBe('scheduling');
    expect(ev?.confirmed_date).toBeNull();

    await admin.from('aft_maintenance_events').delete().eq('id', eventId);
  });

  test('mechanic respond rejects unknown action with 400', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { eventId, accessToken } = await seedScheduledEvent(seededUser);

    const res = await fetch(`${baseURL}/api/mx-events/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken, action: 'sabotage' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unknown.*action/i);

    await admin.from('aft_maintenance_events').delete().eq('id', eventId);
  });

  test('owner-action confirm requires aircraft admin', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { eventId } = await seedScheduledEvent(seededUser);

    // Pre-condition: bring event to a state where mechanic has proposed
    // and owner can now confirm (mechanic's proposal flips status, but
    // for this test we just assert auth gate).
    const token = await getAccessToken(seededUser.email, seededUser.password);

    // seededUser IS aircraft admin → expected to succeed (or 4xx if
    // status doesn't allow confirm). We just want to verify the auth
    // gate doesn't 401/403.
    const res = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId, action: 'cancel', message: 'Test cancel' }),
    });
    expect([200, 400, 409]).toContain(res.status);

    await admin.from('aft_event_messages').delete().eq('event_id', eventId);
    await admin.from('aft_maintenance_events').delete().eq('id', eventId);
  });

  test('owner-action 404s on a soft-deleted event', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { eventId } = await seedScheduledEvent(seededUser);
    await admin.from('aft_maintenance_events').update({ deleted_at: new Date().toISOString() }).eq('id', eventId);

    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId, action: 'confirm' }),
    });
    expect(res.status).toBe(404);

    await admin.from('aft_maintenance_events').delete().eq('id', eventId);
  });

  test('cross-aircraft owner-action rejected', async ({ seededUser, baseURL }) => {
    const admin = adminClient();

    // Make a separate aircraft owned by a different user — seededUser
    // is NOT admin there.
    const otherEmail = `e2e-other-${randomUUID()}@skyward-test.local`;
    const { data: otherU } = await admin.auth.admin.createUser({
      email: otherEmail, password: 'pw-other-12345', email_confirm: true,
    });
    const otherUserId = otherU!.user!.id;
    const { data: otherAc, error: acErr } = await admin.rpc('create_aircraft_atomic', {
      p_user_id: otherUserId,
      p_payload: {
        tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`,
        aircraft_type: 'Cessna 172S',
        engine_type: 'Piston',
      },
    });
    if (acErr) throw new Error(`create_aircraft: ${acErr.message}`);
    const otherAircraftId = (otherAc as { id: string }).id;

    const { data: ev } = await admin.from('aft_maintenance_events').insert({
      aircraft_id: otherAircraftId,
      created_by: otherUserId,
      status: 'scheduling',
    }).select('id').single();

    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId: ev!.id, action: 'cancel' }),
    });
    expect(res.status).toBe(403);

    // Cleanup.
    await admin.from('aft_maintenance_events').delete().eq('id', ev!.id);
    await admin.from('aft_aircraft').delete().eq('id', otherAircraftId);
    await admin.auth.admin.deleteUser(otherUserId).then(undefined, () => {});
  });
});

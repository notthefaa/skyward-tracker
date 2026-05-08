import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * /api/mx-events/owner-action — full coverage of confirm / counter /
 * comment / cancel branches plus the cross-action lifecycle gate.
 *
 * Mirrors the spec in mx-event-portal.spec.ts (which exercises mechanic
 * `respond`) for the owner-facing endpoint. Where the mechanic route
 * gates on `event.status === 'cancelled'` (line 67 of respond/route.ts),
 * the owner-action route only filtered on `deleted_at IS NULL` — a
 * cancelled event could be silently resurrected by `confirm` /
 * `counter` / `comment`, with the access_token already rotated so the
 * mechanic's portal link no longer worked. These specs lock the
 * symmetric guard.
 *
 * Contact emails are NULL on the seed event so the Resend path is
 * skipped — we're testing DB state + HTTP shape, not email integration.
 */

async function seedScheduledEvent(seededUser: { aircraftId: string; userId: string }) {
  const admin = adminClient();
  const { data: ev, error } = await admin
    .from('aft_maintenance_events')
    .insert({
      aircraft_id: seededUser.aircraftId,
      created_by: seededUser.userId,
      status: 'scheduling',
      proposed_date: '2026-12-01',
      proposed_by: 'mechanic',
      mx_contact_name: 'Test MX',
      mx_contact_email: null,
      primary_contact_name: 'Test Owner',
      primary_contact_email: null,
    })
    .select('id, access_token')
    .single();
  if (error) throw new Error(`seedScheduledEvent: ${error.message}`);
  return { eventId: ev.id as string, originalToken: ev.access_token as string };
}

async function cleanup(eventId: string) {
  const admin = adminClient();
  await admin.from('aft_event_messages').delete().eq('event_id', eventId);
  await admin.from('aft_maintenance_events').delete().eq('id', eventId);
}

test.describe('owner-action — branch coverage', () => {
  test('confirm: happy path flips status + inserts owner confirm message', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { eventId } = await seedScheduledEvent(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId, action: 'confirm', message: 'Looks good.' }),
    });
    expect(res.status).toBe(200);

    const { data: ev } = await admin
      .from('aft_maintenance_events')
      .select('status, confirmed_date, confirmed_at')
      .eq('id', eventId)
      .single();
    expect(ev?.status).toBe('confirmed');
    expect(ev?.confirmed_date).toBe('2026-12-01');
    expect(ev?.confirmed_at).toBeTruthy();

    const { data: msgs } = await admin
      .from('aft_event_messages')
      .select('sender, message_type, message')
      .eq('event_id', eventId);
    const confirmMsg = (msgs ?? []).find(m => m.sender === 'owner' && m.message_type === 'confirm');
    expect(confirmMsg).toBeTruthy();
    expect(confirmMsg?.message).toContain('Looks good');

    await cleanup(eventId);
  });

  test('counter: happy path updates proposed_date + inserts counter message', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { eventId } = await seedScheduledEvent(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({
        eventId,
        action: 'counter',
        proposedDate: '2026-12-15',
        message: 'How about the 15th?',
      }),
    });
    expect(res.status).toBe(200);

    const { data: ev } = await admin
      .from('aft_maintenance_events')
      .select('proposed_date, proposed_by, status')
      .eq('id', eventId)
      .single();
    expect(ev?.proposed_date).toBe('2026-12-15');
    expect(ev?.proposed_by).toBe('owner');
    expect(ev?.status).toBe('scheduling');

    const { data: msgs } = await admin
      .from('aft_event_messages')
      .select('sender, message_type, proposed_date')
      .eq('event_id', eventId);
    const counterMsg = (msgs ?? []).find(m => m.sender === 'owner' && m.message_type === 'counter');
    expect(counterMsg).toBeTruthy();
    expect(counterMsg?.proposed_date).toBe('2026-12-15');

    await cleanup(eventId);
  });

  test('counter: rejects malformed proposed_date with 400', async ({ seededUser, baseURL }) => {
    const { eventId } = await seedScheduledEvent(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId, action: 'counter', proposedDate: '12/15/2026' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/YYYY-MM-DD|valid/i);

    await cleanup(eventId);
  });

  test('counter: missing proposed_date returns 400', async ({ seededUser, baseURL }) => {
    const { eventId } = await seedScheduledEvent(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId, action: 'counter' }),
    });
    expect(res.status).toBe(400);

    await cleanup(eventId);
  });

  test('comment: happy path inserts message row, no status change', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { eventId } = await seedScheduledEvent(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId, action: 'comment', message: 'Quick question about the W&B.' }),
    });
    expect(res.status).toBe(200);

    const { data: ev } = await admin
      .from('aft_maintenance_events')
      .select('status, proposed_date')
      .eq('id', eventId)
      .single();
    expect(ev?.status).toBe('scheduling');
    expect(ev?.proposed_date).toBe('2026-12-01');

    const { data: msgs } = await admin
      .from('aft_event_messages')
      .select('sender, message_type, message')
      .eq('event_id', eventId);
    const comment = (msgs ?? []).find(m => m.sender === 'owner' && m.message_type === 'comment');
    expect(comment).toBeTruthy();
    expect(comment?.message).toContain('W&B');

    await cleanup(eventId);
  });

  test('cancel: happy path flips status + rotates access_token + inserts status_update', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { eventId, originalToken } = await seedScheduledEvent(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const res = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId, action: 'cancel', message: 'Plans changed.' }),
    });
    expect(res.status).toBe(200);

    const { data: ev } = await admin
      .from('aft_maintenance_events')
      .select('status, access_token, deleted_at')
      .eq('id', eventId)
      .single();
    expect(ev?.status).toBe('cancelled');
    expect(ev?.access_token).not.toBe(originalToken);
    expect(ev?.deleted_at).toBeNull();

    const { data: msgs } = await admin
      .from('aft_event_messages')
      .select('sender, message_type, message')
      .eq('event_id', eventId);
    const cancelMsg = (msgs ?? []).find(m => m.sender === 'owner' && m.message_type === 'status_update');
    expect(cancelMsg).toBeTruthy();
    expect(cancelMsg?.message).toContain('Plans changed');

    await cleanup(eventId);
  });

  test('cancel → confirm: 409 instead of resurrecting cancelled event', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { eventId } = await seedScheduledEvent(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    // Owner cancels first.
    const cancelRes = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId, action: 'cancel', message: 'Out for now.' }),
    });
    expect(cancelRes.status).toBe(200);

    // Owner attempts confirm on the now-cancelled event. Without a
    // status guard, the route would flip status back to 'confirmed'
    // even though the access_token has already rotated and the
    // mechanic's portal link is dead — leaving the event in a
    // half-resurrected state where confirmation emails reference a
    // broken link.
    const res = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId, action: 'confirm' }),
    });
    expect(res.status).toBe(409);

    const { data: ev } = await admin
      .from('aft_maintenance_events')
      .select('status, confirmed_date')
      .eq('id', eventId)
      .single();
    expect(ev?.status).toBe('cancelled');
    expect(ev?.confirmed_date).toBeNull();

    await cleanup(eventId);
  });

  test('cancel → counter: 409 instead of modifying cancelled event', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { eventId } = await seedScheduledEvent(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const cancelRes = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId, action: 'cancel' }),
    });
    expect(cancelRes.status).toBe(200);

    const res = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId, action: 'counter', proposedDate: '2026-12-20' }),
    });
    expect(res.status).toBe(409);

    const { data: ev } = await admin
      .from('aft_maintenance_events')
      .select('status, proposed_date')
      .eq('id', eventId)
      .single();
    expect(ev?.status).toBe('cancelled');
    expect(ev?.proposed_date).toBe('2026-12-01');

    await cleanup(eventId);
  });

  test('cancel → comment: 409 instead of appending to cancelled event', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { eventId } = await seedScheduledEvent(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const cancelRes = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId, action: 'cancel' }),
    });
    expect(cancelRes.status).toBe(200);

    const res = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId, action: 'comment', message: 'Sneaking one in.' }),
    });
    expect(res.status).toBe(409);

    const { data: msgs } = await admin
      .from('aft_event_messages')
      .select('message_type, message')
      .eq('event_id', eventId);
    const sneaky = (msgs ?? []).find(m => m.message_type === 'comment' && (m.message || '').includes('Sneaking'));
    expect(sneaky).toBeUndefined();

    await cleanup(eventId);
  });

  test('cancel → cancel: 409 (already-cancelled), no second token rotation', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { eventId } = await seedScheduledEvent(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const firstRes = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId, action: 'cancel' }),
    });
    expect(firstRes.status).toBe(200);

    const { data: afterFirst } = await admin
      .from('aft_maintenance_events')
      .select('access_token')
      .eq('id', eventId)
      .single();
    const tokenAfterFirst = afterFirst?.access_token;

    const secondRes = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      body: JSON.stringify({ eventId, action: 'cancel' }),
    });
    expect(secondRes.status).toBe(409);

    const { data: afterSecond } = await admin
      .from('aft_maintenance_events')
      .select('access_token')
      .eq('id', eventId)
      .single();
    expect(afterSecond?.access_token).toBe(tokenAfterFirst);

    await cleanup(eventId);
  });

  test('idempotency: cancel replay with same key returns cached 200, not 409', async ({ seededUser, baseURL }) => {
    // The cancel-terminal guard and idempotency check are both gates,
    // but they must be ordered idem-first so a network-retry of a
    // SUCCESSFUL cancel doesn't fall into the cancelled-status check
    // and 409 instead of returning the cached 200. Lock the ordering.
    const admin = adminClient();
    const { eventId } = await seedScheduledEvent(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const idemKey = randomUUID();

    const res1 = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body: JSON.stringify({ eventId, action: 'cancel', message: 'Network drops next.' }),
    });
    expect(res1.status).toBe(200);

    const res2 = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body: JSON.stringify({ eventId, action: 'cancel', message: 'Network drops next.' }),
    });
    expect(res2.status).toBe(200);

    // Only one cancel message row — the replay returned cached without
    // re-running the INSERT into aft_event_messages.
    const { data: msgs } = await admin
      .from('aft_event_messages')
      .select('message_type')
      .eq('event_id', eventId)
      .eq('message_type', 'status_update');
    expect((msgs ?? []).length).toBe(1);

    await cleanup(eventId);
  });

  test('idempotency: same X-Idempotency-Key returns cached response without duplicate side effects', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { eventId } = await seedScheduledEvent(seededUser);
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const idemKey = randomUUID();

    const res1 = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body: JSON.stringify({ eventId, action: 'comment', message: 'Idem-replay test.' }),
    });
    expect(res1.status).toBe(200);

    const res2 = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body: JSON.stringify({ eventId, action: 'comment', message: 'Idem-replay test.' }),
    });
    expect(res2.status).toBe(200);

    const { data: msgs } = await admin
      .from('aft_event_messages')
      .select('id, message_type')
      .eq('event_id', eventId);
    const comments = (msgs ?? []).filter(m => m.message_type === 'comment');
    expect(comments.length).toBe(1);

    await cleanup(eventId);
  });
});

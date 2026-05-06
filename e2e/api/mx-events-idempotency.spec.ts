import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * Idempotency wiring for the mechanic-portal POST routes. Field
 * report: a flaky cell connection can replay a "Confirm" tap and
 * the owner gets two confirmation emails / two status flips. The
 * server-side cache keyed on (user, X-Idempotency-Key, route) returns
 * the cached response instead of re-running the side effects.
 *
 * Coverage:
 *   - mx-events/owner-action — auth-gated, keyed on user.id.
 *   - mx-events/respond     — token-gated, keyed on event.created_by.
 *   - mx-events/complete    — auth-gated, keyed on user.id.
 *   - mx-events/block       — auth-gated, keyed on user.id.
 *   - mx-events/send-workpackage and upload-attachment have wiring
 *     too, but they trigger Resend / Storage side-effects that we
 *     don't want to fire in CI — covered by the route-handler audit
 *     of the helper, not by an end-to-end network call.
 */

async function seedEvent(seededUser: { aircraftId: string; userId: string }, overrides: Record<string, unknown> = {}) {
  const admin = adminClient();
  const { data, error } = await admin
    .from('aft_maintenance_events')
    .insert({
      aircraft_id: seededUser.aircraftId,
      created_by: seededUser.userId,
      status: 'scheduling',
      proposed_date: '2026-06-01',
      proposed_by: 'mechanic',
      access_token: randomUUID().replace(/-/g, ''),
      mx_contact_name: 'Test Mechanic',
      mx_contact_email: 'mechanic@skyward-test.local',
      primary_contact_name: 'Test Owner',
      primary_contact_email: 'owner@skyward-test.local',
      ...overrides,
    })
    .select('id, access_token, status, proposed_date')
    .single();
  if (error || !data) throw new Error(`seed event: ${error?.message}`);
  return data as { id: string; access_token: string; status: string; proposed_date: string };
}

test.describe('mx-events/owner-action — idempotency', () => {
  test('same X-Idempotency-Key replays without re-inserting message rows', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const event = await seedEvent(seededUser);
    const idemKey = randomUUID();
    const admin = adminClient();

    const body = JSON.stringify({
      eventId: event.id,
      action: 'comment',
      message: 'Idempotency probe — only one message row should land.',
      timeZone: 'America/Los_Angeles',
    });

    const r1 = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(r1.status).toBe(200);

    const r2 = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(r2.status).toBe(200);
    expect(r2.headers.get('x-idempotent-replay')).toBe('true');

    // Exactly one message row from the owner with the probe text.
    const { data: msgs } = await admin
      .from('aft_event_messages')
      .select('id, message, sender')
      .eq('event_id', event.id)
      .eq('sender', 'owner');
    expect((msgs || []).filter(m => m.message?.includes('Idempotency probe'))).toHaveLength(1);
  });

  test('different X-Idempotency-Key creates separate message rows', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const event = await seedEvent(seededUser);
    const admin = adminClient();

    for (let i = 0; i < 2; i++) {
      const r = await fetchAs(token, baseURL!, '/api/mx-events/owner-action', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': randomUUID() },
        body: JSON.stringify({
          eventId: event.id,
          action: 'comment',
          message: `Distinct probe ${i}`,
          timeZone: 'America/Los_Angeles',
        }),
      });
      expect(r.status).toBe(200);
    }

    const { data: msgs } = await admin
      .from('aft_event_messages')
      .select('id, message')
      .eq('event_id', event.id)
      .eq('sender', 'owner');
    expect((msgs || []).filter(m => m.message?.startsWith('Distinct probe'))).toHaveLength(2);
  });
});

test.describe('mx-events/respond — idempotency (token-gated)', () => {
  test('same X-Idempotency-Key replays without re-inserting mechanic comment', async ({ seededUser, baseURL }) => {
    // Need a confirmed (or scheduling, non-cancelled) event so 'comment'
    // is allowed. Use seeded one in 'scheduling' status.
    const event = await seedEvent(seededUser);
    const idemKey = randomUUID();
    const admin = adminClient();

    const body = JSON.stringify({
      accessToken: event.access_token,
      action: 'comment',
      message: 'Token-gated idempotency probe',
    });

    const r1 = await fetch(`${baseURL}/api/mx-events/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(r1.status).toBe(200);

    const r2 = await fetch(`${baseURL}/api/mx-events/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(r2.status).toBe(200);
    expect(r2.headers.get('x-idempotent-replay')).toBe('true');

    const { data: msgs } = await admin
      .from('aft_event_messages')
      .select('id, message, sender')
      .eq('event_id', event.id)
      .eq('sender', 'mechanic');
    expect((msgs || []).filter(m => m.message?.includes('Token-gated idempotency probe'))).toHaveLength(1);
  });
});

test.describe('mx-events/complete — idempotency', () => {
  test('replay returns same {allResolved, unmatchedIds} without re-running RPC', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();
    // Need a confirmed event with a line item so the RPC has work to do.
    const event = await seedEvent(seededUser, { status: 'confirmed', confirmed_date: '2026-06-01' });
    const { data: line } = await admin
      .from('aft_event_line_items')
      .insert({
        event_id: event.id,
        item_type: 'addon',
        item_name: 'Idempotency-test addon',
        line_status: 'pending',
      })
      .select('id')
      .single();

    const idemKey = randomUUID();
    const body = JSON.stringify({
      eventId: event.id,
      lineCompletions: [{
        lineItemId: line!.id,
        completionDate: '2026-06-01',
        completionTime: 1234.5,
        completedByName: 'A&P 123',
        workDescription: 'Done',
        certType: 'A&P',
        certNumber: '12345',
        tachAtCompletion: 1234.5,
        hobbsAtCompletion: 1500.0,
      }],
      partial: true,
    });

    const r1 = await fetchAs(token, baseURL!, '/api/mx-events/complete', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(r1.status).toBe(200);
    const j1 = await r1.json();

    const r2 = await fetchAs(token, baseURL!, '/api/mx-events/complete', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(r2.status).toBe(200);
    expect(r2.headers.get('x-idempotent-replay')).toBe('true');
    const j2 = await r2.json();
    expect(j2).toEqual(j1);
  });
});

test.describe('mx-events/block — idempotency', () => {
  test('replay returns the cached event id without re-creating the block', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const idemKey = randomUUID();
    const admin = adminClient();

    const body = JSON.stringify({
      aircraftId: seededUser.aircraftId,
      startDate: '2026-07-15',
      endDate: '2026-07-17',
      notes: 'idempotent block probe',
      timeZone: 'America/Los_Angeles',
    });

    const r1 = await fetchAs(token, baseURL!, '/api/mx-events/block', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(r1.status).toBe(200);
    const j1 = await r1.json();

    const r2 = await fetchAs(token, baseURL!, '/api/mx-events/block', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
      body,
    });
    expect(r2.status).toBe(200);
    expect(r2.headers.get('x-idempotent-replay')).toBe('true');
    const j2 = await r2.json();
    expect(j2.eventId).toBe(j1.eventId);

    // Exactly one block event matching the seeded date range.
    const { data: events } = await admin
      .from('aft_maintenance_events')
      .select('id, mechanic_notes')
      .eq('aircraft_id', seededUser.aircraftId)
      .eq('confirmed_date', '2026-07-15');
    expect((events || []).filter(e => e.mechanic_notes === 'idempotent block probe')).toHaveLength(1);
  });
});

import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { createClient } from '@supabase/supabase-js';

/**
 * Portal RPC contracts — get_portal_event + get_portal_squawk.
 *
 * Migration 062 introduced these SECURITY DEFINER RPCs to replace the
 * direct anon-key table reads the portal pages used to perform under
 * the blanket `TO anon USING (true)` policies. The tests assert both:
 *  - happy path: valid token → expected payload shape returned via the
 *    anon client (the same access the live portal pages use)
 *  - security boundary: invalid / missing token → NULL (no data leaks)
 *
 * Locking these contracts in test now means the follow-up migration
 * that drops the anon RLS policies can ship without manual smoke.
 */

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'anon client requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local',
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

test.describe('portal RPCs — token-scoped reads', () => {
  test('get_portal_event returns event + aircraft + line_items + messages for a valid token', async ({ seededUser }) => {
    const admin = adminClient();

    const { data: ev, error: evErr } = await admin
      .from('aft_maintenance_events')
      .insert({
        aircraft_id: seededUser.aircraftId,
        created_by: seededUser.userId,
        status: 'scheduling',
        proposed_date: '2026-12-15',
        proposed_by: 'owner',
        mx_contact_name: 'Test MX',
        mx_contact_email: null,
        primary_contact_name: 'Test Owner',
        primary_contact_email: null,
      })
      .select('id, access_token')
      .single();
    if (evErr) throw new Error(`seed event: ${evErr.message}`);

    // Insert one line item + one message so the response array shapes
    // are exercised, not just defaulted to empty.
    const { error: liErr } = await admin
      .from('aft_event_line_items')
      .insert({
        event_id: ev.id,
        item_type: 'addon',
        item_name: 'Test addon',
        line_status: 'pending',
      });
    if (liErr) throw new Error(`seed line item: ${liErr.message}`);

    const { error: msgErr } = await admin
      .from('aft_event_messages')
      .insert({
        event_id: ev.id,
        sender: 'owner',
        message_type: 'comment',
        message: 'Test comment',
      });
    if (msgErr) throw new Error(`seed message: ${msgErr.message}`);

    const anon = anonClient();
    const { data, error } = await anon.rpc('get_portal_event', { p_token: ev.access_token });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data.event).toBeTruthy();
    expect(data.event.id).toBe(ev.id);
    expect(data.event.access_token).toBe(ev.access_token);
    expect(data.aircraft).toBeTruthy();
    expect(data.aircraft.id).toBe(seededUser.aircraftId);
    expect(Array.isArray(data.line_items)).toBe(true);
    expect(data.line_items.length).toBe(1);
    expect(data.line_items[0].item_name).toBe('Test addon');
    expect(Array.isArray(data.messages)).toBe(true);
    expect(data.messages.length).toBe(1);
    expect(data.messages[0].message).toBe('Test comment');
    expect(Array.isArray(data.squawks)).toBe(true);

    // Teardown
    await admin.from('aft_event_messages').delete().eq('event_id', ev.id);
    await admin.from('aft_event_line_items').delete().eq('event_id', ev.id);
    await admin.from('aft_maintenance_events').delete().eq('id', ev.id);
  });

  test('get_portal_event returns NULL for an unknown token', async () => {
    const anon = anonClient();
    const { data, error } = await anon.rpc('get_portal_event', {
      p_token: 'not-a-real-token-12345678901234567890',
    });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  test('get_portal_event returns NULL for a short / empty token', async () => {
    const anon = anonClient();
    for (const bad of ['', 'abc', 'short']) {
      const { data, error } = await anon.rpc('get_portal_event', { p_token: bad });
      expect(error).toBeNull();
      expect(data).toBeNull();
    }
  });

  test('get_portal_event returns NULL after the event is soft-deleted', async ({ seededUser }) => {
    const admin = adminClient();
    const { data: ev } = await admin
      .from('aft_maintenance_events')
      .insert({
        aircraft_id: seededUser.aircraftId,
        created_by: seededUser.userId,
        status: 'scheduling',
        proposed_date: '2026-12-20',
        proposed_by: 'owner',
        mx_contact_name: 'Test MX',
        mx_contact_email: null,
        primary_contact_name: 'Test Owner',
        primary_contact_email: null,
      })
      .select('id, access_token')
      .single();

    await admin
      .from('aft_maintenance_events')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', ev!.id);

    const anon = anonClient();
    const { data } = await anon.rpc('get_portal_event', { p_token: ev!.access_token });
    expect(data).toBeNull();

    await admin.from('aft_maintenance_events').delete().eq('id', ev!.id);
  });

  test('get_portal_squawk returns squawk + aircraft (limited cols) for a valid token', async ({ seededUser }) => {
    const admin = adminClient();
    const { data: sq, error: sqErr } = await admin
      .from('aft_squawks')
      .insert({
        aircraft_id: seededUser.aircraftId,
        reported_by: seededUser.userId,
        description: 'RPC test squawk',
        location: 'Wing',
        status: 'open',
      })
      .select('id, access_token')
      .single();
    if (sqErr) throw new Error(`seed squawk: ${sqErr.message}`);

    const anon = anonClient();
    const { data, error } = await anon.rpc('get_portal_squawk', { p_token: sq.access_token });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data.squawk).toBeTruthy();
    expect(data.squawk.id).toBe(sq.id);
    expect(data.aircraft).toBeTruthy();
    expect(data.aircraft.tail_number).toBeTruthy();
    // Limited column projection — confirm sensitive operational fields
    // (setup_hobbs, total_engine_time, etc.) didn't sneak in.
    expect(data.aircraft.setup_hobbs).toBeUndefined();
    expect(data.aircraft.total_engine_time).toBeUndefined();
    expect(data.aircraft.time_zone).toBeUndefined();

    await admin.from('aft_squawks').delete().eq('id', sq.id);
  });

  test('get_portal_squawk returns NULL for an unknown token', async () => {
    const anon = anonClient();
    const { data } = await anon.rpc('get_portal_squawk', {
      p_token: 'not-a-real-squawk-token-1234567890',
    });
    expect(data).toBeNull();
  });

  test('get_portal_squawk returns NULL after the squawk is soft-deleted', async ({ seededUser }) => {
    const admin = adminClient();
    const { data: sq } = await admin
      .from('aft_squawks')
      .insert({
        aircraft_id: seededUser.aircraftId,
        reported_by: seededUser.userId,
        description: 'RPC delete-test squawk',
        location: 'Tail',
        status: 'open',
      })
      .select('id, access_token')
      .single();

    await admin
      .from('aft_squawks')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', sq!.id);

    const anon = anonClient();
    const { data } = await anon.rpc('get_portal_squawk', { p_token: sq!.access_token });
    expect(data).toBeNull();

    await admin.from('aft_squawks').delete().eq('id', sq!.id);
  });
});

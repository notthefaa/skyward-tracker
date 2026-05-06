import { test, expect } from '../fixtures/seeded-user';
import { test as crossTest } from '../fixtures/two-users';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * Proposed-action execute flow. The Howard chat UI proposes actions
 * via tools (`propose_note`, `propose_squawk_resolve`, …); the user
 * taps Confirm and `/api/howard/actions/[id] POST` runs the side
 * effect through `executeAction()`. These tests skip the model entirely:
 * we seed `aft_proposed_actions` rows with the same shape Howard
 * would emit, then exercise confirm / cancel / role gates / race
 * conditions. Cost: $0 — no Anthropic call.
 *
 * Coverage:
 *   - note / squawk_resolve / equipment / mx_schedule / onboarding_setup
 *     all execute through the route and produce the right side effect.
 *   - Cross-user 403, already-executed 409, DELETE cancel.
 *   - Concurrent squawk-resolve race: a second confirmer sees `failed`
 *     status, not a silent overwrite of the first resolution.
 */

async function seedThread(userId: string): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin
    .from('aft_howard_threads')
    .insert({ user_id: userId })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed thread: ${error?.message}`);
  return data.id as string;
}

async function seedAction(
  threadId: string,
  userId: string,
  aircraftId: string | null,
  actionType: string,
  payload: Record<string, unknown>,
  requiredRole: 'access' | 'admin' = 'access',
): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin
    .from('aft_proposed_actions')
    .insert({
      thread_id: threadId,
      user_id: userId,
      aircraft_id: aircraftId,
      action_type: actionType,
      payload,
      summary: `${actionType} probe`,
      required_role: requiredRole,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed action ${actionType}: ${error?.message}`);
  return data.id as string;
}

test.describe('howard/actions — execute flow', () => {
  test('confirm `note` → row in aft_notes; status flips to executed', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const threadId = await seedThread(seededUser.userId);
    const actionId = await seedAction(threadId, seededUser.userId, seededUser.aircraftId, 'note', {
      content: 'Howard-proposed maintenance note for the aircraft.',
    });

    const res = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.record?.recordTable).toBe('aft_notes');

    const admin = adminClient();
    const { data: action } = await admin
      .from('aft_proposed_actions')
      .select('status, executed_record_id, executed_record_table, executed_at')
      .eq('id', actionId)
      .single();
    expect(action?.status).toBe('executed');
    expect(action?.executed_record_table).toBe('aft_notes');
    expect(action?.executed_at).not.toBeNull();

    const { data: note } = await admin
      .from('aft_notes')
      .select('aircraft_id, author_id, content')
      .eq('id', action?.executed_record_id)
      .single();
    expect(note?.aircraft_id).toBe(seededUser.aircraftId);
    expect(note?.author_id).toBe(seededUser.userId);
    expect(note?.content).toBe('Howard-proposed maintenance note for the aircraft.');
  });

  test('confirm `squawk_resolve` → squawk status flips; payload.resolution_note recorded', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();
    const { data: sq } = await admin
      .from('aft_squawks')
      .insert({
        aircraft_id: seededUser.aircraftId,
        reported_by: seededUser.userId,
        description: 'Idle stick',
        status: 'open',
        access_token: randomUUID().replace(/-/g, ''),
      })
      .select('id')
      .single();

    const threadId = await seedThread(seededUser.userId);
    const actionId = await seedAction(threadId, seededUser.userId, seededUser.aircraftId, 'squawk_resolve', {
      squawk_id: sq!.id,
      resolution_note: 'Stick swapped during last service.',
    });

    const res = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'POST' });
    expect(res.status).toBe(200);

    const { data: row } = await admin
      .from('aft_squawks')
      .select('status, resolved_note, affects_airworthiness')
      .eq('id', sq!.id)
      .single();
    expect(row?.status).toBe('resolved');
    expect(row?.resolved_note).toBe('Stick swapped during last service.');
    expect(row?.affects_airworthiness).toBe(false);
  });

  test('confirm `equipment` → row in aft_aircraft_equipment with admin gate', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const threadId = await seedThread(seededUser.userId);
    const actionId = await seedAction(
      threadId, seededUser.userId, seededUser.aircraftId, 'equipment',
      {
        name: 'Howard-proposed transponder',
        category: 'transponder',
        make: 'Garmin',
        model: 'GTX 345',
      },
      'admin',
    );

    const res = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'POST' });
    expect(res.status).toBe(200);

    const admin = adminClient();
    const { data: action } = await admin
      .from('aft_proposed_actions')
      .select('executed_record_id, executed_record_table')
      .eq('id', actionId)
      .single();
    expect(action?.executed_record_table).toBe('aft_aircraft_equipment');

    const { data: gear } = await admin
      .from('aft_aircraft_equipment')
      .select('aircraft_id, name, category, make')
      .eq('id', action?.executed_record_id)
      .single();
    expect(gear?.aircraft_id).toBe(seededUser.aircraftId);
    expect(gear?.name).toBe('Howard-proposed transponder');
    expect(gear?.category).toBe('transponder');
    expect(gear?.make).toBe('Garmin');
  });

  test('confirm `mx_schedule` → mx event created with line items from mx_item_ids', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();
    // Seed a maintenance item that will become a line item.
    const { data: mxItem, error: mxErr } = await admin
      .from('aft_maintenance_items')
      .insert({
        aircraft_id: seededUser.aircraftId,
        item_name: 'Howard probe — annual',
        tracking_type: 'date',
        due_date: '2026-12-31',
      })
      .select('id')
      .single();
    if (mxErr || !mxItem) throw new Error(`seed mx item: ${mxErr?.message}`);

    const threadId = await seedThread(seededUser.userId);
    const actionId = await seedAction(
      threadId, seededUser.userId, seededUser.aircraftId, 'mx_schedule',
      { proposed_date: '2026-08-01', mx_item_ids: [mxItem!.id], squawk_ids: [] },
      'admin',
    );

    const res = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.record?.recordTable).toBe('aft_maintenance_events');

    const eventId = body.record?.recordId;
    const { data: event } = await admin
      .from('aft_maintenance_events')
      .select('aircraft_id, status, proposed_date, created_by')
      .eq('id', eventId)
      .single();
    expect(event?.aircraft_id).toBe(seededUser.aircraftId);
    expect(event?.status).toBe('draft');
    expect(event?.proposed_date).toBe('2026-08-01');
    expect(event?.created_by).toBe(seededUser.userId);

    const { data: lines } = await admin
      .from('aft_event_line_items')
      .select('item_type, maintenance_item_id, item_name')
      .eq('event_id', eventId);
    expect((lines || []).length).toBe(1);
    expect(lines?.[0].item_type).toBe('maintenance');
    expect(lines?.[0].maintenance_item_id).toBe(mxItem!.id);
  });

  test('mx_schedule with cross-aircraft mx_item_id is rejected; no line items leak', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();

    // Seed a maintenance item on a DIFFERENT aircraft (foreign).
    const { data: foreignAc } = await admin
      .from('aft_aircraft')
      .insert({
        tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`,
        aircraft_type: 'Foreign Cessna',
        engine_type: 'Piston',
      })
      .select('id')
      .single();
    const { data: foreignMx } = await admin
      .from('aft_maintenance_items')
      .insert({
        aircraft_id: foreignAc!.id,
        item_name: 'Foreign annual',
        tracking_type: 'date',
        due_date: '2026-12-31',
      })
      .select('id')
      .single();

    try {
      const threadId = await seedThread(seededUser.userId);
      const actionId = await seedAction(
        threadId, seededUser.userId, seededUser.aircraftId, 'mx_schedule',
        { proposed_date: '2026-09-01', mx_item_ids: [foreignMx!.id], squawk_ids: [] },
        'admin',
      );

      const res = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'POST' });
      expect(res.status).toBe(500);

      const { data: action } = await admin
        .from('aft_proposed_actions')
        .select('status, error_message')
        .eq('id', actionId)
        .single();
      expect(action?.status).toBe('failed');
      expect(action?.error_message).toMatch(/no longer available/i);

      // No line items should have been inserted for this attempt — the
      // event itself may have landed in draft, but the cross-aircraft
      // splice is what we're guarding against.
      const { data: leakedLines } = await admin
        .from('aft_event_line_items')
        .select('id')
        .eq('squawk_id', foreignMx!.id);
      expect((leakedLines || []).length).toBe(0);
    } finally {
      await admin.from('aft_maintenance_items').delete().eq('id', foreignMx!.id);
      await admin.from('aft_aircraft').delete().eq('id', foreignAc!.id);
    }
  });

  test('mx_schedule with deleted mx_item_id surfaces a clear error', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();

    // Item exists at proposal time, soft-deleted before confirm.
    const { data: mxItem } = await admin
      .from('aft_maintenance_items')
      .insert({
        aircraft_id: seededUser.aircraftId,
        item_name: 'Will be soft-deleted',
        tracking_type: 'date',
        due_date: '2026-12-31',
      })
      .select('id')
      .single();
    await admin
      .from('aft_maintenance_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', mxItem!.id);

    const threadId = await seedThread(seededUser.userId);
    const actionId = await seedAction(
      threadId, seededUser.userId, seededUser.aircraftId, 'mx_schedule',
      { proposed_date: '2026-09-01', mx_item_ids: [mxItem!.id], squawk_ids: [] },
      'admin',
    );

    const res = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'POST' });
    expect(res.status).toBe(500);

    const { data: action } = await admin
      .from('aft_proposed_actions')
      .select('status, error_message')
      .eq('id', actionId)
      .single();
    expect(action?.status).toBe('failed');
    expect(action?.error_message).toMatch(/no longer available/i);
  });

  test('replay (POST on already-executed action) returns 409', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const threadId = await seedThread(seededUser.userId);
    const actionId = await seedAction(threadId, seededUser.userId, seededUser.aircraftId, 'note', {
      content: 'Replay-409 probe',
    });

    const r1 = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'POST' });
    expect(r1.status).toBe(200);
    const r2 = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'POST' });
    expect(r2.status).toBe(409);
    const body = await r2.json();
    expect(body.error).toMatch(/executed/i);
  });

  test('DELETE cancels a pending action; re-cancel returns 409', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const threadId = await seedThread(seededUser.userId);
    const actionId = await seedAction(threadId, seededUser.userId, seededUser.aircraftId, 'note', {
      content: 'Cancel probe',
    });

    const r1 = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'DELETE' });
    expect(r1.status).toBe(200);

    const admin = adminClient();
    const { data: action } = await admin
      .from('aft_proposed_actions')
      .select('status, cancelled_at')
      .eq('id', actionId)
      .single();
    expect(action?.status).toBe('cancelled');
    expect(action?.cancelled_at).not.toBeNull();

    const r2 = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'DELETE' });
    expect(r2.status).toBe(409);
  });

  test('squawk_resolve race — already-resolved squawk leaves action `failed` with retry path', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const admin = adminClient();
    // Pre-resolve the squawk so the executor's `.eq('status','open')`
    // guard misses, simulating a concurrent resolution between
    // proposal and confirmation.
    const { data: sq } = await admin
      .from('aft_squawks')
      .insert({
        aircraft_id: seededUser.aircraftId,
        reported_by: seededUser.userId,
        description: 'Race-test squawk',
        status: 'resolved',
        affects_airworthiness: false,
        resolved_note: 'Already taken care of.',
        access_token: randomUUID().replace(/-/g, ''),
      })
      .select('id')
      .single();

    const threadId = await seedThread(seededUser.userId);
    const actionId = await seedAction(threadId, seededUser.userId, seededUser.aircraftId, 'squawk_resolve', {
      squawk_id: sq!.id,
      resolution_note: 'Howard tried to resolve too late.',
    });

    const res = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'POST' });
    expect(res.status).toBe(500);

    const { data: action } = await admin
      .from('aft_proposed_actions')
      .select('status, error_message')
      .eq('id', actionId)
      .single();
    expect(action?.status).toBe('failed');
    expect(action?.error_message).toMatch(/already resolved/i);

    // Original resolution preserved — not stomped by our late attempt.
    const { data: row } = await admin
      .from('aft_squawks')
      .select('resolved_note')
      .eq('id', sq!.id)
      .single();
    expect(row?.resolved_note).toBe('Already taken care of.');
  });
});

crossTest.describe('howard/actions — cross-user', () => {
  crossTest('user B cannot confirm user A action (403)', async ({ userA, userB, baseURL }) => {
    const admin = adminClient();
    const { data: thread } = await admin
      .from('aft_howard_threads').insert({ user_id: userA.userId }).select('id').single();
    const { data: action } = await admin
      .from('aft_proposed_actions').insert({
        thread_id: thread!.id,
        user_id: userA.userId,
        aircraft_id: userA.aircraftId,
        action_type: 'note',
        payload: { content: 'A-only note' },
        summary: 'note probe',
        required_role: 'access',
        status: 'pending',
      }).select('id').single();

    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, `/api/howard/actions/${action!.id}`, { method: 'POST' });
    expect(res.status).toBe(403);

    // Note never landed.
    const { data: row } = await admin
      .from('aft_proposed_actions').select('status').eq('id', action!.id).single();
    expect(row?.status).toBe('pending');
  });

  crossTest('user B cannot DELETE user A pending action (403)', async ({ userA, userB, baseURL }) => {
    const admin = adminClient();
    const { data: thread } = await admin
      .from('aft_howard_threads').insert({ user_id: userA.userId }).select('id').single();
    const { data: action } = await admin
      .from('aft_proposed_actions').insert({
        thread_id: thread!.id,
        user_id: userA.userId,
        aircraft_id: userA.aircraftId,
        action_type: 'note',
        payload: { content: 'A-only note' },
        summary: 'note probe',
        required_role: 'access',
        status: 'pending',
      }).select('id').single();

    const tokenB = await getAccessToken(userB.email, userB.password);
    const res = await fetchAs(tokenB, baseURL!, `/api/howard/actions/${action!.id}`, { method: 'DELETE' });
    expect(res.status).toBe(403);
  });
});

test.describe('howard/actions — onboarding_setup (no aircraft yet)', () => {
  test('onboarding_setup creates aircraft + admin access for fresh user', async ({ baseURL }) => {
    // Bootstrap a brand-new user with NO aircraft (the seededUser
    // fixture creates one already, which would conflict with onboarding).
    const admin = adminClient();
    const email = `e2e-onboard-${randomUUID()}@skyward-test.local`;
    const password = `pw-${randomUUID().slice(0, 12)}`;
    const tail = `N${randomUUID().slice(0, 5).toUpperCase()}`;

    const { data: u } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    const userId = u!.user!.id;

    try {
      // The auth.users insert trigger normally creates aft_user_roles
      // with role='pilot'. Upsert here so we win the race if it hasn't
      // landed yet, and don't 23505 if it has. The route only needs a
      // resolvable user_id; faa_ratings + completed_onboarding land via
      // the executor itself.
      await admin
        .from('aft_user_roles')
        .upsert(
          { user_id: userId, role: 'pilot', email },
          { onConflict: 'user_id' },
        );

      const threadId = await seedThread(userId);
      // aircraft_id is NULL for onboarding_setup — the executor creates it.
      const actionId = await seedAction(
        threadId, userId, null, 'onboarding_setup',
        {
          profile: {
            full_name: 'Howard Onboardee',
            initials: 'HO',
            faa_ratings: ['PPL', 'IFR'],
          },
          aircraft: {
            tail_number: tail,
            make: 'Cessna',
            model: '172S',
            engine_type: 'Piston',
            is_ifr_equipped: true,
            home_airport: 'KOAK',
            setup_aftt: 1500,
            setup_ftt: 1500,
          },
        },
        'access',
      );

      const token = await getAccessToken(email, password);
      const res = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.record?.recordTable).toBe('aft_aircraft');

      // Aircraft created with normalized tail.
      const { data: aircraft } = await admin
        .from('aft_aircraft')
        .select('id, tail_number, make, model, engine_type, is_ifr_equipped, total_airframe_time, total_engine_time, created_by')
        .eq('id', body.record.recordId)
        .single();
      expect(aircraft?.tail_number).toBe(tail.toUpperCase());
      expect(aircraft?.make).toBe('Cessna');
      expect(aircraft?.model).toBe('172S');
      expect(aircraft?.engine_type).toBe('Piston');
      expect(aircraft?.is_ifr_equipped).toBe(true);
      expect(Number(aircraft?.total_airframe_time)).toBe(1500);
      expect(Number(aircraft?.total_engine_time)).toBe(1500);
      expect(aircraft?.created_by).toBe(userId);

      // Access grant minted as admin — the executor's hard-coded role.
      const { data: access } = await admin
        .from('aft_user_aircraft_access')
        .select('aircraft_role')
        .eq('user_id', userId)
        .eq('aircraft_id', aircraft!.id)
        .single();
      expect(access?.aircraft_role).toBe('admin');

      // Profile upsert: completed_onboarding flipped + ratings persisted.
      const { data: role } = await admin
        .from('aft_user_roles')
        .select('full_name, initials, faa_ratings, completed_onboarding')
        .eq('user_id', userId)
        .single();
      expect(role?.full_name).toBe('Howard Onboardee');
      expect(role?.initials).toBe('HO');
      expect(role?.faa_ratings).toEqual(['PPL', 'IFR']);
      expect(role?.completed_onboarding).toBe(true);

      // Cleanup the bonus aircraft (FK on auth.users delete cascades the
      // user_role + access row, but aft_aircraft has its own ownership).
      await admin.from('aft_aircraft').delete().eq('id', aircraft!.id);
    } finally {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    }
  });
});

import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * /api/howard/actions/[id] POST + DELETE idempotency + ordering invariant.
 *
 * The route already has terminal-state guards (POST 409 on cancelled /
 * executed; DELETE 409 on non-pending). What's missing is idempotency:
 * a legitimate network-retry of a successful confirm/cancel — same
 * X-Idempotency-Key — returns 409 instead of the cached 200, because
 * the original call already flipped status to 'executed'/'cancelled'.
 * Slow-network double-taps on the Confirm button surface to the user
 * as `Action already executed.` even though the action succeeded.
 *
 * Ordering invariant (per feedback_deleted_at_vs_cancelled_status):
 *   idem.check() MUST run BEFORE any terminal-status guard. Otherwise
 *   the cached-replay path becomes unreachable.
 *
 * Coverage:
 *   - POST replay with same idemKey returns cached 200 + replay header
 *   - DELETE replay with same idemKey returns cached 200 + replay header
 *   - aft_idempotency_keys row lands with route='howard/actions/POST' and
 *     'howard/actions/DELETE' respectively (no cross-route cache hits)
 *   - regression: POST without idemKey on already-executed → 409
 *   - regression: DELETE without idemKey on already-cancelled → 409
 *   - regression: pending action with NEW idemKey still executes
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

async function seedNoteAction(
  userId: string,
  aircraftId: string,
  threadId: string,
): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin
    .from('aft_proposed_actions')
    .insert({
      thread_id: threadId,
      user_id: userId,
      aircraft_id: aircraftId,
      action_type: 'note',
      payload: { content: 'Idempotency probe — single-shot note.' },
      summary: 'note probe',
      required_role: 'access',
      status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed action: ${error?.message}`);
  return data.id as string;
}

test.describe('howard/actions — idempotency + ordering invariant', () => {
  test('POST replay with same idempotency key returns cached 200 (not 409)', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const threadId = await seedThread(seededUser.userId);
    const actionId = await seedNoteAction(seededUser.userId, seededUser.aircraftId, threadId);

    const idemKey = randomUUID();

    const res1 = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.success).toBe(true);
    const recordId1 = body1.record?.recordId;

    // Replay — same key. Without idempotency this returns 409
    // because action.status is now 'executed'. With idempotency it
    // returns the cached 200 with the same body.
    const res2 = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
    });
    expect(res2.status).toBe(200);
    expect(res2.headers.get('x-idempotent-replay')).toBe('true');
    const body2 = await res2.json();
    expect(body2.success).toBe(true);
    expect(body2.record?.recordId).toBe(recordId1);

    // Side effect ran exactly once — only one note exists for this content.
    const admin = adminClient();
    const { data: notes } = await admin
      .from('aft_notes')
      .select('id')
      .eq('aircraft_id', seededUser.aircraftId)
      .eq('content', 'Idempotency probe — single-shot note.');
    expect((notes || []).length).toBe(1);

    // Cache row landed with the right route scope.
    const { data: idemRow } = await admin
      .from('aft_idempotency_keys')
      .select('route, response_status')
      .eq('user_id', seededUser.userId)
      .eq('key', idemKey)
      .single();
    expect(idemRow?.route).toBe('howard/actions/POST');
    expect(idemRow?.response_status).toBe(200);
  });

  test('DELETE replay with same idempotency key returns cached 200 (not 409)', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const threadId = await seedThread(seededUser.userId);
    const actionId = await seedNoteAction(seededUser.userId, seededUser.aircraftId, threadId);

    const idemKey = randomUUID();

    const res1 = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, {
      method: 'DELETE',
      headers: { 'X-Idempotency-Key': idemKey },
    });
    expect(res1.status).toBe(200);

    const res2 = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, {
      method: 'DELETE',
      headers: { 'X-Idempotency-Key': idemKey },
    });
    expect(res2.status).toBe(200);
    expect(res2.headers.get('x-idempotent-replay')).toBe('true');

    // Final state: cancelled, with cancelled_at set exactly once. We
    // can't directly assert the row was UPDATEd once vs twice without
    // a counter, but the idempotency cache guarantees the second call
    // never reached the UPDATE statement.
    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_proposed_actions')
      .select('status, cancelled_at')
      .eq('id', actionId)
      .single();
    expect(row?.status).toBe('cancelled');
    expect(row?.cancelled_at).not.toBeNull();

    const { data: idemRow } = await admin
      .from('aft_idempotency_keys')
      .select('route, response_status')
      .eq('user_id', seededUser.userId)
      .eq('key', idemKey)
      .single();
    expect(idemRow?.route).toBe('howard/actions/DELETE');
    expect(idemRow?.response_status).toBe(200);
  });

  test('POST and DELETE keys do not cross-cache (route-scoped lookup)', async ({ seededUser, baseURL }) => {
    // A client that reuses a UUID across two surfaces (unlikely but
    // possible in handcrafted tools) MUST get a fresh response on
    // each route — the cache row's `route` column scopes the lookup.
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const threadId = await seedThread(seededUser.userId);
    const a1 = await seedNoteAction(seededUser.userId, seededUser.aircraftId, threadId);
    const a2 = await seedNoteAction(seededUser.userId, seededUser.aircraftId, threadId);
    const idemKey = randomUUID();

    const r1 = await fetchAs(token, baseURL!, `/api/howard/actions/${a1}`, {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idemKey },
    });
    expect(r1.status).toBe(200);

    // DELETE on a DIFFERENT action with the SAME key — must NOT replay
    // the POST cache. Should run a fresh cancel.
    const r2 = await fetchAs(token, baseURL!, `/api/howard/actions/${a2}`, {
      method: 'DELETE',
      headers: { 'X-Idempotency-Key': idemKey },
    });
    expect(r2.status).toBe(200);
    expect(r2.headers.get('x-idempotent-replay')).not.toBe('true');

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_proposed_actions')
      .select('status')
      .eq('id', a2)
      .single();
    expect(row?.status).toBe('cancelled');
  });

  test('regression: POST without idemKey on already-executed action still returns 409', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const threadId = await seedThread(seededUser.userId);
    const actionId = await seedNoteAction(seededUser.userId, seededUser.aircraftId, threadId);

    const r1 = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'POST' });
    expect(r1.status).toBe(200);

    const r2 = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'POST' });
    expect(r2.status).toBe(409);
    const body = await r2.json();
    expect(body.error).toMatch(/executed/i);
  });

  test('regression: DELETE without idemKey on already-cancelled action still returns 409', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const threadId = await seedThread(seededUser.userId);
    const actionId = await seedNoteAction(seededUser.userId, seededUser.aircraftId, threadId);

    const r1 = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'DELETE' });
    expect(r1.status).toBe(200);

    const r2 = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, { method: 'DELETE' });
    expect(r2.status).toBe(409);
    const body = await r2.json();
    expect(body.error).toMatch(/cancelled/i);
  });

  test('regression: POST on a fresh pending action with a new key still executes', async ({ seededUser, baseURL }) => {
    // Sanity check that idempotency wiring didn't break the happy path.
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const threadId = await seedThread(seededUser.userId);
    const actionId = await seedNoteAction(seededUser.userId, seededUser.aircraftId, threadId);

    const res = await fetchAs(token, baseURL!, `/api/howard/actions/${actionId}`, {
      method: 'POST',
      headers: { 'X-Idempotency-Key': randomUUID() },
    });
    expect(res.status).toBe(200);

    const admin = adminClient();
    const { data: action } = await admin
      .from('aft_proposed_actions')
      .select('status, executed_record_table')
      .eq('id', actionId)
      .single();
    expect(action?.status).toBe('executed');
    expect(action?.executed_record_table).toBe('aft_notes');
  });
});

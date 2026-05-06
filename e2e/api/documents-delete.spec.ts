import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * Phase 6 — documents DELETE.
 *
 * Documents POST is upload + pdf-parse + OpenAI embedding (paid). We
 * skip end-to-end POST coverage to keep test cost down; instead we
 * pre-seed a doc + chunks via admin client and exercise the DELETE
 * path that was hardened in commit `bc0cafe` to throw on chunk-delete
 * + soft-delete failures (so Howard's RAG stops citing deleted docs).
 *
 * For end-to-end POST testing, run the upload via the UI manually —
 * the route is well-instrumented but each test would burn ~$0.005.
 */
test.describe('documents API — DELETE chunks + soft-delete', () => {
  test('admin deletes a doc → chunks gone, doc soft-deleted', async ({ seededUser, baseURL }) => {
    const admin = adminClient();

    // Pre-seed a document + chunks. embedding=NULL is fine for DELETE.
    const { data: doc } = await admin
      .from('aft_documents')
      .insert({
        aircraft_id: seededUser.aircraftId,
        user_id: seededUser.userId,
        filename: 'test-poh.pdf',
        file_url: 'https://example.com/test-poh.pdf',
        doc_type: 'POH',
        status: 'ready',
        page_count: 3,
        sha256: randomUUID().replace(/-/g, ''),
        file_size: 1024,
      })
      .select('id')
      .single();
    const docId = doc!.id as string;

    // Insert 3 chunks (no embedding vector — DELETE doesn't care).
    const chunks = Array.from({ length: 3 }, (_, i) => ({
      document_id: docId,
      chunk_index: i,
      content: `Test chunk ${i + 1}`,
      page_number: i + 1,
    }));
    await admin.from('aft_document_chunks').insert(chunks);

    const { count: chunkCountBefore } = await admin
      .from('aft_document_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', docId);
    expect(chunkCountBefore).toBe(3);

    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/documents', {
      method: 'DELETE',
      body: JSON.stringify({ documentId: docId, aircraftId: seededUser.aircraftId }),
    });
    expect(res.status).toBe(200);

    // Chunks must be gone (hard-deleted) so Howard's RAG match_chunks
    // RPC stops surfacing them.
    const { count: chunkCountAfter } = await admin
      .from('aft_document_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', docId);
    expect(chunkCountAfter).toBe(0);

    // Document row must be soft-deleted (kept for audit/history).
    const { data: docAfter } = await admin
      .from('aft_documents')
      .select('deleted_at, deleted_by')
      .eq('id', docId)
      .single();
    expect(docAfter?.deleted_at).not.toBeNull();
    expect(docAfter?.deleted_by).toBe(seededUser.userId);
  });

  test('cross-aircraft DELETE rejected with 404', async ({ seededUser, baseURL }) => {
    const admin = adminClient();

    // Make a separate aircraft with a doc on it.
    const otherEmail = `e2e-other-${randomUUID()}@skyward-test.local`;
    const { data: otherU } = await admin.auth.admin.createUser({
      email: otherEmail, password: 'pw-other-12345', email_confirm: true,
    });
    const otherUserId = otherU!.user!.id;
    const { data: otherAc, error: rpcErr } = await admin.rpc('create_aircraft_atomic', {
      p_user_id: otherUserId,
      p_payload: {
        tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`,
        aircraft_type: 'Cessna 172S', engine_type: 'Piston',
      },
    });
    if (rpcErr) throw new Error(`create_aircraft: ${rpcErr.message}`);
    const otherAircraftId = (otherAc as { id: string }).id;

    const { data: foreignDoc } = await admin
      .from('aft_documents')
      .insert({
        aircraft_id: otherAircraftId,
        user_id: otherUserId,
        filename: 'foreign-poh.pdf',
        file_url: 'https://example.com/foreign-poh.pdf',
        doc_type: 'POH',
        status: 'ready',
      })
      .select('id')
      .single();

    const token = await getAccessToken(seededUser.email, seededUser.password);
    // Spoof: send seededUser's aircraftId paired with otherAircraft's docId.
    const res = await fetchAs(token, baseURL!, '/api/documents', {
      method: 'DELETE',
      body: JSON.stringify({ documentId: foreignDoc!.id, aircraftId: seededUser.aircraftId }),
    });
    expect(res.status).toBe(404);

    // Foreign doc must NOT be soft-deleted.
    const { data: docAfter } = await admin
      .from('aft_documents')
      .select('deleted_at')
      .eq('id', foreignDoc!.id)
      .single();
    expect(docAfter?.deleted_at).toBeNull();

    // Cleanup.
    await admin.from('aft_documents').delete().eq('id', foreignDoc!.id);
    await admin.from('aft_aircraft').delete().eq('id', otherAircraftId);
    await admin.auth.admin.deleteUser(otherUserId).then(undefined, () => {});
  });

  test('GET lists docs scoped to the caller aircraft', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { data: doc } = await admin
      .from('aft_documents')
      .insert({
        aircraft_id: seededUser.aircraftId,
        user_id: seededUser.userId,
        filename: 'list-test.pdf',
        file_url: 'https://example.com/list-test.pdf',
        doc_type: 'POH',
        status: 'ready',
      })
      .select('id, filename')
      .single();

    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, `/api/documents?aircraftId=${seededUser.aircraftId}`, {
      method: 'GET',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const docs = body.documents || body;
    const found = (Array.isArray(docs) ? docs : []).some((d: any) => d.id === doc!.id);
    expect(found).toBe(true);

    // Cleanup.
    await admin.from('aft_documents').delete().eq('id', doc!.id);
  });
});

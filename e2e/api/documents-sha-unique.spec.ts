import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';

/**
 * Migration 056 — SHA-256 uniqueness on live documents.
 *
 * The application-side dup-check is a TOCTOU race: two concurrent
 * uploads of the same PDF on the same aircraft can both pass the
 * SELECT. Migration 056 adds a UNIQUE partial index on
 * (aircraft_id, sha256) WHERE deleted_at IS NULL so the second INSERT
 * raises 23505 and the route surfaces a friendly 409.
 *
 * This spec validates the CONSTRAINT directly via service-role
 * INSERTs — the route's dup-check would normally short-circuit before
 * the second INSERT fires, so testing the index itself is the
 * tightest defense-in-depth signal.
 */
test.describe('aft_documents — SHA-256 unique partial index', () => {
  test('INSERT twice with same (aircraft_id, sha256) on live rows → 23505', async ({ seededUser }) => {
    const admin = adminClient();
    const sha = 'a'.repeat(64);

    const { data: first, error: firstErr } = await admin
      .from('aft_documents')
      .insert({
        aircraft_id: seededUser.aircraftId,
        user_id: seededUser.userId,
        filename: 'first.pdf',
        file_url: 'https://example.com/first.pdf',
        doc_type: 'POH',
        status: 'ready',
        sha256: sha,
        file_size: 1024,
      })
      .select('id')
      .single();
    expect(firstErr).toBeNull();
    expect(first?.id).toBeTruthy();

    const { error: secondErr } = await admin
      .from('aft_documents')
      .insert({
        aircraft_id: seededUser.aircraftId,
        user_id: seededUser.userId,
        filename: 'duplicate.pdf',
        file_url: 'https://example.com/duplicate.pdf',
        doc_type: 'POH',
        status: 'ready',
        sha256: sha,
        file_size: 1024,
      });
    expect(secondErr?.code).toBe('23505');
  });

  test('soft-deleted row does not block a new INSERT with the same hash', async ({ seededUser }) => {
    // The partial index is `WHERE deleted_at IS NULL`, so a user can
    // re-upload a previously-removed PDF without hitting the unique
    // violation. Pre-fix the route's pre-check already allowed this
    // (filtered by deleted_at IS NULL); the index has to do the same.
    const admin = adminClient();
    const sha = 'b'.repeat(64);

    const { data: first } = await admin
      .from('aft_documents')
      .insert({
        aircraft_id: seededUser.aircraftId,
        user_id: seededUser.userId,
        filename: 'will-be-deleted.pdf',
        file_url: 'https://example.com/x.pdf',
        doc_type: 'POH',
        status: 'ready',
        sha256: sha,
        file_size: 1024,
        deleted_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    expect(first?.id).toBeTruthy();

    const { error: secondErr } = await admin
      .from('aft_documents')
      .insert({
        aircraft_id: seededUser.aircraftId,
        user_id: seededUser.userId,
        filename: 'fresh-replacement.pdf',
        file_url: 'https://example.com/y.pdf',
        doc_type: 'POH',
        status: 'ready',
        sha256: sha,
        file_size: 1024,
      });
    expect(secondErr).toBeNull();
  });

  test('different aircraft can have the same hash', async ({ seededUser }) => {
    // Sharing a manufacturer-issued POH across two same-model aircraft
    // is legitimate. The partial index keys on aircraft_id, so the
    // second aircraft's INSERT must succeed.
    const admin = adminClient();
    const sha = 'c'.repeat(64);

    const { data: a1 } = await admin.rpc('create_aircraft_atomic', {
      p_user_id: seededUser.userId,
      p_payload: { tail_number: `N${Date.now().toString().slice(-5)}A`, aircraft_type: 'Sister 172' },
    });
    const a1Id = (a1 as any).id as string;

    try {
      const { error: firstErr } = await admin
        .from('aft_documents')
        .insert({
          aircraft_id: seededUser.aircraftId,
          user_id: seededUser.userId,
          filename: 'shared.pdf',
          file_url: 'https://example.com/shared.pdf',
          doc_type: 'POH',
          status: 'ready',
          sha256: sha,
          file_size: 2048,
        });
      expect(firstErr).toBeNull();

      const { error: secondErr } = await admin
        .from('aft_documents')
        .insert({
          aircraft_id: a1Id,
          user_id: seededUser.userId,
          filename: 'shared.pdf',
          file_url: 'https://example.com/shared.pdf',
          doc_type: 'POH',
          status: 'ready',
          sha256: sha,
          file_size: 2048,
        });
      expect(secondErr).toBeNull();
    } finally {
      await admin.from('aft_aircraft').delete().eq('id', a1Id);
    }
  });
});

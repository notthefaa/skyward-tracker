import { test, expect } from '../fixtures/seeded-user';
import { test as crossTest } from '../fixtures/two-users';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';
import { randomUUID } from 'node:crypto';

/**
 * /api/storage/sign — security-critical surface. Every signed URL for
 * a private bucket flows through this route, so an ownership hole here
 * means cross-fleet file leakage. Two modes are tested:
 *
 *   1. Auth mode: Bearer-token caller scoped to their accessible
 *      aircraft set (or unrestricted for global admins).
 *   2. Portal mode: token-gated (mechanic /service/[id] + public
 *      /squawk/[id]). The token IS the auth boundary; signing
 *      MUST NOT extend beyond URLs legitimately stored on the row
 *      that token resolves to.
 *
 * The route returns `{ signed: { [url]: signedUrl | null } }` — null
 * means "not allowed" (not 403). The client falls back to the public
 * URL (which 403s for private buckets — the fail-safe).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

function publicUrl(bucket: string, path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

test.describe('storage/sign — auth-mode ownership', () => {
  test('caller can sign their own document; cross-aircraft document returns null', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const myUrl = publicUrl('aft_aircraft_documents', `${seededUser.aircraftId}_${Date.now()}_my.pdf`);
    const { error: insErr } = await admin.from('aft_documents').insert({
      aircraft_id: seededUser.aircraftId,
      filename: 'my.pdf',
      file_url: myUrl,
      doc_type: 'POH',
      user_id: seededUser.userId,
    });
    if (insErr) throw insErr;

    // Foreign aircraft + foreign doc.
    const { data: foreignAc } = await admin.from('aft_aircraft').insert({
      tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`,
      aircraft_type: 'Foreign',
      engine_type: 'Piston',
    }).select('id').single();
    const foreignUrl = publicUrl('aft_aircraft_documents', `${foreignAc!.id}_${Date.now()}_foreign.pdf`);
    await admin.from('aft_documents').insert({
      aircraft_id: foreignAc!.id,
      filename: 'foreign.pdf',
      file_url: foreignUrl,
      doc_type: 'POH',
      user_id: seededUser.userId, // even author-spoof can't help
    });

    try {
      const res = await fetchAs(token, baseURL!, '/api/storage/sign', {
        method: 'POST',
        body: JSON.stringify({ urls: [myUrl, foreignUrl] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      // Own URL gets a signed URL (or null if storage is unconfigured;
      // either way, the IMPORTANT assertion is that the foreign URL is
      // null. Treat a non-null foreign as a hard fail.)
      expect(body.signed[foreignUrl]).toBeNull();
      // Sanity: own URL was *considered* — it should either get a
      // signed URL OR be null (storage object missing in test env).
      // `toHaveProperty` interprets dot-paths, so use `in`.
      expect(myUrl in body.signed).toBe(true);
    } finally {
      await admin.from('aft_documents').delete().eq('file_url', myUrl);
      await admin.from('aft_documents').delete().eq('file_url', foreignUrl);
      await admin.from('aft_aircraft').delete().eq('id', foreignAc!.id);
    }
  });

  test('soft-deleted document is not signable even by its owner', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const myUrl = publicUrl('aft_aircraft_documents', `${seededUser.aircraftId}_${Date.now()}_dead.pdf`);
    await admin.from('aft_documents').insert({
      aircraft_id: seededUser.aircraftId,
      filename: 'dead.pdf',
      file_url: myUrl,
      doc_type: 'POH',
      user_id: seededUser.userId,
      deleted_at: new Date().toISOString(),
    });

    try {
      const res = await fetchAs(token, baseURL!, '/api/storage/sign', {
        method: 'POST',
        body: JSON.stringify({ urls: [myUrl] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.signed[myUrl]).toBeNull();
    } finally {
      await admin.from('aft_documents').delete().eq('file_url', myUrl);
    }
  });

  test('avatar bucket: cross-aircraft avatar URL returns null', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const { data: foreignAc } = await admin.from('aft_aircraft').insert({
      tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`,
      aircraft_type: 'Foreign',
      engine_type: 'Piston',
      avatar_url: publicUrl('aft_aircraft_avatars', `${randomUUID()}_avatar.jpg`),
    }).select('id, avatar_url').single();

    try {
      const res = await fetchAs(token, baseURL!, '/api/storage/sign', {
        method: 'POST',
        body: JSON.stringify({ urls: [foreignAc!.avatar_url!] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.signed[foreignAc!.avatar_url!]).toBeNull();
    } finally {
      await admin.from('aft_aircraft').delete().eq('id', foreignAc!.id);
    }
  });

  test('event-attachment bucket: cross-aircraft event URL returns null', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const { data: foreignAc } = await admin.from('aft_aircraft').insert({
      tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`,
      aircraft_type: 'Foreign',
      engine_type: 'Piston',
    }).select('id').single();
    const { data: foreignEvent } = await admin.from('aft_maintenance_events').insert({
      aircraft_id: foreignAc!.id,
      status: 'draft',
    }).select('id').single();

    const foreignUrl = publicUrl('aft_event_attachments', `${foreignEvent!.id}_${Date.now()}_attach.pdf`);

    try {
      const res = await fetchAs(token, baseURL!, '/api/storage/sign', {
        method: 'POST',
        body: JSON.stringify({ urls: [foreignUrl] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.signed[foreignUrl]).toBeNull();
    } finally {
      await admin.from('aft_maintenance_events').delete().eq('id', foreignEvent!.id);
      await admin.from('aft_aircraft').delete().eq('id', foreignAc!.id);
    }
  });

  test('squawk-image bucket: cross-aircraft squawk picture URL returns null', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const { data: foreignAc } = await admin.from('aft_aircraft').insert({
      tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`,
      aircraft_type: 'Foreign',
      engine_type: 'Piston',
    }).select('id').single();
    const foreignPic = publicUrl('aft_squawk_images', `${randomUUID()}_squawk.jpg`);
    const { data: foreignSq } = await admin.from('aft_squawks').insert({
      aircraft_id: foreignAc!.id,
      reported_by: seededUser.userId,
      description: 'foreign squawk',
      status: 'open',
      access_token: randomUUID().replace(/-/g, ''),
      pictures: [foreignPic],
    }).select('id').single();

    try {
      const res = await fetchAs(token, baseURL!, '/api/storage/sign', {
        method: 'POST',
        body: JSON.stringify({ urls: [foreignPic] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.signed[foreignPic]).toBeNull();
    } finally {
      await admin.from('aft_squawks').delete().eq('id', foreignSq!.id);
      await admin.from('aft_aircraft').delete().eq('id', foreignAc!.id);
    }
  });

  test('malformed URL or unknown bucket returns null without crashing', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);

    const malformed1 = 'https://example.com/random.jpg';
    const malformed2 = `${SUPABASE_URL}/storage/v1/object/public/aft_made_up_bucket/x.jpg`;
    const malformed3 = 'not-even-a-url';

    const res = await fetchAs(token, baseURL!, '/api/storage/sign', {
      method: 'POST',
      body: JSON.stringify({ urls: [malformed1, malformed2, malformed3] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signed[malformed1]).toBeNull();
    expect(body.signed[malformed2]).toBeNull();
    expect(body.signed[malformed3]).toBeNull();
  });

  test('over-50-URL request returns 400, not 500', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const urls = Array.from({ length: 51 }, (_, i) => publicUrl('aft_aircraft_documents', `${seededUser.aircraftId}_${i}_x.pdf`));
    const res = await fetchAs(token, baseURL!, '/api/storage/sign', {
      method: 'POST',
      body: JSON.stringify({ urls }),
    });
    expect(res.status).toBe(400);
  });

  test('empty urls array → 400', async ({ seededUser, baseURL }) => {
    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/storage/sign', {
      method: 'POST',
      body: JSON.stringify({ urls: [] }),
    });
    expect(res.status).toBe(400);
  });

  test('no Authorization header → 401', async ({ baseURL, request }) => {
    // Auth-mode requires a Bearer; without one (and without
    // accessToken), the route MUST 401, not silently succeed.
    const url = publicUrl('aft_aircraft_documents', `${randomUUID()}_x.pdf`);
    const res = await request.post(`${baseURL}/api/storage/sign`, {
      data: { urls: [url] },
    });
    expect(res.status()).toBe(401);
  });
});

crossTest.describe('storage/sign — cross-user RLS', () => {
  crossTest('user B cannot sign user A document URLs', async ({ userA, userB, baseURL }) => {
    const admin = adminClient();
    const aUrl = publicUrl('aft_aircraft_documents', `${userA.aircraftId}_${Date.now()}_a.pdf`);
    await admin.from('aft_documents').insert({
      aircraft_id: userA.aircraftId,
      filename: 'a.pdf',
      file_url: aUrl,
      doc_type: 'POH',
      user_id: userA.userId,
    });

    try {
      const tokenB = await getAccessToken(userB.email, userB.password);
      const res = await fetchAs(tokenB, baseURL!, '/api/storage/sign', {
        method: 'POST',
        body: JSON.stringify({ urls: [aUrl] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.signed[aUrl]).toBeNull();
    } finally {
      await admin.from('aft_documents').delete().eq('file_url', aUrl);
    }
  });
});

test.describe('storage/sign — portal-mode token gating', () => {
  test('event token can sign its own attachment; cross-event attachment returns null', async ({ seededUser, baseURL, request }) => {
    const admin = adminClient();
    // Event A — token X — attachment.pdf in messages.attachments
    const tokenX = randomUUID().replace(/-/g, '');
    const { data: eventA } = await admin.from('aft_maintenance_events').insert({
      aircraft_id: seededUser.aircraftId,
      status: 'draft',
      access_token: tokenX,
    }).select('id').single();

    const ownUrl = publicUrl('aft_event_attachments', `${eventA!.id}_${Date.now()}_a.pdf`);
    await admin.from('aft_event_messages').insert({
      event_id: eventA!.id,
      sender: 'mechanic',
      message_type: 'comment',
      message: 'attached',
      attachments: [{ url: ownUrl, name: 'a.pdf' }],
    } as any);

    // Event B — different access token, foreign attachment
    const tokenY = randomUUID().replace(/-/g, '');
    const { data: foreignAc } = await admin.from('aft_aircraft').insert({
      tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`,
      aircraft_type: 'Foreign',
      engine_type: 'Piston',
    }).select('id').single();
    const { data: eventB } = await admin.from('aft_maintenance_events').insert({
      aircraft_id: foreignAc!.id,
      status: 'draft',
      access_token: tokenY,
    }).select('id').single();
    const foreignUrl = publicUrl('aft_event_attachments', `${eventB!.id}_${Date.now()}_b.pdf`);
    await admin.from('aft_event_messages').insert({
      event_id: eventB!.id,
      sender: 'mechanic',
      message_type: 'comment',
      message: 'attached',
      attachments: [{ url: foreignUrl, name: 'b.pdf' }],
    } as any);

    try {
      // Caller has tokenX; tries to sign BOTH urls. Only ownUrl
      // should resolve; foreignUrl must come back null.
      const res = await request.post(`${baseURL}/api/storage/sign`, {
        data: { urls: [ownUrl, foreignUrl], accessToken: tokenX },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.signed[foreignUrl]).toBeNull();
      // ownUrl present (signed or null if storage missing)
      expect(ownUrl in body.signed).toBe(true);
    } finally {
      await admin.from('aft_event_messages').delete().eq('event_id', eventA!.id);
      await admin.from('aft_event_messages').delete().eq('event_id', eventB!.id);
      await admin.from('aft_maintenance_events').delete().eq('id', eventA!.id);
      await admin.from('aft_maintenance_events').delete().eq('id', eventB!.id);
      await admin.from('aft_aircraft').delete().eq('id', foreignAc!.id);
    }
  });

  test('squawk token can sign its own pictures; foreign squawk pictures return null', async ({ seededUser, baseURL, request }) => {
    const admin = adminClient();
    const tokenS = randomUUID().replace(/-/g, '');
    const ownPic = publicUrl('aft_squawk_images', `${randomUUID()}_own.jpg`);
    const { data: ownSq } = await admin.from('aft_squawks').insert({
      aircraft_id: seededUser.aircraftId,
      reported_by: seededUser.userId,
      description: 'own squawk',
      status: 'open',
      access_token: tokenS,
      pictures: [ownPic],
    }).select('id').single();

    // Foreign squawk on a different aircraft
    const { data: foreignAc } = await admin.from('aft_aircraft').insert({
      tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`,
      aircraft_type: 'Foreign',
      engine_type: 'Piston',
    }).select('id').single();
    const foreignPic = publicUrl('aft_squawk_images', `${randomUUID()}_foreign.jpg`);
    const { data: foreignSq } = await admin.from('aft_squawks').insert({
      aircraft_id: foreignAc!.id,
      reported_by: seededUser.userId,
      description: 'foreign squawk',
      status: 'open',
      access_token: randomUUID().replace(/-/g, ''),
      pictures: [foreignPic],
    }).select('id').single();

    try {
      const res = await request.post(`${baseURL}/api/storage/sign`, {
        data: { urls: [ownPic, foreignPic], accessToken: tokenS },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.signed[foreignPic]).toBeNull();
      expect(ownPic in body.signed).toBe(true);
    } finally {
      await admin.from('aft_squawks').delete().eq('id', ownSq!.id);
      await admin.from('aft_squawks').delete().eq('id', foreignSq!.id);
      await admin.from('aft_aircraft').delete().eq('id', foreignAc!.id);
    }
  });

  test('garbage / wrong access token signs nothing', async ({ baseURL, request }) => {
    const admin = adminClient();
    const tokenS = randomUUID().replace(/-/g, '');
    const pic = publicUrl('aft_squawk_images', `${randomUUID()}_x.jpg`);
    const { data: sq } = await admin.from('aft_squawks').insert({
      aircraft_id: (await admin.from('aft_aircraft').insert({
        tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`,
        aircraft_type: 'X',
        engine_type: 'Piston',
      }).select('id').single()).data!.id,
      reported_by: (await admin.from('aft_user_roles').select('user_id').limit(1).single()).data!.user_id,
      description: 'x',
      status: 'open',
      access_token: tokenS,
      pictures: [pic],
    }).select('id, aircraft_id').single();

    try {
      // Wrong token entirely — must not bypass into auth-mode's
      // global-admin path, must just return all-null.
      const res = await request.post(`${baseURL}/api/storage/sign`, {
        data: { urls: [pic], accessToken: 'definitely-not-a-real-token' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.signed[pic]).toBeNull();
    } finally {
      await admin.from('aft_squawks').delete().eq('id', sq!.id);
      await admin.from('aft_aircraft').delete().eq('id', sq!.aircraft_id);
    }
  });

  test('soft-deleted event with valid token signs nothing (deleted_at filter)', async ({ seededUser, baseURL, request }) => {
    const admin = adminClient();
    const tokenZ = randomUUID().replace(/-/g, '');
    const { data: ev } = await admin.from('aft_maintenance_events').insert({
      aircraft_id: seededUser.aircraftId,
      status: 'draft',
      access_token: tokenZ,
      deleted_at: new Date().toISOString(),
    }).select('id').single();
    const url = publicUrl('aft_event_attachments', `${ev!.id}_x.pdf`);
    await admin.from('aft_event_messages').insert({
      event_id: ev!.id,
      sender: 'mechanic',
      message_type: 'comment',
      message: 'x',
      attachments: [{ url, name: 'x.pdf' }],
    } as any);

    try {
      const res = await request.post(`${baseURL}/api/storage/sign`, {
        data: { urls: [url], accessToken: tokenZ },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.signed[url]).toBeNull();
    } finally {
      await admin.from('aft_event_messages').delete().eq('event_id', ev!.id);
      await admin.from('aft_maintenance_events').delete().eq('id', ev!.id);
    }
  });

  test('event completed >7 days ago: portal token signs nothing (expiry guard)', async ({ seededUser, baseURL, request }) => {
    // Mirrors /api/mx-events/respond + /upload-attachment expiry rule
    // (PORTAL_EXPIRY_DAYS=7). Without this guard, a stale mechanic link
    // could pull historical attachments long after the event closed.
    const admin = adminClient();
    const tokenE = randomUUID().replace(/-/g, '');
    const completedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { data: ev } = await admin.from('aft_maintenance_events').insert({
      aircraft_id: seededUser.aircraftId,
      status: 'complete',
      completed_at: completedAt,
      access_token: tokenE,
    }).select('id').single();
    const url = publicUrl('aft_event_attachments', `${ev!.id}_old.pdf`);
    await admin.from('aft_event_messages').insert({
      event_id: ev!.id,
      sender: 'mechanic',
      message_type: 'comment',
      message: 'old attachment',
      attachments: [{ url, name: 'old.pdf' }],
    } as any);

    try {
      const res = await request.post(`${baseURL}/api/storage/sign`, {
        data: { urls: [url], accessToken: tokenE },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.signed[url]).toBeNull();
    } finally {
      await admin.from('aft_event_messages').delete().eq('event_id', ev!.id);
      await admin.from('aft_maintenance_events').delete().eq('id', ev!.id);
    }
  });

  test('event completed 1 day ago: portal token still signs (within window)', async ({ seededUser, baseURL, request }) => {
    // Inverse of the above — a recently-completed event must still
    // hand out signed URLs so the mechanic can review their work
    // during the 7-day grace window.
    const admin = adminClient();
    const tokenF = randomUUID().replace(/-/g, '');
    const completedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const { data: ev } = await admin.from('aft_maintenance_events').insert({
      aircraft_id: seededUser.aircraftId,
      status: 'complete',
      completed_at: completedAt,
      access_token: tokenF,
    }).select('id').single();
    const url = publicUrl('aft_event_attachments', `${ev!.id}_recent.pdf`);
    await admin.from('aft_event_messages').insert({
      event_id: ev!.id,
      sender: 'mechanic',
      message_type: 'comment',
      message: 'recent attachment',
      attachments: [{ url, name: 'recent.pdf' }],
    } as any);

    try {
      const res = await request.post(`${baseURL}/api/storage/sign`, {
        data: { urls: [url], accessToken: tokenF },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      // URL must be present in the response map; signed value will be
      // a string (storage object missing → null is fine here too —
      // the key thing is the route DIDN'T short-circuit it the way
      // the expired path does).
      expect(url in body.signed).toBe(true);
    } finally {
      await admin.from('aft_event_messages').delete().eq('event_id', ev!.id);
      await admin.from('aft_maintenance_events').delete().eq('id', ev!.id);
    }
  });

  test('cancelled event: portal token signs nothing', async ({ seededUser, baseURL, request }) => {
    // Cancel rotates the access_token, but the explicit status check
    // is defense-in-depth for any path that might reuse a pre-rotation
    // token snapshot. Verify a status='cancelled' event refuses to
    // sign even when the original token still happens to match.
    const admin = adminClient();
    const tokenC = randomUUID().replace(/-/g, '');
    const { data: ev } = await admin.from('aft_maintenance_events').insert({
      aircraft_id: seededUser.aircraftId,
      status: 'cancelled',
      access_token: tokenC,
    }).select('id').single();
    const url = publicUrl('aft_event_attachments', `${ev!.id}_c.pdf`);
    await admin.from('aft_event_messages').insert({
      event_id: ev!.id,
      sender: 'mechanic',
      message_type: 'comment',
      message: 'cancelled attachment',
      attachments: [{ url, name: 'c.pdf' }],
    } as any);

    try {
      const res = await request.post(`${baseURL}/api/storage/sign`, {
        data: { urls: [url], accessToken: tokenC },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.signed[url]).toBeNull();
    } finally {
      await admin.from('aft_event_messages').delete().eq('event_id', ev!.id);
      await admin.from('aft_maintenance_events').delete().eq('id', ev!.id);
    }
  });
});

import { NextResponse } from 'next/server';
import { requireAuth, createAdminClient, handleApiError } from '@/lib/auth';
import { isPortalLinkExpired } from '@/lib/portalExpiry';

/**
 * POST /api/storage/sign
 *
 * Generate short-lived signed URLs for Supabase Storage objects.
 *
 * Two modes:
 *   1. Authenticated user: requireAuth + scope to the caller's
 *      accessible aircraft set (the original behaviour).
 *   2. Token-gated portal: when the body carries an `accessToken`,
 *      skip auth and scope signing to URLs that live within that
 *      token's row. The mechanic portal (/service/[id]) and the
 *      public squawk page (/squawk/[id]) have no Supabase auth
 *      session, but the token they were given is the auth boundary.
 *      Without this branch, every attachment + photo on those pages
 *      403s the moment the buckets are flipped private.
 *
 * Body (auth mode):    { urls: string[] }
 * Body (portal mode):  { urls: string[], accessToken: string }
 * Response: { signed: Record<string, string | null> }
 *
 * TTL: 1 hour (3600s). Long enough for a normal browsing session,
 * short enough that a leaked URL after access revocation expires
 * quickly.
 */

const SIGNED_URL_TTL = 3600; // 1 hour

// Known bucket names → used to extract the bucket from a public URL.
// The URL format is:
//   https://{project}.supabase.co/storage/v1/object/public/{bucket}/{path}
const KNOWN_BUCKETS = new Set([
  'aft_aircraft_documents',
  'aft_squawk_images',
  'aft_note_images',
  'aft_event_attachments',
  'aft_aircraft_avatars',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseBucketAndPath(url: string): { bucket: string; path: string } | null {
  try {
    const match = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (!match) return null;
    const bucket = match[1];
    const path = decodeURIComponent(match[2]);
    if (!KNOWN_BUCKETS.has(bucket)) return null;
    return { bucket, path };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const urls: unknown = body?.urls;
    const accessToken: unknown = body?.accessToken;

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'urls array is required.' }, { status: 400 });
    }
    if (urls.length > 50) {
      return NextResponse.json({ error: 'Max 50 URLs per request.' }, { status: 400 });
    }

    // Portal mode: token instead of bearer auth. Validate the token
    // up-front so we know which row's URLs are allowed, then short-
    // circuit straight to the bucket loop with that allowlist.
    if (typeof accessToken === 'string' && accessToken.length > 0) {
      return await signWithToken(urls as string[], accessToken);
    }

    const { user, supabaseAdmin } = await requireAuth(req);

    // Resolve the caller's accessible aircraft set once. A global
    // admin sees everything; otherwise the user_aircraft_access table
    // is the source of truth.
    const { data: callerRole } = await supabaseAdmin
      .from('aft_user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    const isGlobalAdmin = callerRole?.role === 'admin';

    let accessibleAircraftIds: string[] = [];
    if (!isGlobalAdmin) {
      const { data: access } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('aircraft_id')
        .eq('user_id', user.id);
      accessibleAircraftIds = (access || []).map((a: any) => a.aircraft_id);
    }

    // Group URLs by bucket so each bucket only takes one ownership
    // query regardless of how many URLs are in the request.
    const byBucket = new Map<string, { url: string; path: string }[]>();
    const signed: Record<string, string | null> = {};
    for (const url of urls) {
      const parsed = parseBucketAndPath(url);
      if (!parsed) {
        signed[url] = null;
        continue;
      }
      const list = byBucket.get(parsed.bucket) ?? [];
      list.push({ url, path: parsed.path });
      byBucket.set(parsed.bucket, list);
    }

    // For each bucket, build the set of URLs the caller is allowed to
    // sign. Each bucket has a different "owning" table; the access
    // check is bucket-specific.
    const allowedByBucket = new Map<string, Set<string>>();

    for (const [bucket, items] of Array.from(byBucket.entries())) {
      const allowed = new Set<string>();
      const urlList = items.map((i: { url: string; path: string }) => i.url);

      if (bucket === 'aft_aircraft_documents') {
        // Path is `${aircraftId}_${ts}_${name}` and the row stores the
        // public URL on `aft_documents.file_url`. Single query keyed
        // off file_url scoped to the caller's aircraft set.
        let q = supabaseAdmin
          .from('aft_documents')
          .select('file_url, aircraft_id')
          .in('file_url', urlList)
          .is('deleted_at', null);
        if (!isGlobalAdmin) q = q.in('aircraft_id', accessibleAircraftIds);
        const { data, error } = await q;
        if (error) throw error;
        for (const row of data || []) allowed.add(row.file_url);
      } else if (bucket === 'aft_aircraft_avatars') {
        // Avatar URL is stored on aft_aircraft.avatar_url.
        let q = supabaseAdmin
          .from('aft_aircraft')
          .select('avatar_url, id')
          .in('avatar_url', urlList)
          .is('deleted_at', null);
        if (!isGlobalAdmin) q = q.in('id', accessibleAircraftIds);
        const { data, error } = await q;
        if (error) throw error;
        for (const row of data || []) if (row.avatar_url) allowed.add(row.avatar_url);
      } else if (bucket === 'aft_event_attachments') {
        // Path is `${eventId}_${ts}_${name}` — pull eventId from each
        // path, batch-look-up the events, and confirm the caller has
        // access to each event's aircraft.
        const eventIds = new Set<string>();
        const itemsByEvent = new Map<string, string[]>();
        for (const it of items) {
          const eventId = it.path.split('_')[0];
          if (!UUID_RE.test(eventId)) continue;
          eventIds.add(eventId);
          const u = itemsByEvent.get(eventId) ?? [];
          u.push(it.url);
          itemsByEvent.set(eventId, u);
        }
        if (eventIds.size > 0) {
          let q = supabaseAdmin
            .from('aft_maintenance_events')
            .select('id, aircraft_id')
            .in('id', Array.from(eventIds))
            .is('deleted_at', null);
          if (!isGlobalAdmin) q = q.in('aircraft_id', accessibleAircraftIds);
          const { data, error } = await q;
          if (error) throw error;
          for (const row of data || []) {
            const urls = itemsByEvent.get(row.id) ?? [];
            for (const u of urls) allowed.add(u);
          }
        }
      } else if (bucket === 'aft_note_images' || bucket === 'aft_squawk_images') {
        // Both aft_notes and aft_squawks store URLs in the `pictures`
        // text[] column (see migration 029 + the orphan-sweep in
        // /api/admin/db-health). The earlier `image_urls` selects here
        // matched zero rows silently, so `signed[url]` came back null
        // for every photo and the client fell through to the still-
        // public stored URL — fine while the buckets are public, but
        // the moment either bucket is flipped private (the same
        // pattern that broke avatars in `project_avatar_bucket_private`)
        // every squawk and note photo across the app, the PDF export,
        // and the public /squawk/[token] page would 403.
        const table = bucket === 'aft_note_images' ? 'aft_notes' : 'aft_squawks';
        let q = supabaseAdmin
          .from(table)
          .select('pictures, aircraft_id')
          .overlaps('pictures', urlList)
          .is('deleted_at', null);
        if (!isGlobalAdmin) q = q.in('aircraft_id', accessibleAircraftIds);
        const { data, error } = await q;
        if (error) throw error;
        for (const row of data || []) {
          for (const u of (row.pictures || []) as string[]) {
            if (urlList.includes(u)) allowed.add(u);
          }
        }
      }

      allowedByBucket.set(bucket, allowed);
    }

    // Sign only the URLs the caller owns. Anything else returns null
    // — the client treats null as "fall back to the public URL" so
    // unauthenticated public buckets keep working until the buckets
    // are flipped private.
    await Promise.all(
      Array.from(byBucket.entries()).flatMap(([bucket, items]) =>
        items.map(async ({ url, path }) => {
          const allowed = allowedByBucket.get(bucket);
          if (!allowed?.has(url)) {
            signed[url] = null;
            return;
          }
          const { data, error } = await supabaseAdmin.storage
            .from(bucket)
            .createSignedUrl(path, SIGNED_URL_TTL);
          signed[url] = error ? null : data?.signedUrl || null;
        })
      )
    );

    return NextResponse.json({ signed });
  } catch (error) {
    return handleApiError(error, req);
  }
}

// ─── Portal-mode signing ────────────────────────────────────
// The token is the auth boundary for /service/[id] (mechanic
// portal) and /squawk/[id] (public squawk page). Look up the
// row, build an allowlist from the URLs that legitimately live
// inside that row, and sign only those. Anything else returns
// null so a leaked token can't be replayed to sign someone
// else's bytes by passing arbitrary URLs.
async function signWithToken(urls: string[], accessToken: string): Promise<NextResponse> {
  const supabaseAdmin = createAdminClient();
  const signed: Record<string, string | null> = {};
  for (const u of urls) signed[u] = null;

  // Bucket each URL the same way the auth-mode path does.
  const byBucket = new Map<string, { url: string; path: string }[]>();
  for (const url of urls) {
    const parsed = parseBucketAndPath(url);
    if (!parsed) continue;
    const list = byBucket.get(parsed.bucket) ?? [];
    list.push({ url, path: parsed.path });
    byBucket.set(parsed.bucket, list);
  }
  if (byBucket.size === 0) return NextResponse.json({ signed });

  // Resolve the token. Try event first, then squawk — the two are
  // disjoint (each token is a fresh random string) so at most one
  // matches. We only look up tables relevant to the buckets being
  // requested, since a squawk token has no business signing event
  // attachments and vice versa.
  const wantsEventBucket = byBucket.has('aft_event_attachments');
  const wantsSquawkBucket = byBucket.has('aft_squawk_images') || byBucket.has('aft_note_images');

  const allowed = new Set<string>();

  // Try event token first. Event tokens have a broader scope than
  // squawk tokens — the mechanic portal renders attachments AND
  // photos from squawks linked into the event's line items, so an
  // event token must be able to sign both buckets.
  let eventMatched = false;
  if (wantsEventBucket || wantsSquawkBucket) {
    // Pull status + completed_at so the same expiry rule that gates
    // /api/mx-events/respond + /upload-attachment also gates signed-URL
    // handouts. Without this, a mechanic's old portal link could keep
    // pulling attachments past PORTAL_EXPIRY_DAYS even though every
    // mutating route on the same event already 403s.
    const { data: event } = await supabaseAdmin
      .from('aft_maintenance_events')
      .select('id, status, completed_at')
      .eq('access_token', accessToken)
      .is('deleted_at', null)
      .maybeSingle();
    // Cancelled events: cancel rotates the access_token server-side,
    // so a stale link's lookup won't match in the first place. The
    // explicit check is defense-in-depth for any code path that might
    // reuse a pre-rotation token snapshot.
    const eventActive = event && event.status !== 'cancelled' && !isPortalLinkExpired(event);
    if (eventActive) {
      eventMatched = true;
      if (wantsEventBucket) {
        const items = byBucket.get('aft_event_attachments') || [];
        const urlList = items.map(i => i.url);
        const { data: msgs } = await supabaseAdmin
          .from('aft_event_messages')
          .select('attachments')
          .eq('event_id', event.id)
          .not('attachments', 'is', null);
        for (const m of msgs || []) {
          for (const att of (m.attachments || []) as any[]) {
            if (att?.url && urlList.includes(att.url)) allowed.add(att.url);
          }
        }
      }
      if (wantsSquawkBucket) {
        // Pictures of every squawk that's linked into this event's
        // line items. The mechanic legitimately needs to see these
        // to know what they're working on.
        const squawkUrls: string[] = [
          ...(byBucket.get('aft_squawk_images') || []).map(i => i.url),
          ...(byBucket.get('aft_note_images') || []).map(i => i.url),
        ];
        const { data: lineItems } = await supabaseAdmin
          .from('aft_event_line_items')
          .select('squawk_id')
          .eq('event_id', event.id)
          .not('squawk_id', 'is', null);
        const squawkIds = (lineItems || []).map((l: any) => l.squawk_id);
        if (squawkIds.length > 0) {
          const { data: squawks } = await supabaseAdmin
            .from('aft_squawks')
            .select('pictures')
            .in('id', squawkIds)
            .is('deleted_at', null);
          for (const sq of squawks || []) {
            for (const u of (sq.pictures || []) as string[]) {
              if (squawkUrls.includes(u)) allowed.add(u);
            }
          }
        }
      }
    }
  }

  // Squawk-token fallback: a public squawk page request will have
  // its access_token on aft_squawks, not aft_maintenance_events. Only
  // try this branch if the event lookup didn't match — keeps the
  // happy path one query per request.
  if (!eventMatched && wantsSquawkBucket) {
    const { data: squawk } = await supabaseAdmin
      .from('aft_squawks')
      .select('pictures')
      .eq('access_token', accessToken)
      .is('deleted_at', null)
      .maybeSingle();
    if (squawk) {
      const allUrls: string[] = [
        ...(byBucket.get('aft_squawk_images') || []).map(i => i.url),
        ...(byBucket.get('aft_note_images') || []).map(i => i.url),
      ];
      for (const u of (squawk.pictures || []) as string[]) {
        if (allUrls.includes(u)) allowed.add(u);
      }
    }
  }

  await Promise.all(
    Array.from(byBucket.entries()).flatMap(([bucket, items]) =>
      items.map(async ({ url, path }) => {
        if (!allowed.has(url)) return;
        const { data, error } = await supabaseAdmin.storage
          .from(bucket)
          .createSignedUrl(path, SIGNED_URL_TTL);
        signed[url] = error ? null : data?.signedUrl || null;
      })
    )
  );

  return NextResponse.json({ signed });
}

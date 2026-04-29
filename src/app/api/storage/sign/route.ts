import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

/**
 * POST /api/storage/sign
 *
 * Generate short-lived signed URLs for Supabase Storage objects.
 * Accepts an array of public URLs, resolves each to its owning row,
 * and signs only those whose row belongs to an aircraft the caller
 * can access. URLs that don't resolve, don't match a known bucket,
 * or whose row isn't accessible return `null` — the client falls
 * back to its public URL behavior in that case.
 *
 * Body: { urls: string[] }
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
    const { user, supabaseAdmin } = await requireAuth(req);
    const { urls } = await req.json();

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'urls array is required.' }, { status: 400 });
    }
    if (urls.length > 50) {
      return NextResponse.json({ error: 'Max 50 URLs per request.' }, { status: 400 });
    }

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
        const { data } = await q;
        for (const row of data || []) allowed.add(row.file_url);
      } else if (bucket === 'aft_aircraft_avatars') {
        // Avatar URL is stored on aft_aircraft.avatar_url.
        let q = supabaseAdmin
          .from('aft_aircraft')
          .select('avatar_url, id')
          .in('avatar_url', urlList)
          .is('deleted_at', null);
        if (!isGlobalAdmin) q = q.in('id', accessibleAircraftIds);
        const { data } = await q;
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
          const { data } = await q;
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
        const { data } = await q;
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
    return handleApiError(error);
  }
}

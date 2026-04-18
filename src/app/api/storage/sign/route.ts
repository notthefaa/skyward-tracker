import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

/**
 * POST /api/storage/sign
 *
 * Generate short-lived signed URLs for Supabase Storage objects.
 * Accepts an array of public URLs, extracts the bucket + path from
 * each, and returns signed URLs via the admin client (which bypasses
 * storage-level RLS — auth is enforced here at the API layer).
 *
 * This is the stepping-stone toward private buckets: once all
 * rendering surfaces call this endpoint instead of using public URLs
 * directly, the buckets can be flipped to private without breaking
 * any client code. Until then, public URLs still work in parallel.
 *
 * Body: { urls: string[] }
 * Response: { signed: Record<string, string | null> }
 *
 * TTL: 1 hour (3600s). Covers a normal browsing session without
 * being long enough for a revoked user to abuse a leaked URL.
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

function parseBucketAndPath(url: string): { bucket: string; path: string } | null {
  try {
    // Match the Supabase Storage public URL pattern.
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
    const { supabaseAdmin } = await requireAuth(req);
    const { urls } = await req.json();

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'urls array is required.' }, { status: 400 });
    }
    if (urls.length > 50) {
      return NextResponse.json({ error: 'Max 50 URLs per request.' }, { status: 400 });
    }

    const signed: Record<string, string | null> = {};

    await Promise.all(urls.map(async (url: string) => {
      const parsed = parseBucketAndPath(url);
      if (!parsed) {
        signed[url] = null;
        return;
      }
      const { data, error } = await supabaseAdmin.storage
        .from(parsed.bucket)
        .createSignedUrl(parsed.path, SIGNED_URL_TTL);
      signed[url] = error ? null : data?.signedUrl || null;
    }));

    return NextResponse.json({ signed });
  } catch (error) {
    return handleApiError(error);
  }
}

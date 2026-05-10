"use client";

import { useState, useEffect, useRef } from "react";
import { authFetch } from "@/lib/authFetch";

/**
 * Resolve public Supabase Storage URLs to short-lived signed URLs.
 *
 * Usage:
 *   const resolve = useSignedUrls();
 *   const signedUrl = resolve(publicUrl);   // returns signed URL or publicUrl as fallback
 *
 * The hook batches all requested URLs, calls /api/storage/sign once
 * per batch, and caches the results for 50 minutes (the server issues
 * 60-minute TTLs, so the 10-minute buffer avoids serving expired URLs
 * near the end of the window). Components just call resolve() and
 * get back whichever URL is best — signed if available, original if
 * the signing endpoint hasn't responded yet or failed.
 *
 * This is designed as a progressive enhancement: components that call
 * resolve() still work before the buckets are flipped to private
 * (public URLs pass through). After the flip, the signed URL is
 * required and this hook provides it transparently.
 */

const CACHE_TTL = 50 * 60 * 1000; // 50 min

// Buckets that have been flipped to private. Only URLs belonging to
// one of these buckets get signed — public-bucket URLs pass through
// unchanged, skipping the /api/storage/sign round-trip entirely.
// When a bucket is flipped to private, add its name here.
//
// All five image / file buckets are now private. Anything stored as
// `…/storage/v1/object/public/${bucket}/…` returns 400 + ORB unless
// the renderer routes through this hook (or fetchSignedUrls below)
// to swap in a signed URL.
const PRIVATE_BUCKETS = new Set<string>([
  'aft_aircraft_avatars',
  'aft_aircraft_documents',
  'aft_event_attachments',
  'aft_squawk_images',
  'aft_note_images',
]);

export function isPrivateBucketUrl(url: string | null | undefined): boolean {
  if (!url || !url.includes('/storage/v1/object/public/')) return false;
  const bucket = bucketFromPublicUrl(url);
  return !!bucket && PRIVATE_BUCKETS.has(bucket);
}

// Module-level cache so multiple component instances share signed URLs.
const cache = new Map<string, { signed: string; expiresAt: number }>();
const pending = new Set<string>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let batchQueue: string[] = [];
const listeners = new Set<() => void>();

function bucketFromPublicUrl(url: string): string | null {
  const m = url.match(/\/storage\/v1\/object\/public\/([^/]+)\//);
  return m ? m[1] : null;
}

function flushBatch() {
  batchTimer = null;
  const urls = Array.from(new Set(batchQueue));
  batchQueue = [];
  if (urls.length === 0) return;

  authFetch('/api/storage/sign', {
    method: 'POST',
    body: JSON.stringify({ urls }),
  })
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      // Always clear `pending` for every URL in this batch — the prior
      // shape only deleted URLs that appeared in `data.signed`, so a
      // non-OK response (data === null), a 200 with no `signed` map,
      // or a partial response left some URLs pinned in `pending`
      // forever. The `if (pending.has(url)) return;` guard in
      // `enqueue` then skipped re-attempts → avatar (or any private-
      // bucket renderer) showed the placeholder permanently. This was
      // the root cause of "the avatar hung" reported across multiple
      // aircraft switches: each switch enqueued a new tail's avatar,
      // and a single transient 5xx during the iOS pool wedge stranded
      // every avatar URL in the same batch.
      for (const url of urls) pending.delete(url);
      if (!data?.signed) return;
      const now = Date.now();
      for (const [publicUrl, signedUrl] of Object.entries(data.signed)) {
        if (signedUrl) {
          cache.set(publicUrl, { signed: signedUrl as string, expiresAt: now + CACHE_TTL });
        }
      }
      // Notify all mounted hooks so they re-render with the new URLs.
      listeners.forEach(cb => cb());
    })
    .catch(() => {
      // Signing failed — public URLs will be used as fallback.
      for (const url of urls) pending.delete(url);
    });
}

function enqueue(url: string) {
  if (cache.has(url) && cache.get(url)!.expiresAt > Date.now()) return;
  if (pending.has(url)) return;
  pending.add(url);
  batchQueue.push(url);
  if (!batchTimer) {
    // Small delay to batch multiple enqueue() calls in the same tick.
    batchTimer = setTimeout(flushBatch, 50);
  }
}

/**
 * One-shot signed-URL prefetch for non-React contexts (PDF export,
 * email body builders, etc.). Calls /api/storage/sign once for the
 * URLs that aren't already cached, then resolves to a Map keyed by
 * the original public URL. Falls back to the public URL on miss so
 * callers can render *something* even if signing failed.
 *
 * Use this anywhere `resolve()` from useSignedUrls() can't be —
 * e.g. inside an async PDF builder that has no React render cycle
 * to wait on the hook's listener callback.
 */
export async function fetchSignedUrls(
  publicUrls: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const toRequest: string[] = [];
  const now = Date.now();
  for (const url of publicUrls) {
    if (!url || !url.includes('/storage/v1/object/public/')) {
      out.set(url, url);
      continue;
    }
    const bucket = bucketFromPublicUrl(url);
    if (!bucket || !PRIVATE_BUCKETS.has(bucket)) {
      // Public bucket — pass through.
      out.set(url, url);
      continue;
    }
    const cached = cache.get(url);
    if (cached && cached.expiresAt > now) {
      out.set(url, cached.signed);
      continue;
    }
    toRequest.push(url);
  }
  if (toRequest.length > 0) {
    try {
      const res = await authFetch('/api/storage/sign', {
        method: 'POST',
        body: JSON.stringify({ urls: toRequest }),
      });
      if (res.ok) {
        const data = await res.json();
        const signed = (data?.signed || {}) as Record<string, string | null>;
        for (const url of toRequest) {
          const signedUrl = signed[url];
          if (signedUrl) {
            cache.set(url, { signed: signedUrl, expiresAt: Date.now() + CACHE_TTL });
            out.set(url, signedUrl);
          } else {
            // Fallback: server returned null (URL not owned, or
            // bucket allowlist mismatch). Keep the public URL so the
            // caller renders *something* instead of breaking the
            // export entirely.
            out.set(url, url);
          }
        }
      } else {
        for (const url of toRequest) out.set(url, url);
      }
    } catch {
      for (const url of toRequest) out.set(url, url);
    }
  }
  return out;
}

/**
 * Token-gated variant of fetchSignedUrls for the mechanic portal
 * (/service/[id]) and public squawk page (/squawk/[id]). Those pages
 * have no Supabase auth session, so authFetch can't sign their URLs;
 * the token they were given is the auth boundary instead. The server
 * scopes signing to URLs that live within the token's row.
 *
 * Uses plain fetch (no auth header) since the token replaces auth.
 */
export async function fetchSignedUrlsWithToken(
  publicUrls: ReadonlyArray<string>,
  accessToken: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!accessToken || publicUrls.length === 0) {
    for (const u of publicUrls) out.set(u, u);
    return out;
  }
  const toRequest: string[] = [];
  for (const url of publicUrls) {
    if (!url || !url.includes('/storage/v1/object/public/')) {
      out.set(url, url);
      continue;
    }
    const bucket = bucketFromPublicUrl(url);
    if (!bucket || !PRIVATE_BUCKETS.has(bucket)) {
      out.set(url, url);
      continue;
    }
    toRequest.push(url);
  }
  if (toRequest.length === 0) return out;
  try {
    const res = await fetch('/api/storage/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: toRequest, accessToken }),
      // Portal-mode bare fetch — bound it so an iOS-suspended request
      // doesn't hang the page; on miss we fall through to public URLs
      // (handled in the catch below).
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const data = await res.json();
      const signed = (data?.signed || {}) as Record<string, string | null>;
      for (const url of toRequest) {
        const signedUrl = signed[url];
        out.set(url, signedUrl || url);
      }
    } else {
      for (const url of toRequest) out.set(url, url);
    }
  } catch {
    for (const url of toRequest) out.set(url, url);
  }
  return out;
}

/**
 * Returns a `resolve(publicUrl)` function that maps a public Storage
 * URL to a signed URL. If the signed URL isn't ready yet, returns the
 * original public URL (which still works while the bucket is public).
 */
export function useSignedUrls(): (publicUrl: string | null | undefined) => string | null {
  const [, setTick] = useState<number>(0);
  const cbRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const cb = () => setTick(t => t + 1);
    cbRef.current = cb;
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, []);

  return (publicUrl: string | null | undefined): string | null => {
    if (!publicUrl) return null;
    // Only resolve Supabase Storage URLs; pass through external URLs.
    if (!publicUrl.includes('/storage/v1/object/public/')) return publicUrl;

    // Skip signing for buckets that are still public — no reason to
    // double-fetch when the public URL is the authoritative one. The
    // `<img>` src swap from public → signed triggers a browser fetch
    // abort + refetch, which is what causes avatar flicker and
    // occasional load failures on slow networks.
    const bucket = bucketFromPublicUrl(publicUrl);
    if (!bucket || !PRIVATE_BUCKETS.has(bucket)) return publicUrl;

    const cached = cache.get(publicUrl);
    if (cached && cached.expiresAt > Date.now()) return cached.signed;

    enqueue(publicUrl);
    return publicUrl; // fallback to public URL while signing
  };
}

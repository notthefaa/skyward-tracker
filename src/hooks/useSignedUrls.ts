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
// aft_aircraft_avatars is private in production: the public URL path
// returns 400 "Bucket not found" and Firefox's OpaqueResponseBlocking
// turns that into an avatar-render failure, which would otherwise
// drop into the AircraftAvatarImg onError rescue (1 POST per avatar
// per page session). Routing through this hook batches them.
const PRIVATE_BUCKETS = new Set<string>(['aft_aircraft_avatars']);

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
      if (!data?.signed) return;
      const now = Date.now();
      for (const [publicUrl, signedUrl] of Object.entries(data.signed)) {
        pending.delete(publicUrl);
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

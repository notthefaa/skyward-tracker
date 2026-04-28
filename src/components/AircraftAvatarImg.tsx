"use client";

import { useState, useEffect } from "react";
import { authFetch } from "@/lib/authFetch";
import { useSignedUrls, isPrivateBucketUrl } from "@/hooks/useSignedUrls";

/**
 * Aircraft avatar <img>.
 *
 * Two paths:
 *
 *   1. Private-bucket URL (e.g. aft_aircraft_avatars after the
 *      privacy flip) — request a signed URL up front via the
 *      batched useSignedUrls hook. Don't render the broken
 *      public URL into <img> in the meantime, because Firefox's
 *      OpaqueResponseBlocking treats the 400-bucket-not-found
 *      JSON response as a security violation, fires onError, and
 *      we'd be back in the rescue cascade we're trying to avoid.
 *      Show a transparent placeholder until the signed URL lands.
 *
 *   2. Public-bucket URL — render the public URL directly. If
 *      something fails (CDN race, transient 4xx), the onError
 *      rescue dedups across all instances via module-level
 *      caches so we POST /api/storage/sign at most once per URL.
 */
interface Props {
  publicUrl: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  width?: number;
  height?: number;
}

// Module-level cache shared across all rescue-path instances so the
// onError POST fires at most once per public URL per page session.
const resolvedSigned = new Map<string, string>();
const failedSigned = new Set<string>();
const pendingSigned = new Map<string, Promise<string | null>>();

function rescueOnce(publicUrl: string): Promise<string | null> {
  if (resolvedSigned.has(publicUrl)) return Promise.resolve(resolvedSigned.get(publicUrl)!);
  if (failedSigned.has(publicUrl)) return Promise.resolve(null);
  const inFlight = pendingSigned.get(publicUrl);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const res = await authFetch('/api/storage/sign', {
        method: 'POST',
        body: JSON.stringify({ urls: [publicUrl] }),
      });
      if (!res.ok) {
        failedSigned.add(publicUrl);
        return null;
      }
      const data = await res.json();
      const signed: string | null = data?.signed?.[publicUrl] ?? null;
      if (signed && signed !== publicUrl) {
        resolvedSigned.set(publicUrl, signed);
        return signed;
      }
      failedSigned.add(publicUrl);
      return null;
    } catch {
      failedSigned.add(publicUrl);
      return null;
    } finally {
      pendingSigned.delete(publicUrl);
    }
  })();
  pendingSigned.set(publicUrl, promise);
  return promise;
}

export function AircraftAvatarImg({ publicUrl, alt, className, loading, width, height }: Props) {
  const resolveSigned = useSignedUrls();
  const isPrivate = isPrivateBucketUrl(publicUrl);

  // Private-bucket path: hook returns the public URL as fallback while
  // signing is in flight, then re-renders with the signed URL when it
  // arrives. Don't render the public URL into <img> for private buckets
  // — it'll 400 and trigger ORB. Hold a placeholder instead.
  const signedFromHook = resolveSigned(publicUrl);
  const haveSignedFromHook = !!signedFromHook && signedFromHook !== publicUrl;

  // Rescue-path state for the public-bucket fallback flow.
  const initialRescued = resolvedSigned.get(publicUrl);
  const [rescuedSrc, setRescuedSrc] = useState<string | null>(initialRescued ?? null);
  const [triedRescue, setTriedRescue] = useState(!!initialRescued);

  useEffect(() => {
    const cached = resolvedSigned.get(publicUrl);
    setRescuedSrc(cached ?? null);
    setTriedRescue(!!cached);
  }, [publicUrl]);

  if (isPrivate) {
    if (!haveSignedFromHook) {
      // Transparent 1×1 placeholder keeps layout stable while signing
      // is in flight without rendering a known-bad URL into <img>.
      return (
        <div
          className={className}
          style={{ width, height, background: 'transparent' }}
          aria-label={alt}
          role="img"
        />
      );
    }
    return (
      <img
        src={signedFromHook!}
        alt={alt}
        className={className}
        loading={loading}
        decoding="async"
        width={width}
        height={height}
      />
    );
  }

  // Public-bucket path: try the public URL first, rescue on error.
  const src = rescuedSrc ?? publicUrl;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      decoding="async"
      width={width}
      height={height}
      onError={async () => {
        if (triedRescue) return;
        setTriedRescue(true);
        const signed = await rescueOnce(publicUrl);
        if (signed) setRescuedSrc(signed);
      }}
    />
  );
}

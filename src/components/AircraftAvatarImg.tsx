"use client";

import { useState, useEffect } from "react";
import { authFetch } from "@/lib/authFetch";

/**
 * Aircraft avatar <img> with an onError rescue path. Starts with the
 * public URL (fast, no extra round-trip), and if the browser fails to
 * load it, falls back to a signed URL from /api/storage/sign.
 *
 * Some stored avatar public URLs fail intermittently (CDN race,
 * caching quirk, or transient 4xx) — the signed-URL rescue makes
 * rendering resilient without paying the double-fetch cost on every
 * render for the avatars that do load fine.
 */
interface Props {
  publicUrl: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  width?: number;
  height?: number;
}

// Module-level cache shared across all AircraftAvatarImg instances so
// the rescue POST to /api/storage/sign fires at most once per public
// URL per page session. Without this, every fleet card and tab switch
// re-triggers the rescue cascade — especially painful when many
// avatars fail simultaneously.
//
//   resolved → known good signed URL (use it directly)
//   failed   → tried and got null/error back; don't retry
//   pending  → request in flight; subscribers will re-render on resolve
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
  // If we already rescued this URL once, skip the public-URL fetch
  // entirely and start from the signed URL — the broken-image flash
  // only needs to happen once per page session.
  const initial = resolvedSigned.get(publicUrl) ?? publicUrl;
  const [src, setSrc] = useState(initial);
  const [triedSigned, setTriedSigned] = useState(initial !== publicUrl);

  useEffect(() => {
    const cached = resolvedSigned.get(publicUrl);
    setSrc(cached ?? publicUrl);
    setTriedSigned(!!cached);
  }, [publicUrl]);

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
        if (triedSigned) return;
        setTriedSigned(true);
        const signed = await rescueOnce(publicUrl);
        if (signed) setSrc(signed);
      }}
    />
  );
}

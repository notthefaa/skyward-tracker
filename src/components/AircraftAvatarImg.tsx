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

export function AircraftAvatarImg({ publicUrl, alt, className, loading, width, height }: Props) {
  const [src, setSrc] = useState(publicUrl);
  const [triedSigned, setTriedSigned] = useState(false);

  useEffect(() => {
    setSrc(publicUrl);
    setTriedSigned(false);
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
        try {
          const res = await authFetch('/api/storage/sign', {
            method: 'POST',
            body: JSON.stringify({ urls: [publicUrl] }),
          });
          if (!res.ok) return;
          const data = await res.json();
          const signed = data?.signed?.[publicUrl];
          if (signed && signed !== publicUrl) setSrc(signed);
        } catch {
          // Ignore — broken-image icon stays visible.
        }
      }}
    />
  );
}

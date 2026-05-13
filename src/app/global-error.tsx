"use client";

// =============================================================
// Last-resort error boundary. Fires when the root layout itself
// crashes (e.g. a provider throws on mount) — at that point
// `error.tsx` can't render because there's no surviving layout.
// Must include its own <html>/<body>.
// =============================================================

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          background: "#FDFCF4",
          color: "#091F3C",
          fontFamily: "system-ui, -apple-system, sans-serif",
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          margin: 0,
        }}
      >
        <div
          role="alert"
          style={{
            background: "white",
            border: "1px solid #E5E7EB",
            borderTop: "4px solid #CE3732",
            borderRadius: 4,
            padding: 24,
            maxWidth: 480,
            width: "100%",
            boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
          }}
        >
          <h1
            style={{
              fontWeight: 700,
              fontSize: 24,
              textTransform: "uppercase",
              letterSpacing: 1,
              margin: "0 0 8px",
            }}
          >
            Something broke
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 16px" }}>
            The app hit an unrecoverable error. Hard-reload to fetch a fresh bundle.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: "#9CA3AF",
                marginBottom: 12,
                fontFamily: "ui-monospace, monospace",
              }}
            >
              Ref: {error.digest}
            </p>
          )}
          {(error.message || error.stack) && (
            <pre
              style={{
                fontSize: 10,
                fontFamily: "ui-monospace, monospace",
                color: "#525659",
                background: "#F9FAFB",
                border: "1px solid #E5E7EB",
                borderRadius: 4,
                padding: 8,
                marginBottom: 16,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 180,
                overflowY: "auto",
              }}
            >
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          )}
          <button
            onClick={() => {
              // Bust browser/SW cache by appending a cache-buster.
              // `reset()` alone in a global-error rarely helps — the
              // root layout already crashed, re-mounting it just
              // re-throws.
              try {
                const url = new URL(window.location.href);
                url.searchParams.set('_recover', String(Date.now()));
                window.location.replace(url.toString());
              } catch {
                window.location.reload();
              }
            }}
            style={{
              width: "100%",
              background: "#091F3C",
              color: "white",
              fontWeight: 700,
              fontSize: 14,
              textTransform: "uppercase",
              letterSpacing: 1,
              padding: "12px 16px",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Hard Reload
          </button>
        </div>
      </body>
    </html>
  );
}

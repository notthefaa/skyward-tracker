"use client";

// =============================================================
// Route-level error boundary. Catches render errors in any route
// segment under app/ and replaces the failed subtree with a usable
// recovery surface so the user isn't stuck at a white screen.
// `global-error.tsx` handles the rarer case where the root layout
// itself throws.
// =============================================================

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function Error({
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
    <div
      role="alert"
      className="min-h-[100dvh] flex items-center justify-center bg-cream p-6"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="bg-white border border-gray-200 shadow-lg rounded-sm p-6 max-w-md w-full border-t-4 border-danger">
        <h1 className="font-oswald text-2xl font-bold uppercase text-navy mb-2">
          Something broke
        </h1>
        <p className="text-sm text-navy/80 mb-4 font-roboto leading-relaxed">
          The app hit an unexpected error. Try again — if it keeps happening,
          reload the page or sign out and back in.
        </p>
        {error.digest && (
          <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-4 font-mono">
            Ref: {error.digest}
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={reset}
            className="flex-1 bg-navy text-white font-oswald text-sm font-bold uppercase tracking-widest py-3 rounded-lg shadow active:scale-95 transition-transform"
          >
            Try Again
          </button>
          <button
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
            }}
            className="flex-1 bg-white border border-gray-300 text-navy font-oswald text-sm font-bold uppercase tracking-widest py-3 rounded-lg active:scale-95 transition-transform"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}

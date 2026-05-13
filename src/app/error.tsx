"use client";

// =============================================================
// Route-level error boundary. Catches render errors in any route
// segment under app/ and replaces the failed subtree with a usable
// recovery surface so the user isn't stuck at a white screen.
// `global-error.tsx` handles the rarer case where the root layout
// itself throws.
//
// Three escape hatches, in order of disruption:
//   1. Try Again — calls Next's reset(). If the underlying error is
//      deterministic (the common case), this just re-renders the
//      same broken subtree and looks like nothing happened, so we
//      DON'T show it as the primary action.
//   2. Hard reload — busts the SW + browser cache by re-fetching
//      with a cache-busting query param. Helps when a stale bundle
//      is the culprit.
//   3. Sign out — last resort when local session state is the
//      culprit (corrupted JWT, stale fleet cache, etc.). Returns
//      the user to the login screen so they re-enter clean.
// =============================================================

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  // Hard reload — busts the browser HTTP cache by appending a
  // cache-buster query to the current URL. `location.reload()` alone
  // can return a cached HTML/JS bundle if the SW or CDN aged it
  // wrong, in which case the user sees the same broken page again
  // (the exact complaint that motivated this rewrite).
  const hardReload = () => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("_recover", String(Date.now()));
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  };

  // Sign out — clears Supabase auth state, then sends the user to
  // the root (where AuthGate will render the login screen). Imports
  // the client lazily so the error boundary doesn't depend on the
  // module that's potentially the source of the crash.
  const signOutAndReset = async () => {
    if (typeof window === "undefined") return;
    try {
      const { supabase } = await import("@/lib/supabase");
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // If even sign-out throws, fall through to the hard reload —
      // at minimum the user gets a fresh bundle.
    }
    try {
      sessionStorage.clear();
    } catch { /* private mode */ }
    hardReload();
  };

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
          The app hit an unexpected error. Try the hard-reload first — most
          errors clear with a fresh bundle. If it keeps happening, sign out
          and back in.
        </p>
        {error.digest && (
          <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-3 font-mono">
            Ref: {error.digest}
          </p>
        )}

        {/* Inline details for the curious / for support tickets. Hidden
            by default so the average user isn't faced with a stack.
            We surface BOTH message and stack — for minified React
            errors like #300 the message alone ("Too many re-renders")
            doesn't pin down which component is looping; the stack
            does. Without the stack a "Show details" panel is just
            decorative. */}
        {(error.message || error.stack) && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setShowDetails(s => !s)}
              className="text-[10px] uppercase tracking-widest text-gray-400 hover:text-navy underline font-bold"
            >
              {showDetails ? "Hide details" : "Show details"}
            </button>
            {showDetails && (
              <pre className="mt-2 text-[10px] font-mono text-gray-600 bg-gray-50 border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words leading-snug max-h-48 overflow-y-auto">
                {error.message}
                {error.stack ? `\n\n${error.stack}` : ''}
              </pre>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={hardReload}
            className="w-full bg-navy text-white font-oswald text-sm font-bold uppercase tracking-widest py-3 rounded-lg shadow active:scale-95 transition-transform"
          >
            Hard Reload
          </button>
          <div className="flex gap-2">
            <button
              onClick={reset}
              className="flex-1 bg-white border border-gray-300 text-navy font-oswald text-sm font-bold uppercase tracking-widest py-3 rounded-lg active:scale-95 transition-transform"
            >
              Try Again
            </button>
            <button
              onClick={signOutAndReset}
              className="flex-1 bg-white border border-gray-300 text-navy font-oswald text-sm font-bold uppercase tracking-widest py-3 rounded-lg active:scale-95 transition-transform"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

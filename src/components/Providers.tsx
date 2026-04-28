"use client";

import { SWRConfig } from "swr";
import { ToastProvider } from "@/components/ToastProvider";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { localStorageCacheProvider } from "@/lib/swrCache";

// Slow-network watchdog. Without this, a Supabase RPC stuck on a slow
// connection leaves the tab spinning indefinitely with no feedback.
// SWR fires `onLoadingSlow` after this many ms; the global handler
// surfaces a one-shot toast so the pilot knows we're alive but slow
// and can decide whether to wait or check connectivity.
const LOADING_TIMEOUT_MS = 12_000;

// Toast dedup key — SWR can fire onLoadingSlow per-key, but we only
// want one toast per slow window across the whole app.
let lastSlowToastAt = 0;
const SLOW_TOAST_COOLDOWN_MS = 30_000;

function maybeToastSlowNetwork() {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastSlowToastAt < SLOW_TOAST_COOLDOWN_MS) return;
  lastSlowToastAt = now;
  window.dispatchEvent(new CustomEvent("aft:slow-network"));
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        provider: localStorageCacheProvider,
        revalidateOnFocus: false,
        revalidateIfStale: true,
        dedupingInterval: 10000,
        loadingTimeout: LOADING_TIMEOUT_MS,
        onLoadingSlow: maybeToastSlowNetwork,
        // Cap retries so a fetcher that consistently throws (RLS gap,
        // schema drift, persistent 5xx) doesn't burn 30+ seconds of
        // exponential backoff per key per mount. The recent SWR-throw-
        // on-error sweep (commits 5cdd8bb…fe1ff6a) made every transient
        // failure visible to SWR; with 50+ useSWR sites in the app, the
        // default 5-retry-with-backoff easily snowballs into UI lag.
        // Two attempts is enough for a real flap; beyond that the
        // user gets the error UI faster.
        errorRetryCount: 2,
        errorRetryInterval: 3000,
      }}
    >
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </SWRConfig>
  );
}

"use client";

import { SWRConfig } from "swr";
import { ToastProvider } from "@/components/ToastProvider";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { UpdateAvailableBanner } from "@/components/UpdateAvailableBanner";
import { ReconnectingIndicator } from "@/components/ReconnectingIndicator";
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
        // Bail on aborts and timeouts. Tail-switch + resume both fire
        // `abortInFlightSupabaseReads()` + `abortAllInFlightAuthFetches()`
        // by design — the in-flight fetcher rejects with AbortError /
        // TimeoutError, but to SWR that's indistinguishable from a real
        // network failure. The default retry path then reschedules each
        // aborted fetch ×2 with 3 s backoff, so every tail switch on a
        // tab with N useSWR hooks queues ~2N retries against iOS's
        // shallow socket pool. Across 4-5 rapid switches the pool is
        // saturated by retries from prior tails and the destination
        // aircraft's fresh fetches sit forever — that's the field
        // symptom: switch 4 aircraft fine, on the 5th nothing loads
        // (status dot gray, avatar placeholder, no logs / squawks).
        //
        // We treat any AbortError / TimeoutError / AUTHFETCH_RESUMED /
        // AUTHFETCH_TIMEOUT as a deliberate cancellation and DON'T retry.
        // SWR's revalidate-on-mount + the per-key `globalMutate` from
        // `revalidateAircraftCache` will fire a fresh fetch on the
        // active tail when the user actually wants the data.
        onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
          const err: any = error;
          const name = err?.name || '';
          const code = err?.code || '';
          const msg = String(err?.message || '');
          if (name === 'AbortError' || name === 'TimeoutError') return;
          if (code === 'AUTHFETCH_RESUMED' || code === 'AUTHFETCH_TIMEOUT') return;
          // Supabase-js sometimes flattens AbortError into a plain
          // Error whose message includes the original DOMException
          // name — match those defensively.
          if (msg.includes('AbortError') || msg.includes('TimeoutError')) return;
          if (msg.includes('aborted') || msg.includes('supabase_aborted') || msg.includes('supabase_fetch_timeout')) return;
          if (msg.includes('authfetch_resumed') || msg.includes('authfetch_timeout')) return;
          if (retryCount >= 2) return;
          setTimeout(() => revalidate({ retryCount }), 3000);
        },
      }}
    >
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
        <UpdateAvailableBanner />
        <ReconnectingIndicator />
      </ToastProvider>
    </SWRConfig>
  );
}

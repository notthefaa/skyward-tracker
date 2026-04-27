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
      }}
    >
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </SWRConfig>
  );
}

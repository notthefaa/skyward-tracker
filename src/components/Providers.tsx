"use client";

import { SWRConfig } from "swr";
import { ToastProvider } from "@/components/ToastProvider";
import { localStorageCacheProvider } from "@/lib/swrCache";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        provider: localStorageCacheProvider,
        revalidateOnFocus: false,
        revalidateIfStale: true,
        dedupingInterval: 10000,
      }}
    >
      <ToastProvider>{children}</ToastProvider>
    </SWRConfig>
  );
}

"use client";

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";

/**
 * Listens for `aft:version-stale` events (dispatched by AuthGate when
 * the deployed app version differs from the one this client booted
 * with) and shows a non-blocking banner offering a refresh.
 *
 * Why a banner instead of an auto-reload: pilots are often mid-form
 * (logging a flight, completing a mx event, talking to Howard) when
 * a deploy lands. Silently reloading destroys their in-progress
 * input. The banner lets them finish and refresh on their own.
 *
 * Dismiss snoozes the banner for the same version — if a newer
 * version ships later in the session, the banner reappears.
 */
export function UpdateAvailableBanner() {
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  const [snoozedVersion, setSnoozedVersion] = useState<string | null>(null);

  useEffect(() => {
    const onStale = (e: Event) => {
      const detail = (e as CustomEvent<{ version: string }>).detail;
      if (!detail?.version) return;
      setPendingVersion(detail.version);
    };
    window.addEventListener("aft:version-stale", onStale as EventListener);
    return () => window.removeEventListener("aft:version-stale", onStale as EventListener);
  }, []);

  if (!pendingVersion || pendingVersion === snoozedVersion) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 z-[10002] w-[calc(100%-1rem)] max-w-md"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
    >
      <div className="bg-[#091F3C] text-white rounded-lg shadow-[0_10px_25px_rgba(0,0,0,0.3)] border border-white/10 px-4 py-3 flex items-center gap-3">
        <RefreshCw size={18} className="text-brandOrange shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-roboto text-sm font-medium leading-tight">New version available</p>
          <p className="font-roboto text-[11px] text-gray-300 leading-tight mt-0.5">Refresh when you&rsquo;re at a stopping point.</p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="bg-brandOrange text-white font-oswald text-xs uppercase tracking-widest px-3 py-1.5 rounded shrink-0 active:scale-95 transition-transform"
        >
          Refresh
        </button>
        <button
          onClick={() => setSnoozedVersion(pendingVersion)}
          className="text-gray-400 hover:text-white shrink-0 -mr-1"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

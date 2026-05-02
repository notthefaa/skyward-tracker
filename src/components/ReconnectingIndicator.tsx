"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Listens for `aft:reconnecting` events (dispatched by AppShell's
 * resume handler when a backgrounded PWA returns to the foreground)
 * and shows a small pill for a moment so the abort+revalidate cycle
 * reads as intentional rather than glitchy.
 *
 * Why a pill instead of a banner: this fires every time the user
 * foregrounds, which can be many times a session — a centered banner
 * would feel intrusive. The pill sits in the status-bar corner, fades
 * out automatically, and clears within ~1.5s on a healthy resume.
 */
export function ReconnectingIndicator() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onReconnecting = () => {
      setVisible(true);
      // Auto-clear so the pill never sticks. The actual revalidation
      // runs longer than this in pathological cases, but the user
      // doesn't need a continuous "still working…" — they need a
      // confirmation that something is happening, then quiet UI.
      const t = setTimeout(() => setVisible(false), 1500);
      return () => clearTimeout(t);
    };
    window.addEventListener("aft:reconnecting", onReconnecting);
    return () => window.removeEventListener("aft:reconnecting", onReconnecting);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-3 z-[10002] pointer-events-none"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
    >
      <div className="bg-[#091F3C]/90 backdrop-blur-sm text-white rounded-full shadow-md px-3 py-1.5 flex items-center gap-2 animate-fade-in">
        <RefreshCw size={12} className="text-brandOrange animate-spin" />
        <span className="font-roboto text-[11px] font-medium leading-none">Reconnecting…</span>
      </div>
    </div>
  );
}

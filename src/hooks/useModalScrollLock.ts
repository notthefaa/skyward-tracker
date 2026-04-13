"use client";

import { useEffect } from "react";

/**
 * Prevents the background <main> content from scrolling while a modal
 * is open, and keeps the active input visible when the mobile keyboard
 * appears.  Supports stacking — multiple concurrent modals share one
 * lock and only the last unmount restores scroll.
 *
 * @param enabled  Pass `false` (or a boolean state) to skip locking
 *                 without violating the rules-of-hooks.
 */

let lockCount = 0;

export function useModalScrollLock(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const main = document.querySelector("main");

    if (lockCount === 0 && main) {
      main.style.overflowY = "hidden";
    }
    lockCount++;

    // --- Keyboard visibility: keep focused input in view ---
    const vv = window.visualViewport;

    const handleResize = () => {
      const focused = document.activeElement as HTMLElement | null;
      if (
        focused &&
        (focused.tagName === "INPUT" ||
          focused.tagName === "TEXTAREA" ||
          focused.tagName === "SELECT")
      ) {
        setTimeout(() => {
          focused.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 80);
      }
    };

    vv?.addEventListener("resize", handleResize);

    return () => {
      vv?.removeEventListener("resize", handleResize);
      lockCount--;
      if (lockCount === 0 && main) {
        main.style.overflowY = "";
      }
    };
  }, [enabled]);
}

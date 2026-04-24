"use client";

// =============================================================
// Modal portal — renders children into document.body so that a
// `fixed inset-0` backdrop is positioned against the true viewport
// instead of an ancestor containing block.
//
// Why it exists: <main> in AppShell is `position: fixed` with
// `-webkit-overflow-scrolling: touch`. On iOS Safari that pair
// creates a containing block for fixed descendants, so a modal
// rendered in-tree inside <main> anchors to <main>'s bounds (and
// to the user's scroll position within <main>) rather than the
// viewport. Result: modals appear low on screen after the user
// has scrolled to reach the thing they clicked.
//
// Any modal that lives below <main> in the tree — most tab-level
// log / edit / create modals — should wrap its JSX with this.
// Modals rendered directly from AppShell (AircraftModal,
// SettingsModal, AdminModals) are already siblings of <main>
// and don't need it.
// =============================================================

import { createPortal } from "react-dom";

export function ModalPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

/**
 * Z-index tiers for the whole app.
 *
 * Before this file, z-index values drifted across `z-[60]`, `z-[70]`,
 * `z-[9997]`–`z-[9999]`, `z-[10000]`–`z-[10002]`, and `z-[99999]`. The
 * five-decade spread was mostly accidental; the actual stacking order
 * we care about is:
 *
 *   tour / spotlight > photo viewer > toast > modal overlay > modal >
 *   dropdown > header/nav > page content
 *
 * Use these constants in new code via inline style:
 *   <div style={{ zIndex: Z.MODAL }} />
 *
 * Or as Tailwind arbitrary classes when staying in string-only className:
 *   className={`... z-[${Z.MODAL}]`}
 *
 * Existing call sites using raw `z-[9999]` etc. still work — this file
 * gives new code a single source of truth without a forced migration.
 */
export const Z = {
  /** Header, bottom nav, sticky tabs — above page content, below modals. */
  NAV: 50,
  /** Sticky panels that should stay above the tab body but below overlays. */
  STICKY_HEADER: 60,
  /** Dropdowns and popovers anchored to nav (tail picker, admin menu). */
  DROPDOWN: 70,
  /** Global toast notifications — above dropdowns, below modals so a
   *  modal still captures focus, but above the page so background toasts
   *  don't hide behind tab content. */
  TOAST: 80,
  /** Modal overlay (the dimming backdrop). */
  MODAL_OVERLAY: 100,
  /** The modal card itself — paired with MODAL_OVERLAY, card sits on top. */
  MODAL: 110,
  /** A modal-in-a-modal case (e.g. the confirm dialog above the delete
   *  flow). Rarely needed; prefer composing into a single modal. */
  MODAL_STACKED: 120,
  /** Full-screen photo/attachment viewer. Sits above modals so a squawk
   *  detail modal's photo zoom is still usable. */
  PHOTO_VIEWER: 130,
  /** Post-onboarding spotlight tour and any other opaque full-screen
   *  teaching surface. Above everything except confirm-on-top-of-tour. */
  TOUR: 9999,
} as const;

/**
 * Legacy-value mapping table for reference. Don't import this; use `Z`.
 * Here for the audit-aware developer who wants to see what the raw
 * `z-[N]` values used to signify.
 */
export const LEGACY_Z_REFERENCE = {
  'z-[60]': 'dropdowns, some modals (TimesTab legend)',
  'z-[70]': 'dropdowns, some modals (SummaryTab delete/fuel/invite)',
  'z-[9997]': 'header/nav area',
  'z-[9998]': 'Howard floating FAB',
  'z-[9999]': 'shell nav, tour overlay',
  'z-[10000]': 'content modals',
  'z-[10001]': 'modal-stacked (export confirm, detail viewer)',
  'z-[10002]': 'nested photo viewers',
  'z-[99999]': 'Howard launcher (full-screen popup)',
} as const;

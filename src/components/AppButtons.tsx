import { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Filled navy CTA — the dominant "do the thing" button across the app.
 * Use for submit, save, confirm, primary progression.
 */
export function PrimaryButton({ children, onClick, disabled }: { children: ReactNode, onClick?: () => void, disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full bg-navy text-white font-oswald tracking-widest uppercase py-3 px-4 rounded hover:bg-opacity-90 active:scale-95 transition-all duration-150 ease-out flex justify-center items-center gap-2 text-sm disabled:opacity-50 disabled:active:scale-100 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

/**
 * Outlined neutral button — the canonical "cancel / back / decline /
 * alternate action" pattern. Pairs with PrimaryButton inside two-button
 * rows. Replaces the ~10 different inline `border border-gray-300` /
 * `border-2 border-gray-200` variants scattered across modals.
 *
 * Width is caller-controlled via className — pass `w-full` for solo
 * use, `flex-1` (or `flex-[N]`) for paired rows. This way the same
 * component works for both shapes without needing two variants.
 */
export function SecondaryButton({ children, onClick, disabled, type = "button", className = "" }: { children: ReactNode, onClick?: () => void, disabled?: boolean, type?: "button" | "submit", className?: string }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`border border-gray-300 text-gray-600 font-oswald font-bold tracking-widest uppercase py-3 px-4 rounded hover:bg-gray-50 active:scale-95 transition-all duration-150 ease-out flex justify-center items-center gap-2 text-sm disabled:opacity-50 disabled:active:scale-100 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Dashed-outline "add new" affordance — already used on a few tabs for
 * the "+ Add equipment / Start from template" style entry points.
 */
export function AddButton({ children, onClick }: { children: ReactNode, onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full border-dashed border-2 border-gray-300 text-navy font-bold py-3 px-4 rounded hover:bg-gray-50 active:scale-95 transition-all duration-150 ease-out flex justify-center items-center gap-2 text-sm"
    >
      {children}
    </button>
  );
}

/**
 * The X-close button used at the top-right of every modal. Positioned
 * absolutely by default; the parent is responsible for being
 * `position: relative` (or the modal card header being a flex row with
 * the X as its last child, which is the dominant pattern).
 *
 * Centralizes the three drifting variants I found in the audit:
 * `top-4 right-4`, `top-3 right-3`, and `-mr-2 p-2`.
 */
export function ModalCloseButton({ onClick, ariaLabel = "Close" }: { onClick: () => void, ariaLabel?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className="text-gray-400 hover:text-[#CE3732] p-2 -mr-2 active:scale-95 transition-colors"
    >
      <X size={24} />
    </button>
  );
}

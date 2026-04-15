"use client";

import { HowardIcon } from "@/components/shell/TrayIcons";

interface AskHowardButtonProps {
  prompt: string;
  autoSend?: boolean;
  label?: string;
  size?: "xs" | "sm" | "md";
  className?: string;
  title?: string;
  /** Fired before navigation — use to switch the active aircraft, etc. */
  onBeforeOpen?: () => void;
  /** Icon-only circular pill (no label) for tight spaces like fleet cards. */
  iconOnly?: boolean;
}

/**
 * Contextual entry point to the Howard AI assistant. Embed anywhere in the
 * app to let the user jump to Howard with a pre-filled question about the
 * current record (squawk, MX item, flight log row, document, etc.).
 *
 * On click, the prompt is stashed in sessionStorage and a custom event is
 * dispatched that AppShell listens for to switch to the Howard tab.
 */
export default function AskHowardButton({
  prompt,
  autoSend = true,
  label = "Ask Howard",
  size = "sm",
  className = "",
  title,
  onBeforeOpen,
  iconOnly = false,
}: AskHowardButtonProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      sessionStorage.setItem(
        'aft_howard_prefill',
        JSON.stringify({ prompt, autoSend })
      );
    } catch {}
    onBeforeOpen?.();
    window.dispatchEvent(new CustomEvent('aft:navigate-howard'));
  };

  const iconSize = size === "xs" ? 12 : size === "sm" ? 14 : 16;

  if (iconOnly) {
    const padCls = size === "xs" ? "p-1" : size === "sm" ? "p-1.5" : "p-2";
    return (
      <button
        type="button"
        onClick={handleClick}
        title={title || label}
        aria-label={label}
        className={`inline-flex items-center justify-center rounded-full bg-[#0EA5E9]/10 text-[#0EA5E9] hover:bg-[#0EA5E9]/20 border border-[#0EA5E9]/30 active:scale-95 transition-all shrink-0 ${padCls} ${className}`}
      >
        <HowardIcon size={iconSize} style={{ color: '#0EA5E9' }} />
      </button>
    );
  }

  const sizeCls =
    size === "xs"
      ? "text-[9px] px-2 py-0.5 gap-1"
      : size === "sm"
        ? "text-[10px] px-2.5 py-1 gap-1.5"
        : "text-xs px-3 py-1.5 gap-2";

  const labelIconSize = size === "xs" ? 10 : size === "sm" ? 12 : 14;

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title || label}
      aria-label={label}
      className={`inline-flex items-center font-bold uppercase tracking-widest rounded-full bg-[#0EA5E9]/10 text-[#0EA5E9] hover:bg-[#0EA5E9]/20 border border-[#0EA5E9]/30 active:scale-95 transition-all shrink-0 ${sizeCls} ${className}`}
    >
      <HowardIcon size={labelIconSize} style={{ color: '#0EA5E9' }} />
      <span>{label}</span>
    </button>
  );
}

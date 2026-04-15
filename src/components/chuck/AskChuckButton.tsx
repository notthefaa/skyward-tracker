"use client";

import { ChuckIcon } from "@/components/shell/TrayIcons";

interface AskChuckButtonProps {
  prompt: string;
  autoSend?: boolean;
  label?: string;
  size?: "xs" | "sm" | "md";
  className?: string;
  title?: string;
  /** Fired before navigation — use to switch the active aircraft, etc. */
  onBeforeOpen?: () => void;
}

/**
 * Contextual entry point to the Chuck AI assistant. Embed anywhere in the
 * app to let the user jump to Chuck with a pre-filled question about the
 * current record (squawk, MX item, flight log row, document, etc.).
 *
 * On click, the prompt is stashed in sessionStorage and a custom event is
 * dispatched that AppShell listens for to switch to the Chuck tab.
 */
export default function AskChuckButton({
  prompt,
  autoSend = true,
  label = "Ask Chuck",
  size = "sm",
  className = "",
  title,
  onBeforeOpen,
}: AskChuckButtonProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      sessionStorage.setItem(
        'aft_chuck_prefill',
        JSON.stringify({ prompt, autoSend })
      );
    } catch {}
    onBeforeOpen?.();
    window.dispatchEvent(new CustomEvent('aft:navigate-chuck'));
  };

  const sizeCls =
    size === "xs"
      ? "text-[9px] px-2 py-0.5 gap-1"
      : size === "sm"
        ? "text-[10px] px-2.5 py-1 gap-1.5"
        : "text-xs px-3 py-1.5 gap-2";

  const iconSize = size === "xs" ? 10 : size === "sm" ? 12 : 14;

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title || label}
      aria-label={label}
      className={`inline-flex items-center font-bold uppercase tracking-widest rounded-full bg-[#0EA5E9]/10 text-[#0EA5E9] hover:bg-[#0EA5E9]/20 border border-[#0EA5E9]/30 active:scale-95 transition-all shrink-0 ${sizeCls} ${className}`}
    >
      <ChuckIcon size={iconSize} style={{ color: '#0EA5E9' }} />
      <span>{label}</span>
    </button>
  );
}

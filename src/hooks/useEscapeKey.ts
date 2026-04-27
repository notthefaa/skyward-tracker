import { useEffect } from 'react';

/**
 * Trigger `onEscape` whenever the user presses Escape while the modal
 * is mounted/active. Listener attaches to `window` so it fires
 * regardless of focus position — important for modals where focus
 * might be on a textarea or canvas instead of a button.
 *
 * Pass `enabled = false` to suspend the listener (e.g. when a nested
 * dropdown wants to capture Escape first).
 */
export function useEscapeKey(onEscape: () => void, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onEscape, enabled]);
}

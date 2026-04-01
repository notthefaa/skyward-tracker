import { useEffect } from "react";

/**
 * Overrides body overflow styles for pages that need native scrolling
 * (service portal, squawk viewer) without using dangerouslySetInnerHTML.
 *
 * Applied on mount, cleaned up on unmount.
 */
export function useBodyScrollOverride() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    // Save original styles
    const originalHtmlOverflow = html.style.overflow;
    const originalBodyOverflow = body.style.overflow;
    const originalHtmlTouchAction = html.style.touchAction;
    const originalBodyTouchAction = body.style.touchAction;
    const originalHtmlHeight = html.style.height;
    const originalBodyHeight = body.style.height;

    // Apply overrides
    html.style.overflow = 'auto';
    body.style.overflow = 'auto';
    html.style.touchAction = 'auto';
    body.style.touchAction = 'auto';
    html.style.height = 'auto';
    body.style.height = 'auto';

    return () => {
      html.style.overflow = originalHtmlOverflow;
      body.style.overflow = originalBodyOverflow;
      html.style.touchAction = originalHtmlTouchAction;
      body.style.touchAction = originalBodyTouchAction;
      html.style.height = originalHtmlHeight;
      body.style.height = originalBodyHeight;
    };
  }, []);
}

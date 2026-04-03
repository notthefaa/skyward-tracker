import { useEffect } from "react";

/**
 * Overrides body overflow styles for pages that need native scrolling
 * (service portal, squawk viewer) without using dangerouslySetInnerHTML.
 *
 * The main app's globals.css locks html/body to overflow:hidden, height:100%,
 * touch-action:none, and overscroll-behavior-y:none. This hook reverses all
 * of those so the page scrolls naturally.
 *
 * Applied on mount, cleaned up on unmount.
 */
export function useBodyScrollOverride() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    // Save original styles
    const originals = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      htmlTouchAction: html.style.touchAction,
      bodyTouchAction: body.style.touchAction,
      htmlHeight: html.style.height,
      bodyHeight: body.style.height,
      htmlWidth: html.style.width,
      bodyWidth: body.style.width,
      htmlOverscroll: html.style.overscrollBehaviorY,
      bodyOverscroll: body.style.overscrollBehaviorY,
    };

    // Apply overrides — must counter everything globals.css sets on html, body
    html.style.overflow = 'auto';
    body.style.overflow = 'auto';
    html.style.touchAction = 'auto';
    body.style.touchAction = 'auto';
    html.style.height = 'auto';
    body.style.height = 'auto';
    html.style.width = '100%';
    body.style.width = '100%';
    html.style.overscrollBehaviorY = 'auto';
    body.style.overscrollBehaviorY = 'auto';
    // Enable momentum scrolling on iOS Safari
    (body.style as any).webkitOverflowScrolling = 'touch';

    return () => {
      html.style.overflow = originals.htmlOverflow;
      body.style.overflow = originals.bodyOverflow;
      html.style.touchAction = originals.htmlTouchAction;
      body.style.touchAction = originals.bodyTouchAction;
      html.style.height = originals.htmlHeight;
      body.style.height = originals.bodyHeight;
      html.style.width = originals.htmlWidth;
      body.style.width = originals.bodyWidth;
      html.style.overscrollBehaviorY = originals.htmlOverscroll;
      body.style.overscrollBehaviorY = originals.bodyOverscroll;
      (body.style as any).webkitOverflowScrolling = '';
    };
  }, []);
}

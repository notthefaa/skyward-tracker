// =============================================================
// SHARED STYLE CONSTANTS
// iOS Safari requires explicit background-color on form inputs
// due to -webkit-appearance override in globals.css.
// These constants eliminate duplication across all components.
// =============================================================

/**
 * Inline style object for forcing white backgrounds on form inputs.
 * Required because iOS Safari applies its own grey background to inputs,
 * and the CSS fix in globals.css needs an explicit background-color.
 *
 * Usage: <input style={INPUT_WHITE_BG} className="..." />
 */
export const INPUT_WHITE_BG = { backgroundColor: '#ffffff' } as const;

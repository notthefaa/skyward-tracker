/**
 * Canonical Howard persona copy. Single source of truth so the tone
 * stays consistent across the welcome modal, launcher, full-page tab,
 * empty states, and any future Howard surface. Changing these strings
 * updates every surface at once.
 *
 * The systemPrompt.ts HOWARD_STABLE_PRELUDE is the AI's internal
 * persona contract — these are the user-facing descriptions that
 * match it.
 */

/** One-sentence who-is-Howard for headers + card subtitles. */
export const HOWARD_TAGLINE = "Your hangar helper and advisor.";

/**
 * Two-sentence bio for the welcome modal and any "about Howard" card.
 * Matches the user-provided persona description: seasoned old-school
 * aviator, reimagined as an AI advisor, hangs around the hangar
 * digitally.
 */
export const HOWARD_BIO =
  "Howard is a seasoned, old-school aviator — weathered, sharp-eyed, and rich with thousands of hours of experience. Reimagined as an AI advisor, he hangs around your hangar digitally, offering calm guidance, practical advice, and hard-earned wisdom when you need a steady voice.";

/**
 * Short intro line Howard uses when he's "speaking" in first person in
 * the UI — inside the launcher popup menu, empty-state chat, etc.
 * Keep it warm and terse; the persona bio above carries the full
 * description when space allows.
 */
export const HOWARD_FIRST_PERSON_INTRO =
  "Hey, I'm Howard — your hangar helper and advisor. Plenty of aviation stories in me, but first: what can I help you with?";

/**
 * First line Howard says on the onboarding surface. Warmer + more
 * invitation-forward than the general launcher intro, because it's
 * also the user's first impression of the character. Keep it under
 * three sentences so it reads fast on mobile.
 */
export const HOWARD_ONBOARDING_GREETING =
  "Hey there — Howard here. I'll walk you through getting set up. A few quick questions about you, then we'll build out your first aircraft together. Sound good?";

/**
 * PIC-authority disclaimer shown alongside Howard surfaces. The legal
 * boundary is critical — Howard advises, the pilot-in-command decides.
 */
export const HOWARD_PIC_DISCLAIMER =
  "The PIC retains all legal authority over airworthiness and go/no-go decisions. Howard provides data and helps you think through it — not legal or operational advice.";

/** Path to the brand logo used across all Howard surfaces. */
export const HOWARD_LOGO_PATH = "/howard-logo.svg";

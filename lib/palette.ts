// Source of truth for these tokens is the YUZU DESIGN.md palette section.
// Keep these values in sync with app/globals.css.

// The sculpture's ink ramp, bright to muted. Eight stops so the solid
// can pass through a run of colour rather than one transition; the
// renderer dithers between whichever two a block falls between, so no
// blend is ever produced and every pixel is exactly one of these.
//
// The ramp is one path: yellow desaturating to a yellow-grey. It used
// to run through burnt orange, which read as brown against the yellows
// and broke the run into two different ideas.
//
// Only YUZU_YELLOW comes from the design doc's palette section; the
// rest were added for this ramp, noted here because this file names
// that doc as its source of truth.
export const YUZU_PALE = "#FCEE8A";
export const YUZU_LEMON = "#F8E262";
export const YUZU_YELLOW = "#F5D84A";
export const YUZU_GOLD = "#EBCB4A";
export const YUZU_STRAW = "#DCC257";
export const YUZU_LINEN = "#CCBB6B";
export const YUZU_STONE = "#BEB47D";
export const YUZU_ASH = "#B3AC8E";

/** The ramp in order. Index 0 is the first ink, the last is the scarcest. */
export const INK_RAMP = [
  YUZU_PALE,
  YUZU_LEMON,
  YUZU_YELLOW,
  YUZU_GOLD,
  YUZU_STRAW,
  YUZU_LINEN,
  YUZU_STONE,
  YUZU_ASH,
] as const;

// Not on the ramp. Kept because the page chrome uses it.
export const YUZU_ZEST = "#E8A020";

export const YUZU_WHITE = "#FAFAF5";
export const INK = "#1A1A2E";
export const INK_SECONDARY = "#4A4A6A";
export const INK_MUTED = "#9A9ABA";
export const SURFACE_BORDER = "#E8E0C8";
export const DIVIDER = "#EDEAE0";

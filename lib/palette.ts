// Source of truth for these tokens is the YUZU DESIGN.md palette section.
// Keep these values in sync with app/globals.css.

// The sculpture's ink ramp, light to dark. Eight stops so the solid can
// pass through a run of colour rather than one transition; the renderer
// dithers between whichever two a block falls between, so no blend is
// ever produced and every pixel is exactly one of these.
//
// Only YUZU_YELLOW and YUZU_ZEST come from the design doc's palette
// section. The other six were added for this ramp — noting that, since
// this file names that doc as its source of truth.
export const YUZU_PALE = "#FBEB7A";
export const YUZU_YELLOW = "#F5D84A";
export const YUZU_GOLD = "#F0C232";
export const YUZU_AMBER = "#EDAE28";
export const YUZU_ZEST = "#E8A020";
export const YUZU_RIND = "#D9791C";
export const YUZU_EMBER = "#C1541F";
export const YUZU_ASH = "#B3AC8E";

/** The ramp in order. Index 0 is the first ink, the last is the scarcest. */
export const INK_RAMP = [
  YUZU_PALE,
  YUZU_YELLOW,
  YUZU_GOLD,
  YUZU_AMBER,
  YUZU_ZEST,
  YUZU_RIND,
  YUZU_EMBER,
  YUZU_ASH,
] as const;

export const YUZU_WHITE = "#FAFAF5";
export const INK = "#1A1A2E";
export const INK_SECONDARY = "#4A4A6A";
export const INK_MUTED = "#9A9ABA";
export const SURFACE_BORDER = "#E8E0C8";
export const DIVIDER = "#EDEAE0";

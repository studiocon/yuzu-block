import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DIVIDER,
  INK,
  INK_MUTED,
  INK_SECONDARY,
  SURFACE_BORDER,
  YUZU_WHITE,
  YUZU_YELLOW,
  YUZU_ZEST,
} from "@/lib/palette";

// Guards against `app/globals.css` and `lib/palette.ts` drifting apart —
// CLAUDE.md requires every rendered color to trace back to lib/palette.ts,
// and globals.css duplicates the same tokens as CSS custom properties for
// non-canvas chrome (background, etc).

const CSS_PATH = path.join(process.cwd(), "app/globals.css");

function readCssVar(css: string, name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!match) {
    throw new Error(`--${name} not found in app/globals.css`);
  }
  return match[1];
}

describe("palette drift", () => {
  const css = readFileSync(CSS_PATH, "utf-8");

  const pairs: Array<[string, string]> = [
    ["yuzu-yellow", YUZU_YELLOW],
    ["yuzu-zest", YUZU_ZEST],
    ["yuzu-white", YUZU_WHITE],
    ["ink", INK],
    ["ink-secondary", INK_SECONDARY],
    ["ink-muted", INK_MUTED],
    ["surface-border", SURFACE_BORDER],
    ["divider", DIVIDER],
  ];

  for (const [cssVarName, tsValue] of pairs) {
    it(`--${cssVarName} matches lib/palette.ts`, () => {
      const cssValue = readCssVar(css, cssVarName);
      expect(cssValue.toLowerCase()).toBe(tsValue.toLowerCase());
    });
  }
});

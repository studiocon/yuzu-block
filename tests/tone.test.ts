import { describe, expect, it } from "vitest";
import { INK_RAMP } from "@/lib/palette";
import {
  RAMP_POSITIONS,
  RAMP_STOPS,
  toneFromRank,
  tonesFromBases,
} from "@/lib/tone";

describe("ink ramp", () => {
  it("has as many stops as the shader indexes", () => {
    // The shader steps vTone across RAMP_STOPS - 1 segments and indexes
    // a uniform array of that length; a mismatch reads past the end.
    expect(INK_RAMP).toHaveLength(RAMP_STOPS);
  });

  it("is made only of palette hexes", () => {
    for (const hex of INK_RAMP) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe("tonesFromBases", () => {
  it("is flat in rank, whatever shape the bases have", () => {
    // The whole point: a bell-shaped input must still reach the top of
    // the ramp, or the last stop renders at zero.
    const bell = Array.from({ length: 2000 }, (_, i) => {
      const u = i / 1999;
      return 0.5 + 0.18 * Math.sin(u * Math.PI * 2) + 0.12 * Math.cos(u * 11);
    });
    const tones = tonesFromBases(bell);
    expect(Math.min(...tones)).toBeCloseTo(0, 6);
    expect(Math.max(...tones)).toBeCloseTo(1, 6);
  });

  it("keeps the last ink scarce, but present", () => {
    // The share of dots that land on the final stop: inside the last
    // segment the screen picks it with probability `along`, and never
    // outside. Both bounds matter — it once rendered at exactly 0%, and
    // it is only tolerable while it stays small.
    const flat = Array.from({ length: 5000 }, (_, i) => i / 4999);
    const tones = tonesFromBases(flat);
    const last = RAMP_POSITIONS[RAMP_STOPS - 1];
    const penultimate = RAMP_POSITIONS[RAMP_STOPS - 2];

    const share =
      tones.reduce(
        (n, t) => n + (t >= penultimate ? (t - penultimate) / (last - penultimate) : 0),
        0,
      ) / tones.length;

    // Low bound: the muted FAMILY is what is held to a few per cent,
    // and the last token is only a slice of it. Both ends still matter
    // — it once rendered at exactly 0%.
    expect(share).toBeGreaterThan(0.004);
    expect(share).toBeLessThan(0.03);
  });

  it("preserves order", () => {
    const tones = tonesFromBases([0.9, 0.1, 0.5]);
    expect(tones[1]).toBeLessThan(tones[2]);
    expect(tones[2]).toBeLessThan(tones[0]);
  });

  it("is deterministic under ties", () => {
    const bases = [0.4, 0.4, 0.4, 0.4];
    expect(tonesFromBases(bases)).toEqual(tonesFromBases(bases));
  });

  it("handles the degenerate sizes", () => {
    expect(tonesFromBases([])).toEqual([]);
    expect(tonesFromBases([0.7])).toEqual([toneFromRank(0.5)]);
  });

  it("leaves the shaping to the stop positions", () => {
    // Tone is a flat rank; the ramp is shaped by where the stops sit,
    // not by bending the rank underneath them.
    expect(toneFromRank(0.5)).toBe(0.5);
    expect(toneFromRank(0)).toBe(0);
    expect(toneFromRank(1)).toBe(1);
  });

  it("gives the light stops most of the area", () => {
    const lightEnd = RAMP_POSITIONS[3];
    expect(lightEnd).toBeGreaterThan(0.65);
  });
});

describe("ramp positions", () => {
  it("has one position per stop, ascending, spanning the range", () => {
    expect(RAMP_POSITIONS).toHaveLength(RAMP_STOPS);
    expect(RAMP_POSITIONS[0]).toBe(0);
    expect(RAMP_POSITIONS[RAMP_POSITIONS.length - 1]).toBe(1);
    for (let i = 1; i < RAMP_POSITIONS.length; i++) {
      expect(RAMP_POSITIONS[i]).toBeGreaterThan(RAMP_POSITIONS[i - 1]);
    }
  });

  it("is deliberately uneven", () => {
    // Even spacing would hand every ink the same area. The light stops
    // are meant to hold most of the surface, so the gaps differ widely.
    const widths = RAMP_POSITIONS.slice(1).map((p, i) => p - RAMP_POSITIONS[i]);
    expect(Math.max(...widths) / Math.min(...widths)).toBeGreaterThan(3);
  });
});

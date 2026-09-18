import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/seed";
import {
  groupColumns,
  nextColorDriftDelay,
  nextRegistrationDelay,
  nextRegistrationOffset,
  nextRevealDelay,
  pickColorFlip,
  registrationHoldMs,
  selectInitiallyHidden,
} from "@/lib/carve-schedule";
import type { Block, BlockColor } from "@/lib/types";

function singleColumn(height: number, color: BlockColor = "yellow"): Block[] {
  const blocks: Block[] = [];
  for (let y = 0; y < height; y++) {
    blocks.push({ x: 0, y, z: 0, color });
  }
  return blocks;
}

/** A small multi-ring scene: ring 0 (origin) plus rings 1..7 each with a
 * few filled cells, enough columns/rings to exercise the outer-ring pool. */
function multiRingScene(): Block[] {
  const blocks: Block[] = [];
  for (let ring = 0; ring <= 7; ring++) {
    const cells: Array<[number, number]> =
      ring === 0
        ? [[0, 0]]
        : [
            [ring, 0],
            [-ring, 0],
            [0, ring],
            [0, -ring],
          ];
    for (const [x, z] of cells) {
      const height = 3 + (ring % 3);
      const color: BlockColor = ring % 2 === 0 ? "yellow" : "zest";
      for (let y = 0; y < height; y++) {
        blocks.push({ x, y, z, color });
      }
    }
  }
  return blocks;
}

describe("groupColumns", () => {
  it("sorts each column's indices by ascending height", () => {
    const blocks: Block[] = [
      { x: 0, y: 2, z: 0, color: "yellow" },
      { x: 0, y: 0, z: 0, color: "yellow" },
      { x: 0, y: 1, z: 0, color: "yellow" },
    ];
    const columns = groupColumns(blocks);
    const indices = columns.get("0,0")!;
    expect(indices.map((i) => blocks[i].y)).toEqual([0, 1, 2]);
  });
});

describe("selectInitiallyHidden", () => {
  it("is deterministic for the same blocks and seed", () => {
    const blocks = multiRingScene();
    const a = selectInitiallyHidden(blocks, "seed-a");
    const b = selectInitiallyHidden(blocks, "seed-a");
    expect(a).toEqual(b);
  });

  it("produces a different pool for a different seed", () => {
    const blocks = multiRingScene();
    const a = selectInitiallyHidden(blocks, "seed-a");
    const b = selectInitiallyHidden(blocks, "seed-b");
    expect(a).not.toEqual(b);
  });

  it("never exceeds 10% of the total block count", () => {
    const blocks = multiRingScene();
    const cap = Math.floor(blocks.length * 0.1);
    for (const seed of ["s1", "s2", "s3", "s4"]) {
      const hidden = selectInitiallyHidden(blocks, seed);
      expect(hidden.size).toBeLessThanOrEqual(cap);
    }
  });

  it("returns an empty set when there are no blocks", () => {
    expect(selectInitiallyHidden([], "seed").size).toBe(0);
  });

  it("prefers the topmost block of a column when the cap forces a trim", () => {
    // A single ten-block column: cap = floor(10*0.1) = 1, and the
    // highest-priority pick (added first, for any rng draw) is always
    // the topmost block — so it must survive the trim to size 1.
    const blocks = singleColumn(10);
    const topIndex = blocks.length - 1; // y = 9, added first regardless of the 1-vs-2 coin flip
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const hidden = selectInitiallyHidden(blocks, seed);
      expect(hidden.size).toBeLessThanOrEqual(1);
      expect(hidden.has(topIndex)).toBe(true);
    }
  });
});

describe("nextRevealDelay", () => {
  it("stays within [900, 1800) ms", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 200; i++) {
      const delay = nextRevealDelay(rng);
      expect(delay).toBeGreaterThanOrEqual(900);
      expect(delay).toBeLessThan(1800);
    }
  });

  it("is deterministic for the same rng seed", () => {
    const a = nextRevealDelay(mulberry32(42));
    const b = nextRevealDelay(mulberry32(42));
    expect(a).toBe(b);
  });
});

describe("nextColorDriftDelay", () => {
  it("stays within [2500, 4000) ms", () => {
    const rng = mulberry32(2);
    for (let i = 0; i < 200; i++) {
      const delay = nextColorDriftDelay(rng);
      expect(delay).toBeGreaterThanOrEqual(2500);
      expect(delay).toBeLessThan(4000);
    }
  });
});

describe("pickColorFlip", () => {
  it("returns null when there are no columns", () => {
    expect(pickColorFlip(new Map(), [], 0.25, () => 0)).toBeNull();
  });

  it("never returns a flip that would breach the ±2pp proportion guard", () => {
    // 4 columns of 2 blocks each: exactly half zest (2 columns), matching
    // the target. Flipping any single column moves the ratio by 2/8 = 25pp,
    // far outside the 2pp guard in either direction, so no flip is legal.
    const blocks: Block[] = [];
    const colors: BlockColor[] = [];
    for (let col = 0; col < 4; col++) {
      const color: BlockColor = col < 2 ? "zest" : "yellow";
      for (let y = 0; y < 2; y++) {
        blocks.push({ x: col, y, z: 0, color });
        colors.push(color);
      }
    }
    const columns = groupColumns(blocks);
    for (const rngValue of [0, 0.2, 0.5, 0.8, 0.99]) {
      expect(pickColorFlip(columns, colors, 0.5, () => rngValue)).toBeNull();
    }
  });

  it("allows a flip that stays within the guard", () => {
    // 100 single-block columns, 50 zest / 50 yellow (ratio 0.5). Flipping
    // one column moves the ratio by 1pp, inside the 2pp guard.
    const blocks: Block[] = [];
    const colors: BlockColor[] = [];
    for (let col = 0; col < 100; col++) {
      const color: BlockColor = col < 50 ? "zest" : "yellow";
      blocks.push({ x: col, y: 0, z: 0, color });
      colors.push(color);
    }
    const columns = groupColumns(blocks);
    const flip = pickColorFlip(columns, colors, 0.5, () => 0);
    expect(flip).not.toBeNull();
    expect(flip!.indices.length).toBe(1);
  });

  it("only allows the corrective direction once the ratio already exceeds the guard", () => {
    // 100 single-block columns, 53 zest / 47 yellow: ratio 0.53 already
    // sits just above the [0.48, 0.52] guard around a 0.5 target. A
    // zest-to-yellow flip lands exactly on the boundary (0.52, legal); a
    // yellow-to-zest flip would push it further out (0.54, illegal) — so
    // whenever a flip is returned here, it must be the corrective one.
    const blocks: Block[] = [];
    const colors: BlockColor[] = [];
    for (let col = 0; col < 100; col++) {
      const color: BlockColor = col < 53 ? "zest" : "yellow";
      blocks.push({ x: col, y: 0, z: 0, color });
      colors.push(color);
    }
    const columns = groupColumns(blocks);
    for (const rngValue of [0, 0.1, 0.3, 0.5, 0.7, 0.9]) {
      const flip = pickColorFlip(columns, colors, 0.5, () => rngValue);
      expect(flip).not.toBeNull();
      expect(flip!.toColor).toBe("yellow");
    }
  });
});

describe("registration", () => {
  it("spaces slips between 7 and 19 seconds", () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 200; i++) {
      const delay = nextRegistrationDelay(rng);
      expect(delay).toBeGreaterThanOrEqual(7000);
      expect(delay).toBeLessThan(19000);
    }
  });

  it("holds the slip far shorter than the gap between slips", () => {
    expect(registrationHoldMs).toBeLessThan(7000);
    expect(registrationHoldMs).toBeGreaterThan(0);
  });

  it("offsets by a fraction of a cell, in every direction", () => {
    const rng = mulberry32(12);
    let minAngle = Infinity;
    let maxAngle = -Infinity;
    for (let i = 0; i < 400; i++) {
      const { x, z } = nextRegistrationOffset(rng);
      const distance = Math.hypot(x, z);
      expect(distance).toBeGreaterThanOrEqual(0.08 - 1e-12);
      expect(distance).toBeLessThan(0.3);
      const angle = Math.atan2(z, x);
      minAngle = Math.min(minAngle, angle);
      maxAngle = Math.max(maxAngle, angle);
    }
    // Spread over the full circle rather than biased to one quadrant.
    expect(maxAngle - minAngle).toBeGreaterThan(Math.PI * 1.9);
  });

  it("is deterministic for a given seed", () => {
    const a = nextRegistrationOffset(mulberry32(5));
    const b = nextRegistrationOffset(mulberry32(5));
    expect(a).toEqual(b);
  });
});

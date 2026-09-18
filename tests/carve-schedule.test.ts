import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/seed";
import {
  groupColumns,
  nextColorDriftDelay,
  nextRegistrationDelay,
  nextRegistrationOffset,
  nextRevealDelay,
  pickToneDrift,
  registrationHoldMs,
  selectInitiallyHidden,
} from "@/lib/carve-schedule";
import type { Block } from "@/lib/types";

function singleColumn(height: number, tone = 0.2): Block[] {
  const blocks: Block[] = [];
  for (let y = 0; y < height; y++) {
    blocks.push({ x: 0, y, z: 0, tone });
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
      const tone = ring % 2 === 0 ? 0.2 : 0.7;
      for (let y = 0; y < height; y++) {
        blocks.push({ x, y, z, tone });
      }
    }
  }
  return blocks;
}

describe("groupColumns", () => {
  it("sorts each column's indices by ascending height", () => {
    const blocks: Block[] = [
      { x: 0, y: 2, z: 0, tone: 0.2 },
      { x: 0, y: 0, z: 0, tone: 0.2 },
      { x: 0, y: 1, z: 0, tone: 0.2 },
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

describe("pickToneDrift", () => {
  function columnsOfTones(tones: number[][]): {
    columns: Map<string, number[]>;
    flat: number[];
  } {
    const columns = new Map<string, number[]>();
    const flat: number[] = [];
    tones.forEach((column, col) => {
      const indices: number[] = [];
      for (const tone of column) {
        indices.push(flat.length);
        flat.push(tone);
      }
      columns.set(`${col},0`, indices);
    });
    return { columns, flat };
  }

  it("returns null when there is nothing to move", () => {
    expect(pickToneDrift(new Map(), [], 0.3, () => 0)).toBeNull();
  });

  it("moves one whole column, by one step, staying inside the ramp", () => {
    const { columns, flat } = columnsOfTones(Array.from({ length: 40 }, () => [0.4, 0.4, 0.4]));
    const drift = pickToneDrift(columns, flat, 0.4, () => 0);
    expect(drift).not.toBeNull();
    expect(drift!.indices).toHaveLength(3);
    expect(Math.abs(drift!.delta)).toBeCloseTo(0.09, 10);
  });

  it("will not push the mean outside the guard", () => {
    // One column out of two is half the solid, so either step blows the
    // 0.02 guard and there is nothing legal to do.
    const { columns, flat } = columnsOfTones([[0.4], [0.4]]);
    for (const rngValue of [0, 0.25, 0.5, 0.75, 0.99]) {
      expect(pickToneDrift(columns, flat, 0.4, () => rngValue)).toBeNull();
    }
  });

  it("pulls back toward the target when the mean has run high", () => {
    const { columns, flat } = columnsOfTones(Array.from({ length: 60 }, () => [0.9]));
    const drift = pickToneDrift(columns, flat, 0.88, () => 0);
    expect(drift).not.toBeNull();
    expect(drift!.delta).toBeLessThan(0);
  });

  it("pushes back up when the mean has run low", () => {
    const { columns, flat } = columnsOfTones(Array.from({ length: 60 }, () => [0.1]));
    const drift = pickToneDrift(columns, flat, 0.12, () => 0);
    expect(drift).not.toBeNull();
    expect(drift!.delta).toBeGreaterThan(0);
  });

  it("keeps a column's own grain instead of flattening it", () => {
    // Blocks within a column no longer share a tone; a target would
    // erase that, a delta preserves it.
    const { columns, flat } = columnsOfTones(
      Array.from({ length: 40 }, () => [0.30, 0.42, 0.51]),
    );
    const drift = pickToneDrift(columns, flat, 0.41, () => 0);
    expect(drift).not.toBeNull();
    const moved = drift!.indices.map((i) => flat[i] + drift!.delta);
    expect(moved[1] - moved[0]).toBeCloseTo(0.12, 10);
    expect(moved[2] - moved[1]).toBeCloseTo(0.09, 10);
  });

  it("will not exceed the guard when part of a column is against a stop", () => {
    // Clamping shortens the real move, and the guard has to be checked
    // against the move that actually happens.
    const { columns, flat } = columnsOfTones([
      [1, 1, 1],
      ...Array.from({ length: 39 }, () => [0.5]),
    ]);
    const drift = pickToneDrift(columns, flat, 0.54, () => 0);
    if (drift) {
      const moved = drift.indices.reduce(
        (n, i) => n + (Math.min(1, Math.max(0, flat[i] + drift.delta)) - flat[i]),
        0,
      );
      const mean = (flat.reduce((n, t) => n + t, 0) + moved) / flat.length;
      expect(Math.abs(mean - 0.54)).toBeLessThanOrEqual(0.02 + 1e-12);
    }
  });

  it("is deterministic for a given rng", () => {
    const a = columnsOfTones(Array.from({ length: 30 }, (_, i) => [0.3 + i * 0.01]));
    const b = columnsOfTones(Array.from({ length: 30 }, (_, i) => [0.3 + i * 0.01]));
    expect(pickToneDrift(a.columns, a.flat, 0.45, mulberry32(3))).toEqual(
      pickToneDrift(b.columns, b.flat, 0.45, mulberry32(3)),
    );
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

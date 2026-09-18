import { describe, expect, it } from "vitest";
import {
  columnsOf,
  coverFrustum,
  extentsAtOrientation,
  projectedExtents,
} from "@/lib/ortho-fit";
import type { ExtentOptions } from "@/lib/ortho-fit";
import { mulberry32 } from "@/lib/seed";
import type { Block } from "@/lib/types";

const OVERHANG = 0.5;

const DEFAULT_ELEVATION = Math.PI / 4;
const OPTIONS: ExtentOptions = {
  yawSamples: 72,
  elevationRange: [Math.PI / 6, Math.PI / 3],
  elevationSamples: 5,
  defaultElevation: DEFAULT_ELEVATION,
};

function block(x: number, y: number, z: number): Block {
  return { x, y, z, color: "yellow" };
}

describe("columnsOf", () => {
  it("keeps only the top of each (x,z) stack", () => {
    const columns = columnsOf([block(0, 0, 0), block(0, 3, 0), block(0, 1, 0), block(2, 0, 1)]);
    expect(columns).toHaveLength(2);
    expect(columns.find((c) => c.x === 0 && c.z === 0)?.height).toBe(4);
    expect(columns.find((c) => c.x === 2 && c.z === 1)?.height).toBe(1);
  });
});

describe("projectedExtents", () => {
  it("matches the closed form for a single column at the origin", () => {
    // A unit box centred on x=z=0 projects to a half-width of
    // overhang * (|sin t| + |cos t|): 0.5 at yaw 0, sqrt(2)/2 at yaw 45.
    const single = columnsOf([block(0, 0, 0)]);

    const axis = projectedExtents(single, OVERHANG, { ...OPTIONS, yawSamples: 4 });
    expect(axis.halfWidth).toBeCloseTo(0.5, 10);

    const diagonal = projectedExtents(single, OVERHANG, { ...OPTIONS, yawSamples: 8 });
    expect(diagonal.halfWidth).toBeCloseTo(Math.SQRT2 / 2, 10);
  });

  it("is stable as yaw sampling is refined", () => {
    const columns = columnsOf(ringOfBlocks());
    const coarse = projectedExtents(columns, OVERHANG, OPTIONS);
    const fine = projectedExtents(columns, OVERHANG, { ...OPTIONS, yawSamples: 144 });

    expect(fine.halfWidth / coarse.halfWidth).toBeGreaterThan(0.99);
    expect(fine.halfWidth / coarse.halfWidth).toBeLessThan(1.01);
    expect(fine.halfHeight / coarse.halfHeight).toBeGreaterThan(0.99);
    expect(fine.halfHeight / coarse.halfHeight).toBeLessThan(1.01);
  });

  it("contains every block corner at every reachable orientation", () => {
    // The guard that matters: a fit computed only at the resting
    // elevation overflows as soon as the visitor drags the camera down,
    // because a tall column then projects closer to its full height.
    const blocks = randomBlocks();
    const columns = columnsOf(blocks);
    const extents = projectedExtents(columns, OVERHANG, OPTIONS);
    const rng = mulberry32(99);
    const [loE, hiE] = OPTIONS.elevationRange;

    // Largest amount by which any corner escapes the frustum, over every
    // sampled orientation. Must stay at or below zero.
    let worstU = -Infinity;
    let worstV = -Infinity;

    for (let trial = 0; trial < 40; trial++) {
      const t = rng() * 2 * Math.PI;
      const e = loE + rng() * (hiE - loE);
      const cosT = Math.cos(t);
      const sinT = Math.sin(t);
      const cosE = Math.cos(e);
      const sinE = Math.sin(e);
      const targetV = extents.targetHeight * cosE;

      // Accumulate and assert once per orientation. One expect() per
      // corner would be a quarter of a million calls, which is slow
      // enough to trip vitest's timeout on a loaded machine.
      for (const b of blocks) {
        for (const dx of [-OVERHANG, OVERHANG]) {
          for (const dz of [-OVERHANG, OVERHANG]) {
            for (const y of [b.y, b.y + 1]) {
              const x = b.x + dx;
              const z = b.z + dz;
              const u = x * cosT - z * sinT;
              const v = y * cosE - (x * sinT + z * cosT) * sinE;
              worstU = Math.max(worstU, Math.abs(u) - extents.halfWidth);
              worstV = Math.max(worstV, Math.abs(v - targetV) - extents.halfHeight);
            }
          }
        }
      }
    }

    expect(worstU).toBeLessThanOrEqual(1e-9);
    expect(worstV).toBeLessThanOrEqual(1e-9);
  });

  it("returns a finite, non-degenerate frustum for an empty sculpture", () => {
    const extents = projectedExtents([], OVERHANG, OPTIONS);
    expect(Number.isFinite(extents.halfWidth)).toBe(true);
    expect(Number.isFinite(extents.halfHeight)).toBe(true);
    expect(Number.isFinite(extents.targetHeight)).toBe(true);
    expect(extents.halfWidth).toBeGreaterThan(0);
    expect(extents.halfHeight).toBeGreaterThan(0);
  });
});

describe("extentsAtOrientation", () => {
  it("matches the closed form for a single column", () => {
    const single = columnsOf([block(0, 0, 0)]);
    const axis = extentsAtOrientation(single, OVERHANG, 0, DEFAULT_ELEVATION, 0);
    expect(axis.halfWidth).toBeCloseTo(0.5, 10);

    const diagonal = extentsAtOrientation(single, OVERHANG, Math.PI / 4, DEFAULT_ELEVATION, 0);
    expect(diagonal.halfWidth).toBeCloseTo(Math.SQRT2 / 2, 10);
  });

  it("never exceeds the worst case taken over the whole orbit", () => {
    const columns = columnsOf(ringOfBlocks());
    const worst = projectedExtents(columns, OVERHANG, OPTIONS);
    const [loE, hiE] = OPTIONS.elevationRange;
    const rng = mulberry32(4);

    for (let i = 0; i < 60; i++) {
      const yaw = rng() * 2 * Math.PI;
      const elevation = loE + rng() * (hiE - loE);
      const live = extentsAtOrientation(
        columns,
        OVERHANG,
        yaw,
        elevation,
        worst.targetHeight,
      );
      expect(live.halfWidth).toBeLessThanOrEqual(worst.halfWidth + 1e-9);
      expect(live.halfHeight).toBeLessThanOrEqual(worst.halfHeight + 1e-9);
    }
  });

  it("swings by sqrt(2) across a revolution of a square footprint", () => {
    // The reason for re-fitting per frame rather than once.
    const columns = columnsOf(squareFootprint(6));
    const faceOn = extentsAtOrientation(columns, OVERHANG, 0, DEFAULT_ELEVATION, 0);
    const diagonal = extentsAtOrientation(columns, OVERHANG, Math.PI / 4, DEFAULT_ELEVATION, 0);
    expect(diagonal.halfWidth / faceOn.halfWidth).toBeCloseTo(Math.SQRT2, 2);
  });

  it("stays finite for an empty sculpture", () => {
    const empty = extentsAtOrientation([], OVERHANG, 1, 1, 0);
    expect(empty.halfWidth).toBeGreaterThan(0);
    expect(empty.halfHeight).toBeGreaterThan(0);
  });
});

describe("coverFrustum", () => {
  const extents = { halfWidth: 10, halfHeight: 4 };

  it("keeps world units square", () => {
    const fit = coverFrustum(extents, 1600, 900, 1);
    expect(fit.halfW / fit.halfH).toBeCloseTo(1600 / 900, 12);
  });

  it("takes the smaller constraint, so the solid runs off an edge", () => {
    // Contain would take the larger (10) and leave slack; cover takes
    // 4 * 16/9 = 7.11 and lets the width overflow.
    const fit = coverFrustum(extents, 1600, 900, 1);
    expect(fit.halfW).toBeCloseTo(4 * (1600 / 900), 12);
    expect(fit.halfW).toBeLessThan(extents.halfWidth);
  });

  it("bleeds off both pairs of edges once overscan is above 1", () => {
    const fit = coverFrustum(extents, 1600, 900, 1.15);
    expect(fit.halfW).toBeLessThan(extents.halfWidth);
    expect(fit.halfH).toBeLessThan(extents.halfHeight);
  });

  it("scales inversely with overscan", () => {
    const bare = coverFrustum(extents, 1600, 900, 1);
    const pushed = coverFrustum(extents, 1600, 900, 1.15);
    expect(bare.halfW / pushed.halfW).toBeCloseTo(1.15, 12);
  });
});

function squareFootprint(half: number): Block[] {
  const blocks: Block[] = [];
  for (let x = -half; x <= half; x++) {
    for (let z = -half; z <= half; z++) blocks.push(block(x, 0, z));
  }
  return blocks;
}

function ringOfBlocks(): Block[] {
  const blocks: Block[] = [];
  for (let ring = 0; ring <= 6; ring++) {
    for (let x = -ring; x <= ring; x++) {
      for (let z = -ring; z <= ring; z++) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== ring) continue;
        for (let y = 0; y < 1 + (ring % 4); y++) blocks.push(block(x, y, z));
      }
    }
  }
  return blocks;
}

function randomBlocks(): Block[] {
  const rng = mulberry32(7);
  const blocks: Block[] = [];
  for (let x = -8; x <= 8; x++) {
    for (let z = -8; z <= 8; z++) {
      if (rng() < 0.6) continue;
      const height = 1 + Math.floor(rng() * 12);
      for (let y = 0; y < height; y++) blocks.push(block(x, y, z));
    }
  }
  return blocks;
}

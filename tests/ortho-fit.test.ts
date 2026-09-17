import { describe, expect, it } from "vitest";
import { columnsOf, orthoFrustum, projectedExtents } from "@/lib/ortho-fit";
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

    for (let trial = 0; trial < 40; trial++) {
      const t = rng() * 2 * Math.PI;
      const e = loE + rng() * (hiE - loE);
      const cosT = Math.cos(t);
      const sinT = Math.sin(t);
      const cosE = Math.cos(e);
      const sinE = Math.sin(e);
      const targetV = extents.targetHeight * cosE;

      for (const b of blocks) {
        for (const dx of [-OVERHANG, OVERHANG]) {
          for (const dz of [-OVERHANG, OVERHANG]) {
            for (const y of [b.y, b.y + 1]) {
              const x = b.x + dx;
              const z = b.z + dz;
              const u = x * cosT - z * sinT;
              const v = y * cosE - (x * sinT + z * cosT) * sinE;
              expect(Math.abs(u)).toBeLessThanOrEqual(extents.halfWidth + 1e-9);
              expect(Math.abs(v - targetV)).toBeLessThanOrEqual(extents.halfHeight + 1e-9);
            }
          }
        }
      }
    }
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

describe("orthoFrustum", () => {
  const extents = { halfWidth: 10, halfHeight: 4, targetHeight: 2 };

  it("keeps world units square", () => {
    const wide = orthoFrustum(extents, 1600, 900, 900, 1);
    expect(wide.halfW / wide.halfH).toBeCloseTo(1600 / 900, 12);

    const tall = orthoFrustum(extents, 400, 900, 500, 1);
    expect(tall.halfW / tall.halfH).toBeCloseTo(400 / 900, 12);
  });

  it("lets the width constraint bind on a wide viewport with no reserved bands", () => {
    const fit = orthoFrustum(extents, 1600, 900, 900, 1);
    expect(fit.halfW).toBeCloseTo(10, 12);
  });

  it("lets the band constraint bind once chrome eats the height", () => {
    const fit = orthoFrustum(extents, 1600, 900, 450, 1);
    // halfHeight 4 over half the height -> 8 world units of vertical
    // budget, times the aspect ratio.
    expect(fit.halfH).toBeCloseTo(8, 12);
    expect(fit.halfW).toBeCloseTo(8 * (1600 / 900), 12);
  });

  it("applies the margin as slack", () => {
    const snug = orthoFrustum(extents, 1600, 900, 900, 1);
    const loose = orthoFrustum(extents, 1600, 900, 900, 1.02);
    expect(loose.halfW / snug.halfW).toBeCloseTo(1.02, 12);
  });
});

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

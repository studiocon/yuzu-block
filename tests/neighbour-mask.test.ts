import { describe, expect, it } from "vitest";
import {
  EDGE_BIT_TABLE,
  EDGE_DIRECTIONS,
  MASK_BIT_COUNT,
  buildNeighbourMasks,
  suppressEdge,
} from "@/lib/neighbour-mask";
import type { Block } from "@/lib/types";

const PLUS_X = 0;
const PLUS_Y = 2;

function block(x: number, y: number, z: number): Block {
  return { x, y, z, color: "yellow" };
}

/** The four sides of face `face`, in the order the shader tests them. */
function sides(mask: number, face: number): boolean[] {
  return [0, 1, 2, 3].map((side) => suppressEdge(mask, face, side));
}

function sideToward(face: number, direction: number): number {
  const side = [0, 1, 2, 3].find((s) => EDGE_DIRECTIONS[face * 4 + s] === direction);
  if (side === undefined) throw new Error(`face ${face} has no side toward ${direction}`);
  return side;
}

describe("edge tables", () => {
  it("packs 18 bits", () => {
    expect(MASK_BIT_COUNT).toBe(18);
    expect(EDGE_BIT_TABLE).toHaveLength(24);
  });

  it("maps each face's sides to the directions read off BoxGeometry", () => {
    // Derived by hand from buildPlane's (u, v, udir, vdir) arguments and
    // its uv generation; the module derives the same table in code, so a
    // change in either has to be reconciled here.
    expect([...EDGE_DIRECTIONS]).toEqual([
      4, 5, 3, 2, // +x
      5, 4, 3, 2, // -x
      1, 0, 4, 5, //  +y
      1, 0, 5, 4, //  -y
      1, 0, 3, 2, //  +z
      0, 1, 3, 2, //  -z
    ]);
  });

  it("never lets a side point along its own face's axis", () => {
    for (let face = 0; face < 6; face++) {
      for (let side = 0; side < 4; side++) {
        expect(EDGE_DIRECTIONS[face * 4 + side] >> 1).not.toBe(face >> 1);
      }
    }
  });
});

describe("buildNeighbourMasks", () => {
  it("leaves an isolated block fully outlined", () => {
    const [mask] = buildNeighbourMasks([block(0, 0, 0)]);
    expect(mask).toBe(0);
    for (let face = 0; face < 6; face++) {
      expect(sides(mask, face)).toEqual([false, false, false, false]);
    }
  });

  it("drops the seam between two stacked blocks but keeps the exposed top", () => {
    const blocks = [block(0, 0, 0), block(0, 1, 0)];
    const [lower, upper] = buildNeighbourMasks(blocks);

    // The lower block's side faces continue flat into the upper block's,
    // so the line where they meet goes.
    for (const face of [0, 1, 4, 5]) {
      expect(suppressEdge(lower, face, sideToward(face, PLUS_Y))).toBe(true);
      // The bottom of the same face sits on the ground with nothing
      // below it, so that line stays.
      expect(suppressEdge(lower, face, sideToward(face, 3))).toBe(false);
    }

    // The top of the stack is exposed on all four sides.
    expect(sides(upper, PLUS_Y)).toEqual([false, false, false, false]);
  });

  it("clears the interior of a flat slab and keeps its perimeter", () => {
    const blocks: Block[] = [];
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) blocks.push(block(x, 0, z));
    const masks = buildNeighbourMasks(blocks);

    const centre = masks[blocks.findIndex((b) => b.x === 0 && b.z === 0)];
    expect(sides(centre, PLUS_Y)).toEqual([true, true, true, true]);

    const corner = masks[blocks.findIndex((b) => b.x === 1 && b.z === 1)];
    // Its two outward sides have no neighbour; its two inward ones do.
    expect(suppressEdge(corner, PLUS_Y, sideToward(PLUS_Y, PLUS_X))).toBe(false);
    expect(suppressEdge(corner, PLUS_Y, sideToward(PLUS_Y, 1))).toBe(true);
  });

  it("keeps the line at a concave corner", () => {
    // A step: the top of (0,0,0) runs into the -x face of (1,1,0). The
    // surface turns a right angle there, so the line is real. A rule
    // that only checked the +x neighbour would wrongly drop it.
    const blocks = [block(0, 0, 0), block(1, 0, 0), block(1, 1, 0)];
    const masks = buildNeighbourMasks(blocks);

    expect(suppressEdge(masks[0], PLUS_Y, sideToward(PLUS_Y, PLUS_X))).toBe(false);

    // Same pair without the riser: now the top surface is flat across
    // the join and the line goes.
    const flat = buildNeighbourMasks([block(0, 0, 0), block(1, 0, 0)]);
    expect(suppressEdge(flat[0], PLUS_Y, sideToward(PLUS_Y, PLUS_X))).toBe(true);
  });

  it("records adjacency consistently from both sides", () => {
    const blocks = [block(0, 0, 0), block(1, 0, 0)];
    const [a, b] = buildNeighbourMasks(blocks);
    expect((a & (1 << PLUS_X)) !== 0).toBe(true); // a sees +x
    expect((b & (1 << 1)) !== 0).toBe(true); // b sees -x
    expect((a & (1 << 1)) !== 0).toBe(false);
    expect((b & (1 << PLUS_X)) !== 0).toBe(false);
  });

  it("returns one mask per block, in order", () => {
    const blocks = [block(0, 0, 0), block(5, 0, 5), block(1, 0, 0)];
    const masks = buildNeighbourMasks(blocks);
    expect(masks).toHaveLength(3);
    expect(masks[1]).toBe(0);
    expect(masks[0]).not.toBe(0);
  });
});

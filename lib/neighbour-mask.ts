// Per-block neighbour occupancy, packed for the shader. No three.js here —
// components/BlockScene.tsx uploads the result as an instanced attribute
// and the fragment shader reads it to decide which cell edges to draw.
//
// Every cell is outlined, which is what articulates the solid now that
// blocks are unit cubes that meet exactly. Left unqualified that would
// draw a line across every flat surface, so a 20-high column would read
// as 20 stacked cubes. The qualification is per EDGE, not per face: an
// edge is dropped only where the surface genuinely continues flat across
// it, and kept where it turns a corner.
//
// The masks are built once from the server snapshot and never updated.
// The reveal animation temporarily hides up to 10% of blocks, so for a
// few seconds a face exposed by a hidden neighbour can be short one line.
// That is the cheap side of the trade: recomputing would touch up to 18
// neighbours per reveal and would undo the single-range buffer upload
// that the reveal loop is built around. The snapshot is also the state
// the sculpture converges to, so its edge topology is the honest one.

import type { Block } from "./types";

/** Unit offsets, in BoxGeometry's face order: +x, -x, +y, -y, +z, -z. */
export const DIRECTIONS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export const FACE_COUNT = DIRECTIONS.length;

/** Bits 0..5 of a mask: is the cell across face f occupied? */
export const AXIAL_BIT_COUNT = FACE_COUNT;

// Bits 6..17: the 12 edge-diagonal cells, one per unordered pair of
// directions on different axes.
const DIAGONAL_PAIRS: Array<readonly [number, number]> = [];
for (let a = 0; a < FACE_COUNT; a++) {
  for (let b = a + 1; b < FACE_COUNT; b++) {
    if (axisOf(a) === axisOf(b)) continue;
    DIAGONAL_PAIRS.push([a, b]);
  }
}

export const MASK_BIT_COUNT = AXIAL_BIT_COUNT + DIAGONAL_PAIRS.length; // 18

function axisOf(direction: number): number {
  return direction >> 1;
}

function diagonalBit(a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const index = DIAGONAL_PAIRS.findIndex(([p, q]) => p === lo && q === hi);
  if (index < 0) throw new Error(`no diagonal for directions ${a} and ${b}`);
  return AXIAL_BIT_COUNT + index;
}

// Which world direction each of a face's four sides runs toward, read off
// three's BoxGeometry.buildPlane (verified in
// node_modules/three/src/geometries/BoxGeometry.js, lines 76-81 and
// 109-140). With one segment per axis the plane's local coordinates are
//
//   uv.x = 0 -> vector[u] = -half * udir    uv.x = 1 -> +half * udir
//   uv.y = 0 -> vector[v] = +half * vdir    uv.y = 1 -> -half * vdir
//
// so each side maps to an axis and a sign, i.e. to one of DIRECTIONS.
const FACE_PLANES: ReadonlyArray<{ u: number; v: number; udir: number; vdir: number }> = [
  { u: 2, v: 1, udir: -1, vdir: -1 }, // +x
  { u: 2, v: 1, udir: 1, vdir: -1 }, // -x
  { u: 0, v: 2, udir: 1, vdir: 1 }, //  +y
  { u: 0, v: 2, udir: 1, vdir: -1 }, // -y
  { u: 0, v: 1, udir: 1, vdir: -1 }, // +z
  { u: 0, v: 1, udir: -1, vdir: -1 }, // -z
];

function directionOf(axis: number, sign: number): number {
  return axis * 2 + (sign > 0 ? 0 : 1);
}

/**
 * The world direction of each face's four sides, in the order the
 * fragment shader tests them: uv.x=0, uv.x=1, uv.y=0, uv.y=1.
 */
export const EDGE_DIRECTIONS: ReadonlyArray<number> = FACE_PLANES.flatMap((plane) => [
  directionOf(plane.u, -plane.udir),
  directionOf(plane.u, plane.udir),
  directionOf(plane.v, plane.vdir),
  directionOf(plane.v, -plane.vdir),
]);

/**
 * The two mask bits each (face, side) pair consults, indexed by
 * face * 4 + side. The single source of truth for both `suppressEdge`
 * and the GLSL lookup tables, which are generated from it.
 */
export const EDGE_BIT_TABLE: ReadonlyArray<{ axial: number; diagonal: number }> =
  EDGE_DIRECTIONS.map((edgeDirection, i) => ({
    axial: edgeDirection,
    diagonal: diagonalBit(edgeDirection, Math.floor(i / 4)),
  }));

/**
 * Whether the line along side `side` of face `face` should be dropped.
 *
 * The rule is `occupied(d) && !occupied(d + f)`, where d is the side's
 * direction and f the face's. The second term is what keeps stepped
 * profiles legible: if both cells exist the surface turns a concave
 * right angle at that line, so the line is real geometry and stays. Drop
 * that term and every step in the sculpture loses its edge.
 */
export function suppressEdge(mask: number, face: number, side: number): boolean {
  const { axial, diagonal } = EDGE_BIT_TABLE[face * 4 + side];
  const flat = (mask & (1 << axial)) !== 0;
  const turns = (mask & (1 << diagonal)) !== 0;
  return flat && !turns;
}

// Cells are packed into one integer key. The ring grid reaches +/-52 in x
// and z and 20 in y, so this span is comfortable; anything outside it
// simply reads as unoccupied, which degrades to "draw the line".
const KEY_SPAN = 1024;
const KEY_OFFSET = KEY_SPAN / 2;

function cellKey(x: number, y: number, z: number): number {
  return ((x + KEY_OFFSET) * KEY_SPAN + (y + KEY_OFFSET)) * KEY_SPAN + (z + KEY_OFFSET);
}

/** One 18-bit occupancy mask per block, in the blocks' own order. */
export function buildNeighbourMasks(blocks: Block[]): Uint32Array {
  const occupied = new Set<number>();
  for (const b of blocks) occupied.add(cellKey(b.x, b.y, b.z));

  const masks = new Uint32Array(blocks.length);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    let mask = 0;

    for (let d = 0; d < FACE_COUNT; d++) {
      const [dx, dy, dz] = DIRECTIONS[d];
      if (occupied.has(cellKey(b.x + dx, b.y + dy, b.z + dz))) mask |= 1 << d;
    }

    for (let p = 0; p < DIAGONAL_PAIRS.length; p++) {
      const [a, c] = DIAGONAL_PAIRS[p];
      const dx = DIRECTIONS[a][0] + DIRECTIONS[c][0];
      const dy = DIRECTIONS[a][1] + DIRECTIONS[c][1];
      const dz = DIRECTIONS[a][2] + DIRECTIONS[c][2];
      if (occupied.has(cellKey(b.x + dx, b.y + dy, b.z + dz))) {
        mask |= 1 << (AXIAL_BIT_COUNT + p);
      }
    }

    masks[i] = mask;
  }

  return masks;
}

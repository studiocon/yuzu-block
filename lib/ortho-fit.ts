// Pure camera-fit math for the orthographic view. No three.js here —
// components/BlockScene.tsx owns the camera object; this module only
// answers "how large is the sculpture on screen, at worst, over every
// orientation the visitor can reach".
//
// A perspective fit could lean on a single bounding sphere, which is
// orientation-invariant but loose: for most of the year the ring grid is
// mostly empty air, so a sphere around the solid still leaves the
// sculpture small. An orthographic frustum is a rectangle, so it can be
// fitted to the solid's actual projected silhouette instead — tighter,
// at the cost of having to take the worst case over the orbit range
// explicitly.

import type { Block } from "./types";

/** One (x,z) cell of the sculpture, with the top of its stack. */
export interface Column {
  x: number;
  z: number;
  /** Top of the column in world units; blocks occupy y in [0, height]. */
  height: number;
}

export interface ProjectedExtents {
  /** Largest |screen-x| of any surface point, over every orientation. */
  halfWidth: number;
  /** Largest |screen-y| distance from the camera target, likewise. */
  halfHeight: number;
  /** World y the camera targets, centring the default view's silhouette. */
  targetHeight: number;
}

export interface ExtentOptions {
  /** Yaw steps sampled over a full revolution. */
  yawSamples: number;
  /** Elevation above the horizon, in radians, at the two orbit limits. */
  elevationRange: [number, number];
  /** Elevation steps sampled across that range (>= 2). */
  elevationSamples: number;
  /** Elevation of the resting view, which the framing is centred on. */
  defaultElevation: number;
}

/**
 * Collapses blocks to their (x,z) columns. The projection is monotonic in
 * y within a column, so only the column's top matters for the silhouette
 * and every block below it can be dropped before the sampling loop.
 */
export function columnsOf(blocks: Block[]): Column[] {
  const tops = new Map<string, Column>();
  for (const b of blocks) {
    const key = `${b.x},${b.z}`;
    const top = b.y + 1;
    const existing = tops.get(key);
    if (existing === undefined) {
      tops.set(key, { x: b.x, z: b.z, height: top });
    } else if (top > existing.height) {
      existing.height = top;
    }
  }
  return [...tops.values()];
}

// Camera basis at yaw t and elevation e, derived from a camera at
// target + d * (sin t * cos e, sin e, cos t * cos e) looking at target:
//
//   right = ( cos t, 0, -sin t )
//   up    = ( -sin t * sin e, cos e, -cos t * sin e )
//
// so a world point (x, y, z) projects to
//
//   u = x * cos t - z * sin t            (independent of y and of e)
//   s = x * sin t + z * cos t            (depth-ward ground coordinate)
//   v = y * cos e - s * sin e
//
// A block's box spans +/- `overhang` in x and z around its cell centre, so
// over the four corners u and s each vary by exactly
// overhang * (|sin t| + |cos t|) — no corner enumeration needed.

/**
 * Worst-case projected half-extents of the solid over the sampled orbit
 * range. Conservative by construction: every sampled orientation is
 * covered, and yaw is sampled densely enough that the small residue
 * between samples is absorbed by the caller's fit margin.
 */
export function projectedExtents(
  columns: Column[],
  overhang: number,
  options: ExtentOptions,
): ProjectedExtents {
  if (columns.length === 0) {
    // Nothing emitted (every week below the anonymity threshold). Any
    // finite frustum will do; keep it non-degenerate so the projection
    // matrix stays well-formed.
    return { halfWidth: 1, halfHeight: 1, targetHeight: 0.5 };
  }

  const { yawSamples, elevationRange, elevationSamples, defaultElevation } = options;
  const elevations = sampleRange(elevationRange, elevationSamples, defaultElevation);

  const n = columns.length;
  const heights = new Float64Array(n);
  const groundDepths = new Float64Array(n);
  for (let i = 0; i < n; i++) heights[i] = columns[i].height;

  let halfWidth = 0;
  // Per-elevation running extremes of the projected vertical coordinate.
  const vMax = new Float64Array(elevations.length).fill(-Infinity);
  const vMin = new Float64Array(elevations.length).fill(Infinity);

  for (let k = 0; k < yawSamples; k++) {
    const t = (2 * Math.PI * k) / yawSamples;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    const corner = overhang * (Math.abs(sinT) + Math.abs(cosT));

    let maxAbsU = 0;
    let maxS = -Infinity;
    for (let i = 0; i < n; i++) {
      const c = columns[i];
      const u = Math.abs(c.x * cosT - c.z * sinT);
      if (u > maxAbsU) maxAbsU = u;
      const s = c.x * sinT + c.z * cosT;
      groundDepths[i] = s;
      if (s > maxS) maxS = s;
    }
    if (maxAbsU + corner > halfWidth) halfWidth = maxAbsU + corner;

    for (let j = 0; j < elevations.length; j++) {
      const cosE = Math.cos(elevations[j]);
      const sinE = Math.sin(elevations[j]);

      // Highest point: a column top, at that column's nearest corner.
      let top = -Infinity;
      for (let i = 0; i < n; i++) {
        const v = heights[i] * cosE - groundDepths[i] * sinE;
        if (v > top) top = v;
      }
      top += corner * sinE;
      if (top > vMax[j]) vMax[j] = top;

      // Lowest point: the ground plane, at the farthest corner.
      const bottom = -(maxS + corner) * sinE;
      if (bottom < vMin[j]) vMin[j] = bottom;
    }
  }

  // Centre the resting view, then widen until every reachable elevation
  // fits around that same target — the target is a world y, so its own
  // projection slides as the visitor changes elevation.
  const defaultIndex = elevations.indexOf(defaultElevation);
  const cosDefault = Math.cos(defaultElevation);
  const targetHeight = (vMax[defaultIndex] + vMin[defaultIndex]) / (2 * cosDefault);

  let halfHeight = 0;
  for (let j = 0; j < elevations.length; j++) {
    const targetV = targetHeight * Math.cos(elevations[j]);
    halfHeight = Math.max(halfHeight, vMax[j] - targetV, targetV - vMin[j]);
  }

  return { halfWidth, halfHeight: Math.max(halfHeight, 1e-6), targetHeight };
}

function sampleRange(range: [number, number], count: number, extra: number): number[] {
  const [lo, hi] = range;
  const steps = Math.max(2, count);
  const values: number[] = [];
  for (let i = 0; i < steps; i++) values.push(lo + ((hi - lo) * i) / (steps - 1));
  if (!values.includes(extra)) values.push(extra);
  return values;
}

/**
 * Projected half-extents at ONE orientation, measured about a fixed
 * camera target. Cheap enough to run every frame: the sculpture's
 * apparent width swings by up to sqrt(2) as a square footprint turns, so
 * sizing the frustum to the worst yaw leaves it small at every other one.
 */
export function extentsAtOrientation(
  columns: Column[],
  overhang: number,
  yaw: number,
  elevation: number,
  targetHeight: number,
): { halfWidth: number; halfHeight: number } {
  if (columns.length === 0) return { halfWidth: 1, halfHeight: 1 };

  const cosT = Math.cos(yaw);
  const sinT = Math.sin(yaw);
  const cosE = Math.cos(elevation);
  const sinE = Math.sin(elevation);
  const corner = overhang * (Math.abs(sinT) + Math.abs(cosT));

  let maxAbsU = 0;
  let maxS = -Infinity;
  let top = -Infinity;
  for (const c of columns) {
    const u = Math.abs(c.x * cosT - c.z * sinT);
    if (u > maxAbsU) maxAbsU = u;
    const s = c.x * sinT + c.z * cosT;
    if (s > maxS) maxS = s;
    const v = c.height * cosE - s * sinE;
    if (v > top) top = v;
  }

  const targetV = targetHeight * cosE;
  const vTop = top + corner * sinE;
  const vBottom = -(maxS + corner) * sinE;

  return {
    halfWidth: maxAbsU + corner,
    halfHeight: Math.max(vTop - targetV, targetV - vBottom, 1e-6),
  };
}

/**
 * Orthographic half-extents that make the solid COVER the viewport
 * rather than fit inside it: the frustum takes the smaller of the two
 * axis constraints, so the silhouette runs off at least one pair of
 * edges, and `overscan` above 1 pushes it off both. Page chrome is not
 * reserved against — the sculpture is meant to run under it.
 */
export function coverFrustum(
  extents: { halfWidth: number; halfHeight: number },
  width: number,
  height: number,
  overscan: number,
): { halfW: number; halfH: number } {
  const aspect = width / height;
  const halfW = Math.min(extents.halfWidth, extents.halfHeight * aspect) / overscan;
  return { halfW, halfH: halfW / aspect };
}

/**
 * Blends the live silhouette toward the worst case over the whole orbit.
 *
 * A square footprint is sqrt(2) narrower face-on than corner-on, and a
 * cover fit has to zoom IN to keep a narrower silhouette covering the
 * frame. Fitting the live extents alone therefore swings the framing by
 * 1.41x per revolution, which at the tight end crops past the point
 * where the solid still reads as a solid. Damping at 1 pins the framing
 * to the widest yaw (no motion, but gaps at the narrow ones); at 0 it
 * follows the silhouette exactly. In between, the frame breathes without
 * losing the form.
 */
export function dampedExtents(
  live: { halfWidth: number; halfHeight: number },
  worst: { halfWidth: number; halfHeight: number },
  damping: number,
): { halfWidth: number; halfHeight: number } {
  return {
    halfWidth: live.halfWidth + (worst.halfWidth - live.halfWidth) * damping,
    halfHeight: live.halfHeight + (worst.halfHeight - live.halfHeight) * damping,
  };
}

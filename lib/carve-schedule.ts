// Pure scheduling/selection logic for the bounded carving animation.
// No three.js here — components/BlockScene.tsx drives the actual mesh
// updates; this module only decides WHICH blocks and WHEN.
//
// The sculpture always converges to the server snapshot (`scene.blocks`)
// and never exceeds it: this module only ever hides a bounded initial
// subset (capped at 10% of the total) and reveals it over time, or
// re-colors an existing column between the two block tokens while
// holding the overall zest proportion close to the snapshot's.

import { hashString, mulberry32 } from "./seed";
import type { Block } from "./types";

const HIDDEN_FRACTION = 0.1;
const OUTER_RING_COUNT = 6;
const OUTER_RING_HIDE_FRACTION = 0.3;
const MEAN_TONE_GUARD = 0.02;
const TONE_STEP = 0.09;

const REVEAL_DELAY_MIN_MS = 900;
const REVEAL_DELAY_MAX_MS = 1800;
const COLOR_DRIFT_DELAY_MIN_MS = 2500;
const COLOR_DRIFT_DELAY_MAX_MS = 4000;
const REGISTRATION_DELAY_MIN_MS = 7000;
const REGISTRATION_DELAY_MAX_MS = 19000;
const REGISTRATION_HOLD_MS = 140;
const REGISTRATION_MIN_CELLS = 0.08;
const REGISTRATION_MAX_CELLS = 0.3;

function ringOf(block: Block): number {
  return Math.max(Math.abs(block.x), Math.abs(block.z));
}

/**
 * Groups block-array indices by their (x,z) column. Each column's index
 * list is sorted by ascending height, so the last entry is the topmost
 * block in that column.
 */
export function groupColumns(blocks: Block[]): Map<string, number[]> {
  const columns = new Map<string, number[]>();
  for (let i = 0; i < blocks.length; i++) {
    const key = `${blocks[i].x},${blocks[i].z}`;
    let indices = columns.get(key);
    if (!indices) {
      indices = [];
      columns.set(key, indices);
    }
    indices.push(i);
  }
  for (const indices of columns.values()) {
    indices.sort((a, b) => blocks[a].y - blocks[b].y);
  }
  return columns;
}

/**
 * Deterministically selects a pool of block-array indices to hide at
 * first paint, so the sculpture reads as being carved toward the
 * snapshot rather than appearing fully formed. Priority order (so a
 * cap-driven trim always keeps the more "carving-like" picks first):
 *
 * 1. The topmost 1-2 blocks of every column.
 * 2. Whole columns within the outermost `OUTER_RING_COUNT` rings that
 *    have any blocks at all (insufficient rings carry none).
 *
 * The pool never exceeds `HIDDEN_FRACTION` of the total block count.
 */
export function selectInitiallyHidden(blocks: Block[], seed: string): Set<number> {
  if (blocks.length === 0) return new Set();

  const cap = Math.floor(blocks.length * HIDDEN_FRACTION);
  if (cap <= 0) return new Set();

  const rng = mulberry32(hashString(seed));
  const columns = groupColumns(blocks);

  const prioritized: number[] = [];
  const seen = new Set<number>();
  function add(index: number): void {
    if (!seen.has(index)) {
      seen.add(index);
      prioritized.push(index);
    }
  }

  for (const indices of columns.values()) {
    const topCount = Math.min(indices.length, rng() < 0.5 ? 1 : 2);
    for (let k = 0; k < topCount; k++) {
      add(indices[indices.length - 1 - k]);
    }
  }

  const ringsPresent = new Set<number>();
  for (const block of blocks) ringsPresent.add(ringOf(block));
  const outerRings = new Set(
    [...ringsPresent].sort((a, b) => b - a).slice(0, OUTER_RING_COUNT),
  );

  for (const indices of columns.values()) {
    if (!outerRings.has(ringOf(blocks[indices[0]]))) continue;
    if (rng() < OUTER_RING_HIDE_FRACTION) {
      for (const index of indices) add(index);
    }
  }

  return new Set(prioritized.slice(0, cap));
}

/** Delay (ms) before the next single-block reveal tick. */
export function nextRevealDelay(rng: () => number): number {
  return REVEAL_DELAY_MIN_MS + rng() * (REVEAL_DELAY_MAX_MS - REVEAL_DELAY_MIN_MS);
}

/** Delay (ms) before the next color-drift tick. */
export function nextColorDriftDelay(rng: () => number): number {
  return (
    COLOR_DRIFT_DELAY_MIN_MS + rng() * (COLOR_DRIFT_DELAY_MAX_MS - COLOR_DRIFT_DELAY_MIN_MS)
  );
}

export interface ToneDrift {
  columnKey: string;
  indices: number[];
  toTone: number;
}

/**
 * Picks one column and nudges it along the ink ramp, holding the mean
 * tone within `MEAN_TONE_GUARD` of the snapshot's. The guard is what
 * stops the drift walking the whole solid toward one end of the ramp
 * over an afternoon: once the mean is above the band only a step
 * downward can be returned, and vice versa.
 *
 * Whole columns move together, so the surface keeps reading as columns
 * rather than as per-block noise. Returns null when no column can move
 * in either direction without breaching the guard.
 */
export function pickToneDrift(
  columns: Map<string, number[]>,
  currentTones: number[],
  targetMeanTone: number,
  rng: () => number,
): ToneDrift | null {
  const keys = [...columns.keys()];
  if (keys.length === 0 || currentTones.length === 0) return null;

  const total = currentTones.length;
  const sum = currentTones.reduce((n, t) => n + t, 0);
  const upperBound = targetMeanTone + MEAN_TONE_GUARD;
  const lowerBound = targetMeanTone - MEAN_TONE_GUARD;

  // Walk from a random offset so the same column is not always favoured,
  // but deterministically given `rng`.
  const start = Math.floor(rng() * keys.length);
  const stepUpFirst = rng() < 0.5;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[(start + i) % keys.length];
    const indices = columns.get(key)!;
    const from = currentTones[indices[0]];

    for (const step of stepUpFirst ? [TONE_STEP, -TONE_STEP] : [-TONE_STEP, TONE_STEP]) {
      const toTone = Math.min(1, Math.max(0, from + step));
      if (toTone === from) continue;
      const newMean = (sum + (toTone - from) * indices.length) / total;
      if (newMean <= upperBound && newMean >= lowerBound) {
        return { columnKey: key, indices, toTone };
      }
    }
  }

  return null;
}

/** Gap until the ring plate next slips off register, in ms. */
export function nextRegistrationDelay(rng: () => number): number {
  return (
    REGISTRATION_DELAY_MIN_MS + rng() * (REGISTRATION_DELAY_MAX_MS - REGISTRATION_DELAY_MIN_MS)
  );
}

/** How long it stays off register before snapping back, in ms. */
export const registrationHoldMs = REGISTRATION_HOLD_MS;

/**
 * A misregistration offset: a small displacement in cells, in a random
 * direction. Small enough to read as a press fault rather than as the
 * grid having moved.
 */
export function nextRegistrationOffset(rng: () => number): { x: number; z: number } {
  const angle = rng() * Math.PI * 2;
  const distance =
    REGISTRATION_MIN_CELLS + rng() * (REGISTRATION_MAX_CELLS - REGISTRATION_MIN_CELLS);
  return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
}

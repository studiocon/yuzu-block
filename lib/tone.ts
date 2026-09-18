// Where a column sits on the ink ramp, and how the ramp is shaped.
//
// Two inks could only ever make one transition, and colour assigned per
// week made the year read as a few solid bands. Tone is a scalar per
// column instead: the shader resolves it against a three-stop ramp and
// dithers between the two stops it falls between, so the surface moves
// continuously through the palette while every pixel still lands on one
// token exactly.
//
// No three.js here; the ramp constants are mirrored into GLSL from this
// module so the two cannot drift.

import { hashString } from "./seed";

/** Stops in lib/palette.ts INK_RAMP. */
export const RAMP_STOPS = 8;

/**
 * Where each stop sits on [0,1] — which, since tone is a flat rank, is
 * also how the solid's area is divided between them.
 *
 * The gap before a stop and the gap after it are the two places its ink
 * can be drawn, so a stop's share is about half of the two gaps around
 * it. These leave the four light stops around three quarters of the
 * surface and the last one a few per cent.
 *
 * This replaced a gamma applied to the rank. A gamma sets where the
 * bulk sits but is a poor lever at either end: reaching the last ink
 * meant flattening it far enough to drag the whole solid dark, and
 * pushing the bulk toward the light end piled 40% of the surface onto
 * the single palest ink. A position moves one stop without touching the
 * others, so there is one knob instead of two fighting each other.
 *
 * Ranking is still what makes any of this hold — see `tonesFromBases`.
 */
export const RAMP_POSITIONS = [0, 0.2, 0.48, 0.72, 0.82, 0.85, 0.87, 1] as const;

// How a block's place on the ramp is composed. The field is the sweep
// across the whole solid; the column term keeps a stack loosely
// together; the block term is what breaks it up.
//
// Tone used to be per COLUMN, which drew every stack as one flat
// vertical stripe up to twenty blocks tall — the most conspicuous thing
// on the surface. The block term is now the larger of the two noise
// shares, so a stack reads as related rather than as one line.
const FIELD_SHARE = 0.5;
const COLUMN_SHARE = 0.15;
const BLOCK_SHARE = 0.35;

/** Share the data signal takes when there is real data to honour. */
const SIGNAL_SHARE = 0.4;

function unitFromHash(key: string): number {
  return hashString(key) / 4294967296;
}

/**
 * A smooth field over the footprint, in [0,1]. Three sine terms at
 * different angles and periods, so the solid sweeps through the ramp
 * across its whole width rather than ring by ring, and the sweep has no
 * obvious axis. Deterministic per year.
 */
export function toneField(x: number, z: number, year: number): number {
  const phase = unitFromHash(`${year}:field`) * Math.PI * 2;
  const a = Math.sin(x * 0.055 + phase) * Math.cos(z * 0.045 - phase * 0.7);
  const b = Math.sin((x + z) * 0.038 + phase * 1.6);
  const c = Math.sin((x - z) * 0.021 - phase * 0.4);
  const sum = (a * 0.45 + b * 0.35 + c * 0.2) / 0.98;
  return Math.min(1, Math.max(0, 0.5 + 0.5 * sum));
}

export interface ToneInput {
  x: number;
  y: number;
  z: number;
  year: number;
  ring: number;
  cellIndex: number;
  /**
   * The week's own measure in [0,1], or null to let the field and the
   * noise decide alone — which is what the mock does, where there is no
   * measurement to be faithful to and the only job is to look right.
   */
  signal: number | null;
}

/**
 * A column's raw place in the ordering, before the ramp is shaped. Only
 * its ORDER against the other columns matters; the scale is arbitrary.
 */
export function toneBase({ x, y, z, year, ring, cellIndex, signal }: ToneInput): number {
  const field = toneField(x, z, year);
  const column = unitFromHash(`${year}:${ring}:${cellIndex}:tone`);
  const block = unitFromHash(`${year}:${ring}:${cellIndex}:${y}:grain`);

  const base = field * FIELD_SHARE + column * COLUMN_SHARE + block * BLOCK_SHARE;
  if (signal === null) return base;
  return signal * SIGNAL_SHARE + base * (1 - SIGNAL_SHARE);
}

/**
 * Ramp position for a block at `rank` in [0,1] of the ordering. The
 * identity: all of the shaping lives in RAMP_POSITIONS, so a block's
 * tone is just its place in the order.
 */
export function toneFromRank(rank: number): number {
  return Math.min(1, Math.max(0, rank));
}

/**
 * Ramp positions for a whole solid, from each block's base.
 *
 * Ranking rather than scaling is what makes the ink shares hold: the
 * rank of a value is flat by construction whatever shape the bases
 * have, so the ramp's gamma acts on the distribution it was designed
 * against. Ties keep input order, so this stays deterministic.
 */
export function tonesFromBases(bases: number[]): number[] {
  if (bases.length === 0) return [];
  if (bases.length === 1) return [toneFromRank(0.5)];

  const order = bases.map((base, index) => ({ base, index }));
  order.sort((a, b) => a.base - b.base || a.index - b.index);

  const tones = new Array<number>(bases.length);
  for (let i = 0; i < order.length; i++) {
    tones[order[i].index] = toneFromRank(i / (order.length - 1));
  }
  return tones;
}

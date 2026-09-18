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

/** Ramp position of the second stop. Below it the ramp runs from the
 *  first ink to the second, above it from the second to the third. */
export const RAMP_SECOND_STOP = 0.62;

/**
 * Rank is raised to this power, which pushes most columns toward the
 * first ink. Against a FLAT rank this puts the rendered ink areas near
 * 52 / 38 / 10 across the three stops — the first dominant, the second
 * common, the third scarce, which is the only proportion the third ink
 * is tolerable at.
 *
 * Flatness is why `toneFromRank` takes a rank rather than the raw field.
 * Applying this directly to field-plus-noise put the third ink at
 * exactly 0% of rendered pixels: a smooth field summed with uniform
 * noise piles up around the middle, nothing reached the 0.787 the third
 * stop needs, and the share maths — which assumed a flat input — was
 * describing a distribution that did not exist.
 */
export const TONE_GAMMA = 2.0;

/** Share of a column's tone that comes from per-column noise rather
 *  than from the smooth field across the whole solid. */
const JITTER_SHARE = 0.45;

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
export function toneBase({ x, z, year, ring, cellIndex, signal }: ToneInput): number {
  const field = toneField(x, z, year);
  const jitter = unitFromHash(`${year}:${ring}:${cellIndex}:tone`);

  const base = field * (1 - JITTER_SHARE) + jitter * JITTER_SHARE;
  if (signal === null) return base;
  return signal * SIGNAL_SHARE + base * (1 - SIGNAL_SHARE);
}

/** Ramp position for a column at `rank` in [0,1] of the ordering. */
export function toneFromRank(rank: number): number {
  return Math.pow(Math.min(1, Math.max(0, rank)), TONE_GAMMA);
}

/**
 * Ramp positions for a whole solid, from each column's base.
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

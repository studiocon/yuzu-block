import { hashString } from "./seed";
import { toneBase, tonesFromBases } from "./tone";
import type { Block, RingAggregate, SceneSpec, WeekBucket } from "./types";

const DEFAULT_MAX_HEIGHT = 12;

/**
 * Cells forming the perimeter of the square from (-r,-r) to (r,r) on the
 * XZ plane, enumerated clockwise starting at (-r,-r). Ring 0 is the single
 * cell at the origin. Perimeter cell count for r >= 1 is 8r.
 */
function ringCells(r: number): Array<[number, number]> {
  if (r === 0) return [[0, 0]];
  const cells: Array<[number, number]> = [];
  // Top edge: z = -r, x from -r to r-1.
  for (let x = -r; x < r; x++) cells.push([x, -r]);
  // Right edge: x = r, z from -r to r-1.
  for (let z = -r; z < r; z++) cells.push([r, z]);
  // Bottom edge: z = r, x from r down to -r+1.
  for (let x = r; x > -r; x--) cells.push([x, r]);
  // Left edge: x = -r, z from r down to -r+1.
  for (let z = r; z > -r; z--) cells.push([-r, z]);
  return cells;
}

function unitFromHash(key: string): number {
  return hashString(key) / 4294967296;
}

/**
 * Cells within ring r that are "filled" for this bucket, chosen
 * deterministically from a per-cell hash. Guarantees at least one filled
 * cell whenever fillFraction > 0.
 *
 * The hash key is keyed by year:ring:cell only (no date, no request
 * timestamp), so a given ring's silhouette is stable across snapshots
 * taken on different days within the same year — only which cells are
 * present at all, plus heights and colors, follow the underlying data.
 */
function filledCells(
  year: number,
  r: number,
  cells: Array<[number, number]>,
  fillFraction: number,
): Array<[number, number]> {
  if (fillFraction <= 0) return [];

  const rolls = cells.map((cell, i) => unitFromHash(`${year}:${r}:${i}`));
  const filled = cells.filter((_, i) => rolls[i] < fillFraction);
  if (filled.length > 0) return filled;

  // Guarantee at least one filled cell: pick the lowest-rolling cell.
  let minIndex = 0;
  for (let i = 1; i < rolls.length; i++) {
    if (rolls[i] < rolls[minIndex]) minIndex = i;
  }
  return [cells[minIndex]];
}

/**
 * Each sufficient week's words-per-record, scaled to [0,1] across the
 * year. This is the measurement the colour honours when there is a real
 * one to honour.
 */
function signalByBucketIndex(buckets: WeekBucket[]): Map<number, number> {
  const sufficientBuckets = buckets.filter((b) => b.sufficient && b.recordCount && b.wordCount);
  const wordsPerRecord = sufficientBuckets.map(
    (b) => (b.wordCount as number) / (b.recordCount as number),
  );

  const lowest = Math.min(...wordsPerRecord);
  const highest = Math.max(...wordsPerRecord);
  const span = highest - lowest;

  const signals = new Map<number, number>();
  for (const b of sufficientBuckets) {
    const wpr = (b.wordCount as number) / (b.recordCount as number);
    // A year with no spread at all sits mid-ramp rather than at an
    // arbitrary end.
    signals.set(b.index, span > 0 ? (wpr - lowest) / span : 0.5);
  }
  return signals;
}

export interface AggregateToBlocksOptions {
  maxHeight?: number;
  /**
   * Drop the data signal from the colour and let the field and the noise
   * alone decide it. Set for the mock, where there is no measurement to
   * be faithful to and the only job is to look right.
   */
  expressive?: boolean;
}

export function aggregateToBlocks(
  agg: RingAggregate,
  opts: AggregateToBlocksOptions = {},
): SceneSpec {
  const maxHeight = opts.maxHeight ?? DEFAULT_MAX_HEIGHT;
  const expressive = opts.expressive ?? false;

  const sufficientBuckets = agg.buckets.filter((b) => b.sufficient && b.recordCount !== null);
  const maxRecordCount = sufficientBuckets.reduce(
    (max, b) => Math.max(max, b.recordCount as number),
    0,
  );
  const signals = signalByBucketIndex(agg.buckets);

  // Every block is collected first so the whole solid can be ranked
  // before any tone is assigned: the ramp's shape is defined against a
  // flat ordering, not against the raw field. Ranking per BLOCK rather
  // than per column is also what stops a stack being drawn as one flat
  // vertical stripe.
  const placed: Array<{ x: number; y: number; z: number; base: number }> = [];

  for (const bucket of agg.buckets) {
    if (!bucket.sufficient || bucket.recordCount === null || bucket.silenceDayRatio === null) {
      continue;
    }

    const r = bucket.index;
    const cells = ringCells(r);
    const fillFraction = 1 - bucket.silenceDayRatio;
    const filled = filledCells(agg.year, r, cells, fillFraction);
    if (filled.length === 0) continue;

    // Indexed by position in the full ring, so a column keeps its tone
    // regardless of which of its neighbours survived the silhouette.
    const cellIndex = new Map(cells.map(([x, z], i) => [`${x},${z}`, i]));
    const signal = expressive ? null : (signals.get(r) ?? 0.5);

    const height =
      maxRecordCount > 0
        ? Math.max(1, Math.round((bucket.recordCount / maxRecordCount) * maxHeight))
        : 1;
    for (const [x, z] of filled) {
      const cell = cellIndex.get(`${x},${z}`) ?? 0;
      for (let y = 0; y < height; y++) {
        placed.push({
          x,
          y,
          z,
          base: toneBase({ x, y, z, year: agg.year, ring: r, cellIndex: cell, signal }),
        });
      }
    }
  }

  const tones = tonesFromBases(placed.map((b) => b.base));
  const blocks: Block[] = placed.map(({ x, y, z }, i) => ({ x, y, z, tone: tones[i] }));

  let halfExtent = 0;
  let height = 0;
  for (const b of blocks) {
    if (Math.abs(b.x) > halfExtent) halfExtent = Math.abs(b.x);
    if (Math.abs(b.z) > halfExtent) halfExtent = Math.abs(b.z);
    if (b.y + 1 > height) height = b.y + 1;
  }

  return { blocks, halfExtent, height };
}

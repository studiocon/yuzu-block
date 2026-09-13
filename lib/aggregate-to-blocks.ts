import { hashString } from "./seed";
import type { Block, BlockColor, RingAggregate, SceneSpec, WeekBucket } from "./types";

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
 * Words-per-record top quartile (among sufficient buckets) maps to
 * "zest"; everything else maps to "yellow".
 */
function colorsByBucketIndex(buckets: WeekBucket[]): Map<number, BlockColor> {
  const sufficientBuckets = buckets.filter((b) => b.sufficient && b.recordCount && b.wordCount);
  const wordsPerRecord = sufficientBuckets.map(
    (b) => (b.wordCount as number) / (b.recordCount as number),
  );
  const sorted = [...wordsPerRecord].sort((a, b) => b - a);
  const quartileCount = Math.max(1, Math.ceil(sorted.length * 0.25));
  const threshold = sorted.length > 0 ? sorted[quartileCount - 1] : Infinity;

  const colors = new Map<number, BlockColor>();
  for (const b of sufficientBuckets) {
    const wpr = (b.wordCount as number) / (b.recordCount as number);
    colors.set(b.index, wpr >= threshold ? "zest" : "yellow");
  }
  return colors;
}

export interface AggregateToBlocksOptions {
  maxHeight?: number;
}

export function aggregateToBlocks(
  agg: RingAggregate,
  opts: AggregateToBlocksOptions = {},
): SceneSpec {
  const maxHeight = opts.maxHeight ?? DEFAULT_MAX_HEIGHT;

  const sufficientBuckets = agg.buckets.filter((b) => b.sufficient && b.recordCount !== null);
  const maxRecordCount = sufficientBuckets.reduce(
    (max, b) => Math.max(max, b.recordCount as number),
    0,
  );
  const colors = colorsByBucketIndex(agg.buckets);

  const blocks: Block[] = [];

  for (const bucket of agg.buckets) {
    if (!bucket.sufficient || bucket.recordCount === null || bucket.silenceDayRatio === null) {
      continue;
    }

    const r = bucket.index;
    const cells = ringCells(r);
    const fillFraction = 1 - bucket.silenceDayRatio;
    const filled = filledCells(agg.year, r, cells, fillFraction);
    if (filled.length === 0) continue;

    const height =
      maxRecordCount > 0
        ? Math.max(1, Math.round((bucket.recordCount / maxRecordCount) * maxHeight))
        : 1;
    const color = colors.get(bucket.index) ?? "yellow";

    for (const [x, z] of filled) {
      for (let y = 0; y < height; y++) {
        blocks.push({ x, y, z, color });
      }
    }
  }

  let halfExtent = 0;
  let height = 0;
  for (const b of blocks) {
    if (Math.abs(b.x) > halfExtent) halfExtent = Math.abs(b.x);
    if (Math.abs(b.z) > halfExtent) halfExtent = Math.abs(b.z);
    if (b.y + 1 > height) height = b.y + 1;
  }

  return { blocks, halfExtent, height };
}

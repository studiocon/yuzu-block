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

// Share of a ring's columns that take the second token. A ring is never
// wholly one colour or the other: at the low end a few columns carry it,
// at the high end it is the majority but never all. Colour is a per-ring
// QUANTITY scattered over the ring, not a per-ring verdict.
const ZEST_SHARE_MIN = 0.06;
const ZEST_SHARE_MAX = 0.62;

/**
 * Share of each sufficient bucket's columns that should take "zest",
 * from words per record scaled across the year.
 *
 * This used to be a verdict: the top quartile of weeks came out wholly
 * zest, everything else wholly yellow. That put the whole signal into a
 * handful of solid concentric bands — the data was legible but the
 * surface was inert, and a week one word above the cut looked nothing
 * like the week below it. A share spreads the same measure over the
 * ring, so a wordier week reads as denser rather than as a different
 * object, and the boundary between two adjacent weeks stops being a
 * cliff.
 */
function zestShareByBucketIndex(buckets: WeekBucket[]): Map<number, number> {
  const sufficientBuckets = buckets.filter((b) => b.sufficient && b.recordCount && b.wordCount);
  const wordsPerRecord = sufficientBuckets.map(
    (b) => (b.wordCount as number) / (b.recordCount as number),
  );

  const lowest = Math.min(...wordsPerRecord);
  const highest = Math.max(...wordsPerRecord);
  const span = highest - lowest;

  const shares = new Map<number, number>();
  for (const b of sufficientBuckets) {
    const wpr = (b.wordCount as number) / (b.recordCount as number);
    // A year with no spread at all sits in the middle rather than at an
    // arbitrary end.
    const scaled = span > 0 ? (wpr - lowest) / span : 0.5;
    shares.set(b.index, ZEST_SHARE_MIN + scaled * (ZEST_SHARE_MAX - ZEST_SHARE_MIN));
  }
  return shares;
}

/**
 * Which of a ring's columns take "zest", from a per-column hash against
 * the ring's share. Keyed the same way as the silhouette — year, ring,
 * cell index, no date — so the colour layout is stable across snapshots
 * taken on different days of the same year.
 */
function zestColumns(year: number, r: number, cellCount: number, share: number): boolean[] {
  const picks: boolean[] = [];
  for (let i = 0; i < cellCount; i++) {
    picks.push(unitFromHash(`${year}:${r}:${i}:zest`) < share);
  }
  return picks;
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
  const zestShares = zestShareByBucketIndex(agg.buckets);

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

    // Indexed by position in the full ring, so a column keeps its colour
    // regardless of which of its neighbours survived the silhouette.
    const cellIndex = new Map(cells.map(([x, z], i) => [`${x},${z}`, i]));
    const isZest = zestColumns(agg.year, r, cells.length, zestShares.get(r) ?? 0);

    const height =
      maxRecordCount > 0
        ? Math.max(1, Math.round((bucket.recordCount / maxRecordCount) * maxHeight))
        : 1;
    for (const [x, z] of filled) {
      const color: BlockColor = isZest[cellIndex.get(`${x},${z}`) ?? 0] ? "zest" : "yellow";
      for (let y = 0; y < height; y++) {
        blocks.push({ x, y, z, color });
      }
    }
  }

  // A year can in principle roll no zest at all, most easily when only a
  // couple of small rings are sufficient. Recolour the single lowest-
  // rolling column rather than ship one flat token, mirroring how
  // filledCells guarantees a silhouette.
  if (blocks.length > 0 && !blocks.some((b) => b.color === "zest")) {
    let best = 0;
    let bestRoll = Infinity;
    for (let i = 0; i < blocks.length; i++) {
      const roll = unitFromHash(`${agg.year}:${blocks[i].x},${blocks[i].z}:zest-floor`);
      if (roll < bestRoll) {
        bestRoll = roll;
        best = i;
      }
    }
    const { x, z } = blocks[best];
    for (const b of blocks) {
      if (b.x === x && b.z === z) b.color = "zest";
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

// Weekly aggregate for a single ring (bucket). All numeric fields are
// anonymous, aggregate-only counts — no per-user data exists anywhere
// in this shape.
export interface WeekBucket {
  index: number;
  /** ISO date, YYYY-MM-DD, Monday of the bucket's week. */
  start: string;
  /** False when the cohort for this bucket is below the anonymity threshold. */
  sufficient: boolean;
  recordCount: number | null;
  wordCount: number | null;
  /** 0..1 — days with zero records / days in the bucket. */
  silenceDayRatio: number | null;
}

export interface RingAggregate {
  year: number;
  unit: "week";
  minCohort: number;
  generatedAt: string;
  buckets: WeekBucket[];
}

export type BlockColor = "yellow" | "zest";

export interface Block {
  x: number;
  y: number;
  z: number;
  color: BlockColor;
}

// Bounds of the blocks actually emitted — not of the nominal ring grid.
// Weeks below the anonymity threshold (and every week still in the future)
// contribute no blocks, so the occupied footprint is usually far smaller
// than the bucket count. The camera fit reads these, so it frames the
// sculpture rather than the empty grid around it.
export interface SceneSpec {
  blocks: Block[];
  /** Largest |x| or |z| over all blocks; 0 when there are none. */
  halfExtent: number;
  /** Top of the tallest column, in block units; 0 when there are none. */
  height: number;
}

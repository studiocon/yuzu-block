import { hashString, mulberry32 } from "./seed";
import type { RingAggregate, WeekBucket } from "./types";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function toISODate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Monday (UTC, ISO-style, 0=Monday..6=Sunday) on or before the given date. */
function mondayOnOrBefore(d: Date): Date {
  const dow = (d.getUTCDay() + 6) % 7;
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  out.setUTCDate(out.getUTCDate() - dow);
  return out;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/** Monday of the ISO week containing Jan 4 of `year` (ISO week 1's start). */
function isoWeek1Monday(year: number): Date {
  return mondayOnOrBefore(new Date(Date.UTC(year, 0, 4)));
}

/**
 * Monday-start ISO week boundaries (as Date, UTC midnight) for `year`:
 * bucket 0 is ISO week 1 (the week containing Jan 4), continuing weekly up
 * to but excluding ISO week 1 of `year + 1`. Yields 52 or 53 buckets.
 */
function weekStarts(year: number): Date[] {
  const first = isoWeek1Monday(year);
  const end = isoWeek1Monday(year + 1);
  const starts: Date[] = [];
  let cursor = first;
  while (cursor.getTime() < end.getTime()) {
    starts.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return starts;
}

/**
 * Smooth yearly envelope: low early in the year, rising through spring,
 * plateauing for the back half. Returns an approximate mean recordCount
 * before per-week noise is applied.
 */
function envelope(weekIndex: number, totalWeeks: number): number {
  const t = weekIndex / Math.max(1, totalWeeks - 1);
  // Logistic ramp from ~180 up to a plateau around ~620, centered near t=0.3.
  const k = 12;
  const ramp = 1 / (1 + Math.exp(-k * (t - 0.3)));
  return 180 + 440 * ramp;
}

/**
 * Mean size of the internal, aggregate-only cohort backing a bucket
 * (never exposed in `WeekBucket` — it exists only to decide `sufficient`).
 * Rises slower than `envelope`, so a meaningful share of early-year weeks
 * sit close to typical anonymity thresholds.
 */
function cohortEnvelope(weekIndex: number, totalWeeks: number): number {
  const t = weekIndex / Math.max(1, totalWeeks - 1);
  const k = 4;
  const ramp = 1 / (1 + Math.exp(-k * (t - 0.5)));
  return 42 + 158 * ramp;
}

export interface GenerateAggregateOptions {
  year: number;
  seed?: string;
  now?: Date;
  minCohort?: number;
}

export function generateAggregate(opts: GenerateAggregateOptions): RingAggregate {
  const now = opts.now ?? new Date();
  const minCohort = opts.minCohort ?? 50;
  const seed = opts.seed ?? `${opts.year}-${toISODate(now)}`;
  const rootSeedNum = hashString(seed);

  const starts = weekStarts(opts.year);
  const totalWeeks = starts.length;

  const buckets: WeekBucket[] = starts.map((start, index) => {
    const isFuture = start.getTime() > now.getTime();

    // Internal, aggregate-only cohort size for this bucket — never exposed
    // in the output shape. Determines whether the bucket clears `minCohort`.
    const cohortRng = mulberry32(hashString(`${seed}:cohort-value:${index}`));
    const cohortMean = cohortEnvelope(index, totalWeeks);
    const cohortNoiseA = cohortRng();
    const cohortNoiseB = cohortRng();
    const cohortGaussianLike = (cohortNoiseA + cohortNoiseB - 1) * 0.7; // roughly in [-0.7, 0.7]
    const activeCohort = Math.max(
      5,
      Math.min(500, Math.round(cohortMean * (1 + cohortGaussianLike))),
    );

    const sufficient = !isFuture && activeCohort >= minCohort;

    if (!sufficient) {
      return {
        index,
        start: toISODate(start),
        sufficient: false,
        recordCount: null,
        wordCount: null,
        silenceDayRatio: null,
      };
    }

    const rng = mulberry32((rootSeedNum ^ hashString(`${seed}:week:${index}`)) >>> 0);

    const mean = envelope(index, totalWeeks);
    // Lognormal-ish multiplicative noise.
    const noiseA = rng();
    const noiseB = rng();
    const gaussianLike = (noiseA + noiseB - 1) * 0.35; // roughly in [-0.35, 0.35]
    const recordCountRaw = mean * (1 + gaussianLike);
    const recordCount = Math.max(20, Math.min(900, Math.round(recordCountRaw)));

    const avgWords = 60 + rng() * 120; // 60..180
    const wordNoise = 1 + (rng() - 0.5) * 0.3;
    const wordCount = Math.max(1, Math.round(recordCount * avgWords * wordNoise));

    // silenceDayRatio loosely inversely related to recordCount, within 0.05..0.65.
    const normalizedLoad = Math.min(1, recordCount / 900);
    const base = 0.65 - normalizedLoad * 0.5;
    const silenceNoise = (rng() - 0.5) * 0.15;
    const silenceDayRatio = Math.round(Math.min(0.65, Math.max(0.05, base + silenceNoise)) * 1000) / 1000;

    return {
      index,
      start: toISODate(start),
      sufficient: true,
      recordCount,
      wordCount,
      silenceDayRatio,
    };
  });

  return {
    year: opts.year,
    unit: "week",
    minCohort,
    generatedAt: now.toISOString(),
    buckets,
  };
}

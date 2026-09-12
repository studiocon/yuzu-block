import { generateAggregate } from "./mock-aggregate";
import type { RingAggregate, WeekBucket } from "./types";

export type DataSource = "upstream" | "mock";

export interface LoadAggregateOptions {
  now?: Date;
  fetchImpl?: typeof fetch;
  url?: string | null;
}

export interface LoadAggregateResult {
  aggregate: RingAggregate;
  source: DataSource;
}

function isWeekBucket(x: unknown): x is WeekBucket {
  if (typeof x !== "object" || x === null) return false;
  const b = x as Record<string, unknown>;
  if (typeof b.index !== "number") return false;
  if (typeof b.start !== "string") return false;
  if (typeof b.sufficient !== "boolean") return false;

  const numericOrNull = (v: unknown) => v === null || typeof v === "number";
  if (!numericOrNull(b.recordCount)) return false;
  if (!numericOrNull(b.wordCount)) return false;
  if (!numericOrNull(b.silenceDayRatio)) return false;

  // Nulls must agree with `sufficient`: insufficient buckets carry null
  // numeric fields, sufficient buckets carry non-null numeric fields.
  const allNull = b.recordCount === null && b.wordCount === null && b.silenceDayRatio === null;
  const noneNull = b.recordCount !== null && b.wordCount !== null && b.silenceDayRatio !== null;
  if (b.sufficient && !noneNull) return false;
  if (!b.sufficient && !allNull) return false;

  return true;
}

/** Type guard validating a payload against the `RingAggregate` contract. */
export function isRingAggregate(x: unknown, expectedYear?: number): x is RingAggregate {
  if (typeof x !== "object" || x === null) return false;
  const a = x as Record<string, unknown>;

  if (typeof a.year !== "number") return false;
  if (expectedYear !== undefined && a.year !== expectedYear) return false;
  if (a.unit !== "week") return false;
  if (typeof a.minCohort !== "number") return false;
  if (typeof a.generatedAt !== "string") return false;
  if (!Array.isArray(a.buckets)) return false;
  if (a.buckets.length !== 52 && a.buckets.length !== 53) return false;
  if (!a.buckets.every(isWeekBucket)) return false;

  return true;
}

/**
 * Loads a `RingAggregate` for `year`: from the upstream public API when
 * `DATA_SOURCE_URL` (or `opts.url`) is set, otherwise from the deterministic
 * mock. Any upstream failure — network, non-2xx, invalid shape — falls back
 * to mock. Never throws.
 */
export async function loadAggregate(
  year: number,
  opts: LoadAggregateOptions = {},
): Promise<LoadAggregateResult> {
  const now = opts.now ?? new Date();
  const url = opts.url !== undefined ? opts.url : (process.env.DATA_SOURCE_URL ?? null);

  if (!url) {
    return { aggregate: generateAggregate({ year, now }), source: "mock" };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(`${url}?year=${year}`, {
      next: { revalidate: 3600 },
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    } as RequestInit);

    if (!response.ok) {
      console.error(`data-source: upstream returned status ${response.status}`);
      return { aggregate: generateAggregate({ year, now }), source: "mock" };
    }

    const payload: unknown = await response.json();

    if (!isRingAggregate(payload, year)) {
      console.error("data-source: upstream payload failed shape validation");
      return { aggregate: generateAggregate({ year, now }), source: "mock" };
    }

    return { aggregate: payload, source: "upstream" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`data-source: upstream fetch failed: ${reason}`);
    return { aggregate: generateAggregate({ year, now }), source: "mock" };
  }
}

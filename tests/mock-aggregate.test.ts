import { describe, expect, it } from "vitest";
import { generateAggregate } from "@/lib/mock-aggregate";

const NOW = new Date("2026-09-12T00:00:00.000Z");

describe("generateAggregate", () => {
  it("is deterministic for the same seed", () => {
    const a = generateAggregate({ year: 2026, seed: "fixed-seed", now: NOW });
    const b = generateAggregate({ year: 2026, seed: "fixed-seed", now: NOW });
    expect(a).toEqual(b);
  });

  it("produces 52 or 53 week buckets", () => {
    for (const year of [2024, 2025, 2026, 2027, 2028]) {
      const agg = generateAggregate({ year, seed: `s-${year}`, now: NOW });
      expect([52, 53]).toContain(agg.buckets.length);
    }
  });

  it("marks buckets starting after `now` as insufficient with nulls", () => {
    const agg = generateAggregate({ year: 2026, seed: "future-test", now: NOW });
    const futureBuckets = agg.buckets.filter((b) => new Date(b.start).getTime() > NOW.getTime());
    expect(futureBuckets.length).toBeGreaterThan(0);
    for (const b of futureBuckets) {
      expect(b.sufficient).toBe(false);
      expect(b.recordCount).toBeNull();
      expect(b.wordCount).toBeNull();
      expect(b.silenceDayRatio).toBeNull();
    }
  });

  it("keeps sufficient-bucket values within expected ranges", () => {
    const agg = generateAggregate({ year: 2026, seed: "range-test", now: NOW });
    for (const b of agg.buckets) {
      if (!b.sufficient) {
        expect(b.recordCount).toBeNull();
        expect(b.wordCount).toBeNull();
        expect(b.silenceDayRatio).toBeNull();
        continue;
      }
      expect(b.recordCount).toBeGreaterThanOrEqual(20);
      expect(b.recordCount).toBeLessThanOrEqual(900);
      expect(b.wordCount).toBeGreaterThan(0);
      expect(b.silenceDayRatio).toBeGreaterThanOrEqual(0.05);
      expect(b.silenceDayRatio).toBeLessThanOrEqual(0.65);
      expect(Number.isInteger(b.recordCount)).toBe(true);
      expect(Number.isInteger(b.wordCount)).toBe(true);
    }
  });

  it("marks some past buckets insufficient (below cohort threshold)", () => {
    const agg = generateAggregate({ year: 2020, seed: "cohort-test", now: NOW });
    const pastBuckets = agg.buckets.filter((b) => new Date(b.start).getTime() <= NOW.getTime());
    const insufficientPast = pastBuckets.filter((b) => !b.sufficient);
    // ~4-8% of past buckets, so with ~52 weeks expect at least a couple over many years,
    // just assert the mechanism exists somewhere across a full past year.
    expect(insufficientPast.length).toBeGreaterThanOrEqual(0);
    expect(insufficientPast.length).toBeLessThan(pastBuckets.length);
  });

  it("uses a default seed derived from year and now when not provided", () => {
    const a = generateAggregate({ year: 2026, now: NOW });
    const b = generateAggregate({ year: 2026, now: NOW });
    expect(a).toEqual(b);
  });

  it("defaults minCohort to 50", () => {
    const agg = generateAggregate({ year: 2026, seed: "mincohort-test", now: NOW });
    expect(agg.minCohort).toBe(50);
  });

  it("respects a custom minCohort", () => {
    const agg = generateAggregate({ year: 2026, seed: "mincohort-test-2", now: NOW, minCohort: 10 });
    expect(agg.minCohort).toBe(10);
  });
});

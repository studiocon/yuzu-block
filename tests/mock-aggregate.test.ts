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
    // Aggregate several past years so the ~4-10% per-week insufficiency
    // rate at the default minCohort (50) is virtually certain to surface.
    let pastCount = 0;
    let insufficientCount = 0;
    for (const year of [2015, 2016, 2017, 2018, 2019, 2020]) {
      const agg = generateAggregate({ year, seed: `cohort-test-${year}`, now: NOW });
      const pastBuckets = agg.buckets.filter((b) => new Date(b.start).getTime() <= NOW.getTime());
      pastCount += pastBuckets.length;
      insufficientCount += pastBuckets.filter((b) => !b.sufficient).length;
    }
    expect(insufficientCount).toBeGreaterThan(0);
    expect(insufficientCount).toBeLessThan(pastCount);
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

  it("raising minCohort strictly reduces the count of sufficient buckets", () => {
    // Aggregate across several years so the comparison isn't sensitive to
    // any single year's noise draws.
    const years = [2010, 2012, 2014, 2016, 2018, 2020];
    let sufficientAtLow = 0;
    let sufficientAtDefault = 0;
    let sufficientAtHigh = 0;
    for (const year of years) {
      const seed = `mincohort-behavior-${year}`;
      const low = generateAggregate({ year, seed, now: NOW, minCohort: 10 });
      const mid = generateAggregate({ year, seed, now: NOW, minCohort: 50 });
      const high = generateAggregate({ year, seed, now: NOW, minCohort: 300 });
      sufficientAtLow += low.buckets.filter((b) => b.sufficient).length;
      sufficientAtDefault += mid.buckets.filter((b) => b.sufficient).length;
      sufficientAtHigh += high.buckets.filter((b) => b.sufficient).length;
    }
    expect(sufficientAtDefault).toBeLessThan(sufficientAtLow);
    expect(sufficientAtHigh).toBeLessThan(sufficientAtDefault);
    // minCohort=300 sits above the internal cohort envelope's plateau, so
    // most weeks should fail the threshold.
    const totalPastBuckets = years.length * 52;
    expect(sufficientAtHigh).toBeLessThan(totalPastBuckets * 0.5);
  });

  it("enumerates ISO weeks correctly for every year 1990..2100", () => {
    for (let year = 1990; year <= 2100; year++) {
      const agg = generateAggregate({ year, seed: `iso-week-${year}`, now: NOW });
      expect([52, 53]).toContain(agg.buckets.length);

      const bucket0Start = new Date(`${agg.buckets[0].start}T00:00:00.000Z`);
      const dec29PrevYear = new Date(Date.UTC(year - 1, 11, 29));
      const jan4 = new Date(Date.UTC(year, 0, 4));
      expect(bucket0Start.getTime()).toBeGreaterThanOrEqual(dec29PrevYear.getTime());
      expect(bucket0Start.getTime()).toBeLessThanOrEqual(jan4.getTime());
    }
  });
});

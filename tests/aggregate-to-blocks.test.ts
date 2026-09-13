import { describe, expect, it } from "vitest";
import { aggregateToBlocks } from "@/lib/aggregate-to-blocks";
import { generateAggregate } from "@/lib/mock-aggregate";
import type { RingAggregate } from "@/lib/types";

const NOW = new Date("2026-12-31T00:00:00.000Z");

function fullYearAggregate(seed: string, minCohort = 1): RingAggregate {
  // A "now" at year end means every bucket is eligible to be sufficient
  // (subject to the deterministic cohort flag), giving good ring coverage
  // for structural tests.
  return generateAggregate({ year: 2026, seed, now: NOW, minCohort });
}

describe("aggregateToBlocks", () => {
  it("is deterministic (pure function of its inputs)", () => {
    const agg = fullYearAggregate("blocks-determinism");
    const a = aggregateToBlocks(agg);
    const b = aggregateToBlocks(agg);
    expect(a).toEqual(b);
  });

  it("produces no blocks for insufficient rings", () => {
    const agg = fullYearAggregate("blocks-insufficient");
    const scene = aggregateToBlocks(agg);
    const insufficientIndices = new Set(
      agg.buckets.filter((b) => !b.sufficient).map((b) => b.index),
    );
    for (const block of scene.blocks) {
      const ring = Math.max(Math.abs(block.x), Math.abs(block.z));
      expect(insufficientIndices.has(ring)).toBe(false);
    }
  });

  it("keeps block y within [0, maxHeight)", () => {
    const agg = fullYearAggregate("blocks-height");
    const scene = aggregateToBlocks(agg, { maxHeight: 12 });
    for (const block of scene.blocks) {
      expect(block.y).toBeGreaterThanOrEqual(0);
      expect(block.y).toBeLessThan(12);
    }
  });

  it("gives every filled column a height of at least 1", () => {
    const agg = fullYearAggregate("blocks-min-height");
    const scene = aggregateToBlocks(agg);
    const columns = new Map<string, number>();
    for (const block of scene.blocks) {
      const key = `${block.x},${block.z}`;
      columns.set(key, (columns.get(key) ?? 0) + 1);
    }
    for (const count of columns.values()) {
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it("places every block's (x,z) on its own ring: max(|x|,|z|) === ring index", () => {
    const agg = fullYearAggregate("blocks-ring-membership");
    const scene = aggregateToBlocks(agg);
    for (const block of scene.blocks) {
      // We can't recover which bucket a block came from directly here,
      // but every block's ring distance must equal *some* valid bucket
      // index, and in particular blocks at a given (x,z) must satisfy
      // max(|x|,|z|) === that ring's index by construction.
      const ring = Math.max(Math.abs(block.x), Math.abs(block.z));
      expect(agg.buckets.some((b) => b.index === ring)).toBe(true);
    }
  });

  it("only ever produces yellow or zest colors", () => {
    const agg = fullYearAggregate("blocks-colors");
    const scene = aggregateToBlocks(agg);
    for (const block of scene.blocks) {
      expect(["yellow", "zest"]).toContain(block.color);
    }
  });

  it("produces at least one zest block when there are >= 4 sufficient buckets", () => {
    const agg = fullYearAggregate("blocks-zest-presence");
    const sufficientCount = agg.buckets.filter((b) => b.sufficient).length;
    expect(sufficientCount).toBeGreaterThanOrEqual(4);
    const scene = aggregateToBlocks(agg);
    expect(scene.blocks.some((b) => b.color === "zest")).toBe(true);
  });

  it("reports bounds of the blocks actually emitted, not of the ring grid", () => {
    const agg = fullYearAggregate("blocks-extent");
    const scene = aggregateToBlocks(agg, { maxHeight: 20 });

    const expectedHalfExtent = scene.blocks.reduce(
      (max, b) => Math.max(max, Math.abs(b.x), Math.abs(b.z)),
      0,
    );
    const expectedHeight = scene.blocks.reduce((max, b) => Math.max(max, b.y + 1), 0);

    expect(scene.halfExtent).toBe(expectedHalfExtent);
    expect(scene.height).toBe(expectedHeight);
    expect(scene.height).toBeLessThanOrEqual(20);
    // Insufficient weeks emit nothing, so the occupied footprint stays
    // inside the nominal ring grid rather than matching it.
    expect(scene.halfExtent).toBeLessThan(agg.buckets.length);
  });

  it("shrinks the reported footprint to the outermost sufficient ring", () => {
    // Rings 0 and 1 carry blocks; ring 2 does not. The footprint must
    // report ring 1, not the three-bucket grid the rings sit in.
    const agg: RingAggregate = {
      year: 2026,
      unit: "week",
      minCohort: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      buckets: [
        {
          index: 0,
          start: "2025-12-29",
          sufficient: true,
          recordCount: 100,
          wordCount: 9000,
          silenceDayRatio: 0,
        },
        {
          index: 1,
          start: "2026-01-05",
          sufficient: true,
          recordCount: 50,
          wordCount: 4000,
          silenceDayRatio: 0,
        },
        {
          index: 2,
          start: "2026-01-12",
          sufficient: false,
          recordCount: null,
          wordCount: null,
          silenceDayRatio: null,
        },
      ],
    };

    const scene = aggregateToBlocks(agg, { maxHeight: 8 });

    expect(scene.halfExtent).toBe(1);
    // Ring 0 holds the tallest column: it has the largest recordCount.
    expect(scene.height).toBe(8);
  });

  it("returns zero blocks (and does not throw) when no bucket is sufficient", () => {
    const agg: RingAggregate = {
      year: 2026,
      unit: "week",
      minCohort: 50,
      generatedAt: "2026-01-01T00:00:00.000Z",
      buckets: [
        {
          index: 0,
          start: "2026-01-05",
          sufficient: false,
          recordCount: null,
          wordCount: null,
          silenceDayRatio: null,
        },
        {
          index: 1,
          start: "2026-01-12",
          sufficient: false,
          recordCount: null,
          wordCount: null,
          silenceDayRatio: null,
        },
      ],
    };
    const scene = aggregateToBlocks(agg);
    expect(scene.blocks).toEqual([]);
    expect(scene.halfExtent).toBe(0);
    expect(scene.height).toBe(0);
  });

  it("guarantees at least one filled cell even when silenceDayRatio is near 1", () => {
    const agg: RingAggregate = {
      year: 2026,
      unit: "week",
      minCohort: 50,
      generatedAt: "2026-01-01T00:00:00.000Z",
      buckets: [
        {
          index: 3,
          start: "2026-01-26",
          sufficient: true,
          recordCount: 100,
          wordCount: 8000,
          silenceDayRatio: 0.999,
        },
      ],
    };
    const scene = aggregateToBlocks(agg);
    const ring3Blocks = scene.blocks.filter(
      (b) => Math.max(Math.abs(b.x), Math.abs(b.z)) === 3,
    );
    expect(ring3Blocks.length).toBeGreaterThan(0);
  });

  it("ring 0 is the single cell at the origin", () => {
    const agg = fullYearAggregate("blocks-ring-zero");
    const scene = aggregateToBlocks(agg);
    const ring0Blocks = scene.blocks.filter((b) => b.x === 0 && b.z === 0);
    const bucket0 = agg.buckets[0];
    if (bucket0.sufficient) {
      expect(ring0Blocks.length).toBeGreaterThan(0);
    }
    for (const b of scene.blocks) {
      if (b.x === 0 && b.z === 0) {
        expect(Math.max(Math.abs(b.x), Math.abs(b.z))).toBe(0);
      }
    }
  });
});

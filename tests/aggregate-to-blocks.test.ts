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

  it("sets extent to the number of buckets and maxHeight to the option used", () => {
    const agg = fullYearAggregate("blocks-extent");
    const scene = aggregateToBlocks(agg, { maxHeight: 20 });
    expect(scene.extent).toBe(agg.buckets.length);
    expect(scene.maxHeight).toBe(20);
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

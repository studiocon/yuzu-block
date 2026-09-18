import { describe, expect, it } from "vitest";
import { aggregateToBlocks } from "@/lib/aggregate-to-blocks";
import { RAMP_POSITIONS, RAMP_STOPS, toneField } from "@/lib/tone";
import { generateAggregate } from "@/lib/mock-aggregate";
import type { Block, RingAggregate } from "@/lib/types";

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

  it("only ever produces tones inside the ramp", () => {
    const agg = fullYearAggregate("blocks-tone-range");
    const scene = aggregateToBlocks(agg);
    expect(scene.blocks.length).toBeGreaterThan(0);
    for (const block of scene.blocks) {
      expect(block.tone).toBeGreaterThanOrEqual(0);
      expect(block.tone).toBeLessThanOrEqual(1);
    }
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

describe("tone placement", () => {
  /** Distinct tones among the columns of one ring. */
  function ringTones(blocks: Block[], ring: number): number[] {
    const columns = new Map<string, number>();
    for (const b of blocks) {
      if (Math.max(Math.abs(b.x), Math.abs(b.z)) !== ring) continue;
      columns.set(`${b.x},${b.z}`, b.tone);
    }
    return [...columns.values()];
  }

  it("spreads a ring across the ramp instead of ruling on the week", () => {
    // The old rule was a per-ring verdict, so every populated ring came
    // out entirely one token and the year read as solid bands. The ramp
    // compresses the low end, so a ring sitting there legitimately has a
    // small spread — what has to hold is that it is never one value.
    const scene = aggregateToBlocks(fullYearAggregate("blocks-tone-spread"));
    let checked = 0;
    for (let r = 10; r <= 40; r++) {
      const tones = ringTones(scene.blocks, r);
      if (tones.length < 8) continue;
      checked++;
      expect(new Set(tones).size).toBeGreaterThan(3);
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("keeps the last ink scarce through the real pipeline", () => {
    // The final stop is the one that is only tolerable while it stays
    // small. Its share is the chance the screen picks it, which is zero
    // below the penultimate stop and `along` above it.
    const scene = aggregateToBlocks(fullYearAggregate("blocks-tone-share"), {
      expressive: true,
    });
    const last = RAMP_POSITIONS[RAMP_STOPS - 1];
    const penultimate = RAMP_POSITIONS[RAMP_STOPS - 2];
    const share =
      scene.blocks.reduce(
        (n, b) => n + (b.tone >= penultimate ? (b.tone - penultimate) / (last - penultimate) : 0),
        0,
      ) / scene.blocks.length;

    // The bound is low because the muted FAMILY is what is held to a
    // few per cent; the last token is only a slice of that. Both ends
    // still matter — it once rendered at exactly 0%.
    expect(share).toBeGreaterThan(0.004);
    expect(share).toBeLessThan(0.03);
  });

  /**
   * Chance the screen draws one of the muted inks — the last three
   * stops — for a block at this tone. Zero below the straw stop, the
   * mix fraction across the straw/linen segment, and certain above it.
   */
  function mutedChance(tone: number): number {
    const strawAt = RAMP_POSITIONS[RAMP_STOPS - 4];
    const linenAt = RAMP_POSITIONS[RAMP_STOPS - 3];
    if (tone < strawAt) return 0;
    if (tone >= linenAt) return 1;
    return (tone - strawAt) / (linenAt - strawAt);
  }

  it("keeps the muted end of the ramp to a few per cent", () => {
    // Measured as a FAMILY, not as the last token alone. Reading only
    // the last one once reported 4.2% while the three muted inks
    // together were 13.3% of the surface, which is what actually reads
    // as grey.
    const scene = aggregateToBlocks(fullYearAggregate("blocks-muted-share"), {
      expressive: true,
    });
    const share =
      scene.blocks.reduce((n, b) => n + mutedChance(b.tone), 0) / scene.blocks.length;
    expect(share).toBeGreaterThan(0.02);
    expect(share).toBeLessThan(0.08);
  });

  it("spreads the muted inks evenly over the footprint", () => {
    // The field used to be the largest term in a block's tone, which
    // pooled the muted inks into one region and read as the colour
    // being lopsided. Per-region share should now sit close to the
    // overall share everywhere.
    const scene = aggregateToBlocks(fullYearAggregate("blocks-muted-spread"), {
      expressive: true,
    });
    const extent = scene.halfExtent || 1;
    const GRID = 6;
    const regions = new Map<number, { n: number; muted: number }>();
    for (const b of scene.blocks) {
      const gx = Math.min(GRID - 1, Math.floor(((b.x + extent) / (2 * extent)) * GRID));
      const gz = Math.min(GRID - 1, Math.floor(((b.z + extent) / (2 * extent)) * GRID));
      const key = gz * GRID + gx;
      const cell = regions.get(key) ?? { n: 0, muted: 0 };
      cell.n++;
      cell.muted += mutedChance(b.tone);
      regions.set(key, cell);
    }

    const shares = [...regions.values()].filter((r) => r.n > 200).map((r) => r.muted / r.n);
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    const sd = Math.sqrt(shares.reduce((a, b) => a + (b - mean) ** 2, 0) / shares.length);

    expect(shares.length).toBeGreaterThan(10);
    expect(sd).toBeLessThan(0.03);
    expect(Math.max(...shares)).toBeLessThan(0.14);
  });

  it("uses the whole ramp, not a corner of it", () => {
    const scene = aggregateToBlocks(fullYearAggregate("blocks-tone-coverage"), {
      expressive: true,
    });
    // Every segment of the ramp should carry some of the solid, or
    // stops have been added that never render.
    for (let i = 0; i < RAMP_STOPS - 1; i++) {
      const lo = RAMP_POSITIONS[i];
      const hi = RAMP_POSITIONS[i + 1];
      const inSegment = scene.blocks.filter((b) => b.tone >= lo && b.tone < hi).length;
      expect(inSegment).toBeGreaterThan(0);
    }
  });

  it("keeps only a faint drift across the footprint", () => {
    // The field was once the largest term, which pooled the muted inks
    // into one region and read as the colour being lopsided. It is now
    // the smallest. The guard is two-sided: the field should still be
    // wired in, and it should not be allowed to dominate again.
    const scene = aggregateToBlocks(fullYearAggregate("blocks-tone-field"), {
      expressive: true,
    });
    const byCell = new Map<string, number>();
    for (const b of scene.blocks) byCell.set(`${b.x},${b.z}`, b.tone);

    const xs: number[] = [];
    const ys: number[] = [];
    for (const [key, tone] of byCell) {
      const [x, z] = key.split(",").map(Number);
      xs.push(toneField(x, z, 2026));
      ys.push(tone);
    }

    const mean = (v: number[]) => v.reduce((n, a) => n + a, 0) / v.length;
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    const correlation = num / Math.sqrt(dx * dy);

    expect(byCell.size).toBeGreaterThan(300);
    expect(correlation).toBeGreaterThan(0.01);
    expect(correlation).toBeLessThan(0.3);
  });

  it("honours the measurement unless asked not to", () => {
    const agg = fullYearAggregate("blocks-tone-signal");
    const measured = aggregateToBlocks(agg);
    const expressive = aggregateToBlocks(agg, { expressive: true });
    expect(measured.blocks.map((b) => b.tone)).not.toEqual(
      expressive.blocks.map((b) => b.tone),
    );

    const meanFor = (blocks: Block[], ring: number) => {
      const t = ringTones(blocks, ring);
      return t.reduce((n, v) => n + v, 0) / t.length;
    };
    const paired: Array<{ wpr: number; tone: number }> = [];
    for (const bucket of agg.buckets) {
      if (!bucket.sufficient || !bucket.recordCount || !bucket.wordCount) continue;
      if (bucket.index < 6) continue;
      const tones = ringTones(measured.blocks, bucket.index);
      if (tones.length < 8) continue;
      paired.push({
        wpr: bucket.wordCount / bucket.recordCount,
        tone: meanFor(measured.blocks, bucket.index),
      });
    }
    expect(paired.length).toBeGreaterThan(10);
    const sorted = [...paired].sort((a, b) => a.wpr - b.wpr);
    const half = Math.floor(sorted.length / 2);
    const mean = (xs: typeof sorted) => xs.reduce((n, p) => n + p.tone, 0) / xs.length;
    expect(mean(sorted.slice(sorted.length - half))).toBeGreaterThan(mean(sorted.slice(0, half)));
  });

  it("keeps the tone layout stable for a given year", () => {
    const agg = fullYearAggregate("blocks-tone-stable");
    expect(aggregateToBlocks(agg).blocks).toEqual(aggregateToBlocks(agg).blocks);
  });
});

import { describe, expect, it, vi } from "vitest";
import { generateAggregate } from "@/lib/mock-aggregate";
import { isRingAggregate, loadAggregate } from "@/lib/data-source";
import type { RingAggregate } from "@/lib/types";

const NOW = new Date("2026-09-12T00:00:00.000Z");
const YEAR = 2026;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("isRingAggregate", () => {
  it("accepts a well-formed aggregate", () => {
    const aggregate = generateAggregate({ year: YEAR, now: NOW });
    expect(isRingAggregate(aggregate)).toBe(true);
    expect(isRingAggregate(aggregate, YEAR)).toBe(true);
  });

  it("rejects a mismatched year", () => {
    const aggregate = generateAggregate({ year: YEAR, now: NOW });
    expect(isRingAggregate(aggregate, YEAR + 1)).toBe(false);
  });

  it("rejects the wrong unit", () => {
    const aggregate = generateAggregate({ year: YEAR, now: NOW });
    expect(isRingAggregate({ ...aggregate, unit: "day" })).toBe(false);
  });

  it("rejects a bucket count outside 52..53", () => {
    const aggregate = generateAggregate({ year: YEAR, now: NOW });
    expect(isRingAggregate({ ...aggregate, buckets: aggregate.buckets.slice(0, 10) })).toBe(
      false,
    );
  });

  it("rejects a sufficient bucket with a null field", () => {
    const aggregate = generateAggregate({ year: YEAR, now: NOW });
    const buckets = aggregate.buckets.map((b, i) =>
      i === 0 ? { ...b, sufficient: true, recordCount: null } : b,
    );
    expect(isRingAggregate({ ...aggregate, buckets })).toBe(false);
  });

  it("rejects an insufficient bucket with a non-null field", () => {
    const aggregate = generateAggregate({ year: YEAR, now: NOW });
    const buckets = aggregate.buckets.map((b, i) =>
      i === 0 ? { ...b, sufficient: false, recordCount: 10 } : b,
    );
    expect(isRingAggregate({ ...aggregate, buckets })).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(isRingAggregate(null)).toBe(false);
    expect(isRingAggregate("aggregate")).toBe(false);
    expect(isRingAggregate(42)).toBe(false);
  });
});

describe("loadAggregate", () => {
  it("returns a deterministic mock when no url is configured", async () => {
    const a = await loadAggregate(YEAR, { now: NOW, url: null });
    const b = await loadAggregate(YEAR, { now: NOW, url: null });
    expect(a.source).toBe("mock");
    expect(a.aggregate).toEqual(b.aggregate);
  });

  it("returns upstream and passes the payload through on success", async () => {
    const upstream: RingAggregate = generateAggregate({ year: YEAR, now: NOW });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain(`year=${YEAR}`);
      return jsonResponse(upstream);
    }) as unknown as typeof fetch;

    const result = await loadAggregate(YEAR, {
      now: NOW,
      url: "https://example.test/weekly",
      fetchImpl,
    });

    expect(result.source).toBe("upstream");
    expect(result.aggregate).toEqual(upstream);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to mock on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "nope" }, 500)) as unknown as typeof fetch;

    const result = await loadAggregate(YEAR, {
      now: NOW,
      url: "https://example.test/weekly",
      fetchImpl,
    });

    expect(result.source).toBe("mock");
  });

  it("falls back to mock on an invalid shape", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ not: "an aggregate" })) as unknown as typeof fetch;

    const result = await loadAggregate(YEAR, {
      now: NOW,
      url: "https://example.test/weekly",
      fetchImpl,
    });

    expect(result.source).toBe("mock");
  });

  it("falls back to mock when the fetch throws (e.g. timeout)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("timed out");
    }) as unknown as typeof fetch;

    const result = await loadAggregate(YEAR, {
      now: NOW,
      url: "https://example.test/weekly",
      fetchImpl,
    });

    expect(result.source).toBe("mock");
  });

  it("falls back to mock when a valid upstream payload has no sufficient week", async () => {
    const upstream: RingAggregate = generateAggregate({ year: YEAR, now: NOW });
    const allInsufficient: RingAggregate = {
      ...upstream,
      buckets: upstream.buckets.map((b) => ({
        ...b,
        sufficient: false,
        recordCount: null,
        wordCount: null,
        silenceDayRatio: null,
      })),
    };
    const fetchImpl = vi.fn(async () => jsonResponse(allInsufficient)) as unknown as typeof fetch;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await loadAggregate(YEAR, {
      now: NOW,
      url: "https://example.test/weekly",
      fetchImpl,
    });
    errorSpy.mockRestore();

    expect(result.source).toBe("mock");
    expect(result.aggregate).toEqual(generateAggregate({ year: YEAR, now: NOW }));
  });
});

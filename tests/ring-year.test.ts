import { describe, expect, it } from "vitest";
import { MIN_RING_YEAR, validateRingYear } from "@/lib/ring-year";

const NOW = new Date("2026-09-12T00:00:00.000Z");

describe("validateRingYear", () => {
  it("rejects a year below MIN_RING_YEAR", () => {
    const result = validateRingYear(MIN_RING_YEAR - 1, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(`${MIN_RING_YEAR}`);
    }
  });

  it("rejects a year above the current year", () => {
    const result = validateRingYear(2027, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("2026");
    }
  });

  it("accepts a valid year", () => {
    expect(validateRingYear(MIN_RING_YEAR, NOW)).toEqual({ ok: true });
    expect(validateRingYear(2026, NOW)).toEqual({ ok: true });
  });

  it("rejects a non-integer year", () => {
    const result = validateRingYear(2026.5, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("integer");
    }
  });
});

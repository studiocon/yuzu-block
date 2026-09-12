import { describe, expect, it } from "vitest";
import { MIN_DATA_YEAR, validateDataYear } from "@/lib/data-year";

const NOW = new Date("2026-09-12T00:00:00.000Z");

describe("validateDataYear", () => {
  it("rejects a year below MIN_DATA_YEAR", () => {
    const result = validateDataYear(MIN_DATA_YEAR - 1, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(`${MIN_DATA_YEAR}`);
    }
  });

  it("rejects a year above the current year", () => {
    const result = validateDataYear(2027, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("2026");
    }
  });

  it("accepts a valid year", () => {
    expect(validateDataYear(MIN_DATA_YEAR, NOW)).toEqual({ ok: true });
    expect(validateDataYear(2026, NOW)).toEqual({ ok: true });
  });

  it("rejects a non-integer year", () => {
    const result = validateDataYear(2026.5, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("integer");
    }
  });
});

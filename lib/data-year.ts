// Which years this project will answer for. Kept clear of the mock
// generator so that real-data paths (the page, the MCP tool) do not
// depend on the mock module just to ask what year it is.

export const MIN_DATA_YEAR = 2026;

/** The latest year data can exist for. Buckets are UTC-based ISO weeks. */
export function currentYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

export type DataYearValidation = { ok: true } | { ok: false; message: string };

/**
 * Validates a year argument for `get_ring_data`: must be an integer within
 * [MIN_DATA_YEAR, currentYear(now)].
 */
export function validateDataYear(year: number, now?: Date): DataYearValidation {
  const maxYear = currentYear(now);

  if (!Number.isInteger(year)) {
    return { ok: false, message: `year must be an integer, got ${year}.` };
  }

  if (year < MIN_DATA_YEAR || year > maxYear) {
    return {
      ok: false,
      message: `year must be between ${MIN_DATA_YEAR} and ${maxYear}, got ${year}.`,
    };
  }

  return { ok: true };
}

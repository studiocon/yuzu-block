import { currentYear } from "./mock-aggregate";

export const MIN_RING_YEAR = 2026;

export type RingYearValidation = { ok: true } | { ok: false; message: string };

/**
 * Validates a year argument for `get_ring_data`: must be an integer within
 * [MIN_RING_YEAR, currentYear(now)].
 */
export function validateRingYear(year: number, now?: Date): RingYearValidation {
  const maxYear = currentYear(now);

  if (!Number.isInteger(year)) {
    return { ok: false, message: `year must be an integer, got ${year}.` };
  }

  if (year < MIN_RING_YEAR || year > maxYear) {
    return {
      ok: false,
      message: `year must be between ${MIN_RING_YEAR} and ${maxYear}, got ${year}.`,
    };
  }

  return { ok: true };
}

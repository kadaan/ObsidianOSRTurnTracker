/** Shared, tool-agnostic value validators for block codecs. */

/** A number that is a whole, non-negative integer — the shape most codec counts take. */
export const isNonNegativeInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Clamp a number into the inclusive range [min, max]. */
export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/** Shared, tool-agnostic value validators for block codecs. */

/** A number that is a whole, non-negative integer — the shape most codec counts take. */
export const isNonNegativeInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

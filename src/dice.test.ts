import { describe, it, expect } from "vitest";
import { rollDuration } from "./dice";

/** An rng that yields the given [0,1) values in order (then repeats the last). */
const seq = (...values: number[]): (() => number) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

describe("rollDuration", () => {
  it("passes a plain whole number through, not rolled", () => {
    expect(rollDuration("6")).toEqual({ total: 6, rolled: false, expr: "6" });
  });

  it("rolls XdY, summing the dice", () => {
    // rng 0 → min face (1), 0.999 → max face (6)
    expect(rollDuration("2d6", seq(0, 0.999))).toEqual({ total: 7, rolled: true, expr: "2d6" });
  });

  it("applies a + modifier after the dice", () => {
    expect(rollDuration("1d6+2", seq(0.5))).toEqual({ total: 6, rolled: true, expr: "1d6+2" });
  });

  it("applies a - modifier", () => {
    expect(rollDuration("2d6-1", seq(0.5, 0.5))).toEqual({ total: 7, rolled: true, expr: "2d6-1" });
  });

  it("defaults the count to 1 for `dY` and canonicalizes it", () => {
    expect(rollDuration("d20", seq(0.95))).toMatchObject({ rolled: true, expr: "1d20" });
  });

  it("canonicalizes whitespace and leading zeros so equivalent inputs share an expr", () => {
    expect(rollDuration(" 2d6 + 1 ", seq(0.5, 0.5))).toMatchObject({ total: 9, expr: "2d6+1" });
    expect(rollDuration("06")).toMatchObject({ total: 6, expr: "6" });
  });

  it("returns undefined for unparseable input", () => {
    expect(rollDuration("banana")).toBeUndefined();
    expect(rollDuration("d")).toBeUndefined();
    expect(rollDuration("")).toBeUndefined();
  });

  it("rejects a pathological dice count", () => {
    expect(rollDuration("9999d6")).toBeUndefined();
  });

  it("can produce a non-positive total (caller decides if that's valid)", () => {
    expect(rollDuration("1d4-10", seq(0))?.total).toBe(-9); // 1 - 10
  });
});

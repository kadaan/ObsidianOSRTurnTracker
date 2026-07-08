import { describe, it, expect } from "vitest";
import { parseTrackerState } from "./parse";

describe("parseTrackerState", () => {
  it("parses a valid block into state, defaulting the marker list", () => {
    const result = parseTrackerState("position: 14");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.position).toBe(14);
    expect(result.state.markers).toEqual([]);
  });

  it("returns an error (does not throw) on malformed YAML", () => {
    const result = parseTrackerState("position: 14\n  : : broken");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeTruthy();
  });

  it("rejects a negative or non-integer position", () => {
    expect(parseTrackerState("position: -3").ok).toBe(false);
    expect(parseTrackerState("position: 2.5").ok).toBe(false);
    expect(parseTrackerState("position: banana").ok).toBe(false);
  });

  it("rejects a position far larger than any real tracker", () => {
    expect(parseTrackerState("position: 100000000").ok).toBe(false);
  });

  it("defaults a missing position to 0", () => {
    const result = parseTrackerState("calendar: Greyhawk");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.position).toBe(0);
  });

  it("rejects an unknown field (e.g. a mistyped key) naming the offender", () => {
    const result = parseTrackerState("pos tion: 5");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("pos tion");
  });

  it("still accepts the legacy lights/markers keys", () => {
    expect(parseTrackerState("lights: []").ok).toBe(true);
    expect(parseTrackerState("markers: []").ok).toBe(true);
  });

  it("rejects a block that isn't a mapping", () => {
    expect(parseTrackerState("- just\n- a list").ok).toBe(false);
    expect(parseTrackerState("42").ok).toBe(false);
  });
});

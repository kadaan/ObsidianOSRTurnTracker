import { describe, it, expect } from "vitest";
import { serializeTrackerState } from "./serialize";
import { parseTrackerState } from "./parse";
import { TrackerState } from "./model";

describe("serializeTrackerState (round-trip)", () => {
  it("preserves a fully-populated state through serialize → parse", () => {
    const state: TrackerState = {
      start: "2016-05-21T08:00",
      calendar: "Calendar of Greyhawk",
      position: 14,
      lights: [{ preset: "torch", expiresAt: 20 }],
      effects: [{ label: "Poison", expiresAt: 33 }],
    };

    const result = parseTrackerState(serializeTrackerState(state));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual(state);
  });
});

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

  it("round-trips a light's custom instance label", () => {
    const state: TrackerState = {
      position: 4,
      lights: [{ preset: "torch", label: "Aragorn's torch", startsAt: 0, expiresAt: 6 }],
      effects: [],
    };

    const result = parseTrackerState(serializeTrackerState(state));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.lights[0]).toEqual({
      preset: "torch",
      label: "Aragorn's torch",
      startsAt: 0,
      expiresAt: 6,
    });
  });

  it("sorts lights and effects ascending by start, then by name", () => {
    const state: TrackerState = {
      position: 30,
      lights: [
        { preset: "torch", startsAt: 20, expiresAt: 26 },
        { preset: "lantern", startsAt: 10, expiresAt: 34 },
      ],
      effects: [
        { label: "Web", startsAt: 20, expiresAt: 40 },
        { label: "Bless", startsAt: 20, expiresAt: 40 },
        { label: "Haste", startsAt: 10, expiresAt: 40 },
      ],
    };

    const result = parseTrackerState(serializeTrackerState(state));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.lights.map((l) => l.preset)).toEqual(["lantern", "torch"]);
    expect(result.state.effects.map((e) => e.label)).toEqual(["Haste", "Bless", "Web"]);
  });
});

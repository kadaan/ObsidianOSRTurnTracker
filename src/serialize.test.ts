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
      lights: [{ preset: "torch", duration: 20 }],
      effects: [{ label: "Poison", duration: 33 }],
    };

    const result = parseTrackerState(serializeTrackerState(state));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual(state);
  });

  it("round-trips a light's custom instance label", () => {
    const state: TrackerState = {
      position: 4,
      lights: [{ preset: "torch", label: "Aragorn's torch", startsAt: 0, duration: 6 }],
      effects: [],
    };

    const result = parseTrackerState(serializeTrackerState(state));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.lights[0]).toEqual({
      preset: "torch",
      label: "Aragorn's torch",
      startsAt: 0,
      duration: 6,
    });
  });

  it("round-trips a marker's pause history", () => {
    const state: TrackerState = {
      position: 20,
      lights: [
        { preset: "torch", startsAt: 0, duration: 6, pauses: [{ at: 3, until: 10 }, { at: 15 }] },
      ],
      effects: [],
    };

    const result = parseTrackerState(serializeTrackerState(state));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.lights[0].pauses).toEqual([{ at: 3, until: 10 }, { at: 15 }]);
  });

  it("round-trips the render origin, and omits it when zero", () => {
    const withOrigin = parseTrackerState(
      serializeTrackerState({ position: 600, origin: 576, lights: [], effects: [] }),
    );
    expect(withOrigin.ok && withOrigin.state.origin).toBe(576);

    const zero = serializeTrackerState({ position: 5, origin: 0, lights: [], effects: [] });
    expect(zero).not.toContain("origin");
  });

  it("reads the legacy expiresAt form as a duration", () => {
    const legacy = ["position: 300", "lights:", "  - preset: torch", "    startsAt: 288", "    expiresAt: 294"].join("\n");

    const result = parseTrackerState(legacy);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.lights[0]).toEqual({ preset: "torch", startsAt: 288, duration: 6 });
  });

  it("sorts lights and effects ascending by start, then by name", () => {
    const state: TrackerState = {
      position: 30,
      lights: [
        { preset: "torch", startsAt: 20, duration: 6 },
        { preset: "lantern", startsAt: 10, duration: 24 },
      ],
      effects: [
        { label: "Web", startsAt: 20, duration: 20 },
        { label: "Bless", startsAt: 20, duration: 20 },
        { label: "Haste", startsAt: 10, duration: 30 },
      ],
    };

    const result = parseTrackerState(serializeTrackerState(state));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.lights.map((l) => l.preset)).toEqual(["lantern", "torch"]);
    expect(result.state.effects.map((e) => e.label)).toEqual(["Haste", "Bless", "Web"]);
  });
});

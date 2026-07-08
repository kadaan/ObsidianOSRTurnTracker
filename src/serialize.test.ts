import { describe, it, expect } from "vitest";
import { serializeTrackerState } from "./serialize";
import { parseTrackerState } from "./parse";
import { TrackerState } from "./model";

describe("serializeTrackerState (round-trip)", () => {
  it("preserves a fully-populated state through serialize → parse", () => {
    // Authored in serialize order (by start, then name) so the round-trip is order-stable.
    const state: TrackerState = {
      start: "2016-05-21T08:00",
      calendar: "Calendar of Greyhawk",
      position: 14,
      markers: [
        { type: "custom", label: "Poison", duration: 33 },
        { type: "torch", duration: 20 },
      ],
    };

    const result = parseTrackerState(serializeTrackerState(state));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual(state);
  });

  it("emits the unified list under the `effects` key, not `markers`", () => {
    const yaml = serializeTrackerState({
      position: 0,
      markers: [{ type: "torch", startsAt: 0, duration: 6 }],
    });

    expect(yaml).toContain("effects:");
    expect(yaml).not.toContain("markers:");
  });

  it("round-trips a marker's custom instance label", () => {
    const state: TrackerState = {
      position: 4,
      markers: [{ type: "torch", label: "Aragorn's torch", startsAt: 0, duration: 6 }],
    };

    const result = parseTrackerState(serializeTrackerState(state));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.markers[0]).toEqual({
      type: "torch",
      label: "Aragorn's torch",
      startsAt: 0,
      duration: 6,
    });
  });

  it("round-trips a marker's pause history", () => {
    const state: TrackerState = {
      position: 20,
      markers: [
        { type: "torch", startsAt: 0, duration: 6, pauses: [{ at: 3, until: 10 }, { at: 15 }] },
      ],
    };

    const result = parseTrackerState(serializeTrackerState(state));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.markers[0].pauses).toEqual([{ at: 3, until: 10 }, { at: 15 }]);
  });

  it("round-trips notes, sorted by turn", () => {
    const state: TrackerState = {
      position: 20,
      markers: [],
      notes: [
        { at: 15, text: "later" },
        { at: 3, text: "earlier" },
      ],
    };

    const result = parseTrackerState(serializeTrackerState(state));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.notes).toEqual([
      { at: 3, text: "earlier" },
      { at: 15, text: "later" },
    ]);
  });

  it("round-trips the render origin, and omits it when zero", () => {
    const withOrigin = parseTrackerState(
      serializeTrackerState({ position: 600, origin: 576, markers: [] }),
    );
    expect(withOrigin.ok && withOrigin.state.origin).toBe(576);

    const zero = serializeTrackerState({ position: 5, origin: 0, markers: [] });
    expect(zero).not.toContain("origin");
  });

  it("reads a legacy light (preset field) and expiresAt as a duration marker", () => {
    const legacy = ["position: 300", "lights:", "  - preset: torch", "    startsAt: 288", "    expiresAt: 294"].join("\n");

    const result = parseTrackerState(legacy);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.markers[0]).toEqual({ type: "torch", startsAt: 288, duration: 6 });
  });

  it("reads a legacy effect (label-only) as a custom marker", () => {
    const legacy = ["position: 20", "effects:", "  - label: Poison", "    startsAt: 10", "    duration: 4"].join("\n");

    const result = parseTrackerState(legacy);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.markers[0]).toEqual({ type: "custom", label: "Poison", startsAt: 10, duration: 4 });
  });

  it("sorts markers ascending by start, then by name", () => {
    const state: TrackerState = {
      position: 30,
      markers: [
        { type: "torch", startsAt: 20, duration: 6 },
        { type: "lantern", startsAt: 10, duration: 24 },
        { type: "custom", label: "Web", startsAt: 20, duration: 20 },
        { type: "custom", label: "Bless", startsAt: 20, duration: 20 },
        { type: "custom", label: "Haste", startsAt: 10, duration: 30 },
      ],
    };

    const result = parseTrackerState(serializeTrackerState(state));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // localeCompare is case-insensitive, so "torch" sorts before "Web".
    expect(result.state.markers.map((m) => m.label ?? m.type)).toEqual([
      "Haste",
      "lantern",
      "Bless",
      "torch",
      "Web",
    ]);
  });
});

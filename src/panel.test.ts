import { describe, it, expect } from "vitest";
import { computeEffectPanel } from "./panel";
import { TrackerState } from "./model";

describe("computeEffectPanel", () => {
  it("lists an active marker as a row with progress and turns remaining", () => {
    const state: TrackerState = {
      position: 12,
      markers: [{ type: "torch", startsAt: 10, duration: 6 }],
    };

    const { active, expired } = computeEffectPanel(state);

    expect(expired).toEqual([]);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      index: 0,
      label: "Torch", // the preset's display name, not its glyph
      startsAt: 10,
      expiresAt: 16, // effective expiry (start + duration)
      remaining: 4, // 16 - 12
    });
    expect(active[0].progress).toBeCloseTo((12 - 10) / 6); // 2/6
  });

  it("puts a marker at/past its expiry in the expired list", () => {
    const state: TrackerState = {
      position: 20,
      markers: [{ type: "torch", startsAt: 10, duration: 6 }],
    };

    const { active, expired } = computeEffectPanel(state);

    expect(active).toEqual([]);
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ index: 0, startsAt: 10, expiresAt: 16 });
  });

  it("clamps turns-remaining to zero for an expired marker", () => {
    const state: TrackerState = {
      position: 20,
      markers: [{ type: "torch", startsAt: 10, duration: 6 }],
    };

    expect(computeEffectPanel(state).expired[0].remaining).toBe(0); // not -4
  });

  it("lists a pending marker (rewound before it was lit) under upcoming", () => {
    const state: TrackerState = {
      position: 5,
      markers: [{ type: "torch", startsAt: 10, duration: 6 }],
    };

    const { active, upcoming, expired } = computeEffectPanel(state);

    expect(active).toEqual([]);
    expect(expired).toEqual([]);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]).toMatchObject({ index: 0, startsAt: 10, expiresAt: 16 });
  });

  it("numbers concurrently-active same-name markers, leaving the first unnumbered", () => {
    const state: TrackerState = {
      position: 8,
      markers: [
        { type: "torch", startsAt: 0, duration: 10 },
        { type: "torch", startsAt: 5, duration: 10 },
      ],
    };

    const { active } = computeEffectPanel(state);

    expect(active).toHaveLength(2);
    expect(active.map((r) => r.label)).toEqual(["Torch", "Torch 2"]);
    // Each row keeps its own source index so the display number never confuses targeting.
    expect(active.map((r) => r.index)).toEqual([0, 1]);
  });

  it("numbers identical (same-window) markers rather than collapsing them", () => {
    const state: TrackerState = {
      position: 12,
      markers: [
        { type: "torch", startsAt: 10, duration: 6 },
        { type: "torch", startsAt: 10, duration: 6 },
      ],
    };

    const { active } = computeEffectPanel(state);

    expect(active.map((r) => r.label)).toEqual(["Torch", "Torch 2"]);
  });

  it("reverts a survivor to the unnumbered name once the other has expired", () => {
    const state: TrackerState = {
      position: 12, // first torch (expires 10) is gone; second (expires 15) still lit
      markers: [
        { type: "torch", startsAt: 0, duration: 10 },
        { type: "torch", startsAt: 5, duration: 10 },
      ],
    };

    const { active, expired } = computeEffectPanel(state);

    expect(active.map((r) => r.label)).toEqual(["Torch"]);
    expect(expired.map((r) => r.label)).toEqual(["Torch"]);
  });

  it("carries each row's source index through the display sort, so targeting stays exact", () => {
    const state: TrackerState = {
      position: 30,
      markers: [
        { type: "custom", label: "Zeta", startsAt: 10, duration: 30 }, // source index 0
        { type: "custom", label: "Alpha", startsAt: 10, duration: 30 }, // source index 1
      ],
    };

    const { active } = computeEffectPanel(state);

    // Sorted by name, "Alpha" (index 1) displays before "Zeta" (index 0).
    expect(active.map((r) => r.label)).toEqual(["Alpha", "Zeta"]);
    expect(active.map((r) => r.index)).toEqual([1, 0]);
  });

  it("shows a marker's custom label as its name instead of the preset default", () => {
    const state: TrackerState = {
      position: 2,
      markers: [{ type: "torch", label: "Aragorn's torch", startsAt: 0, duration: 6 }],
    };

    const { active } = computeEffectPanel(state);

    expect(active[0]).toMatchObject({ index: 0, label: "Aragorn's torch" });
  });

  it("exposes the un-numbered base name for editing, even when the display label is numbered", () => {
    const state: TrackerState = {
      position: 8,
      markers: [
        { type: "torch", startsAt: 0, duration: 10 },
        { type: "torch", startsAt: 5, duration: 10 },
      ],
    };

    const { active } = computeEffectPanel(state);

    expect(active.map((r) => r.label)).toEqual(["Torch", "Torch 2"]);
    expect(active.map((r) => r.name)).toEqual(["Torch", "Torch"]);
  });

  it("puts a paused marker in the paused list with frozen remaining and a truncated span", () => {
    const state: TrackerState = {
      position: 20,
      markers: [{ type: "torch", startsAt: 0, duration: 6, pauses: [{ at: 3 }] }],
    };

    const { active, paused } = computeEffectPanel(state);

    expect(active).toEqual([]);
    expect(paused).toHaveLength(1);
    expect(paused[0]).toMatchObject({ remaining: 3, segments: [[0, 3]] });
  });

  it("flags markers whose preset is pausable, but never custom effects", () => {
    const state: TrackerState = {
      position: 2,
      markers: [
        { type: "torch", startsAt: 0, duration: 6 },
        { type: "custom", label: "Poison", startsAt: 0, duration: 6 },
      ],
    };

    const { active } = computeEffectPanel(state);

    expect(active.find((r) => r.label === "Torch")?.pausable).toBe(true);
    expect(active.find((r) => r.label === "Poison")?.pausable).toBe(false);
  });

  it("sorts each list ascending by start, then by name", () => {
    const state: TrackerState = {
      position: 30,
      markers: [
        { type: "custom", label: "Web", startsAt: 20, duration: 20 },
        { type: "custom", label: "Bless", startsAt: 20, duration: 20 },
        { type: "custom", label: "Haste", startsAt: 10, duration: 30 },
      ],
    };

    const { active } = computeEffectPanel(state);

    expect(active.map((r) => r.label)).toEqual(["Haste", "Bless", "Web"]);
  });

  it("keeps same-name markers with different starts as separate numbered rows", () => {
    const state: TrackerState = {
      position: 20,
      markers: [
        { type: "custom", label: "Web", startsAt: 10, duration: 12 },
        { type: "custom", label: "Web", startsAt: 18, duration: 4 },
      ],
    };

    expect(computeEffectPanel(state).active.map((r) => r.label)).toEqual(["Web", "Web 2"]);
  });
});

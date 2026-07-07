import { describe, it, expect } from "vitest";
import { seedTrackerState } from "./seed";

describe("seedTrackerState", () => {
  it("seeds start and calendar from frontmatter", () => {
    const state = seedTrackerState({ startTime: "2016-05-21T08:00", "fc-calendar": "Greyhawk" });

    expect(state).toEqual({
      start: "2016-05-21T08:00",
      calendar: "Greyhawk",
      position: 0,
      lights: [],
      effects: [],
    });
  });

  it("defaults to Day-1 / no calendar when frontmatter is absent or unrelated", () => {
    expect(seedTrackerState(undefined)).toEqual({ position: 0, lights: [], effects: [] });
    expect(seedTrackerState({ title: "Session 3" })).toEqual({ position: 0, lights: [], effects: [] });
  });
});

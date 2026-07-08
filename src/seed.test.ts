import { describe, it, expect } from "vitest";
import { seedTrackerState } from "./seed";

const PROPS = { calendarProperty: "fc-calendar", startProperty: "osrtt-ingame-date" };

describe("seedTrackerState", () => {
  it("seeds start and calendar from the configured frontmatter properties", () => {
    const state = seedTrackerState(
      { "osrtt-ingame-date": "2016-05-21T08:00", "fc-calendar": "Greyhawk" },
      PROPS,
    );

    expect(state).toEqual({
      start: "2016-05-21T08:00",
      calendar: "Greyhawk",
      position: 0,
      markers: [],
    });
  });

  it("honors custom property names", () => {
    const state = seedTrackerState(
      { campaign_cal: "Harptos", campaign_date: "1492-01-01" },
      { calendarProperty: "campaign_cal", startProperty: "campaign_date" },
    );

    expect(state).toEqual({ start: "1492-01-01", calendar: "Harptos", position: 0, markers: [] });
  });

  it("defaults to Day-1 / no calendar when frontmatter is absent or unrelated", () => {
    expect(seedTrackerState(undefined, PROPS)).toEqual({ position: 0, markers: [] });
    expect(seedTrackerState({ title: "Session 3" }, PROPS)).toEqual({ position: 0, markers: [] });
  });
});

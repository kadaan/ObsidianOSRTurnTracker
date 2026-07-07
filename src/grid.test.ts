import { describe, it, expect } from "vitest";
import { computeGrid } from "./grid";
import { TrackerState } from "./model";

function stateAt(position: number): TrackerState {
  return { position, lights: [], effects: [] };
}

describe("computeGrid", () => {
  it("marks the first `position` boxes past and the rest not", () => {
    const days = computeGrid(stateAt(14));

    const boxes = days.flatMap((d) => d.hours.flatMap((h) => h.boxes));
    const past = boxes.filter((b) => b.status === "past");

    expect(past).toHaveLength(14);
    expect(boxes.slice(0, 14).every((b) => b.status === "past")).toBe(true);
    expect(boxes[14].status).toBe("current");
  });

  it("renders one full 24h day when position fits within it", () => {
    const [day, ...rest] = computeGrid(stateAt(14));

    expect(rest).toHaveLength(0);
    expect(day.header).toBe("Day 1");
    expect(day.hours).toHaveLength(24);
    expect(day.hours.every((h) => h.boxes.length === 6)).toBe(true);
  });

  it("grows to include the day containing position, numbering days from 1", () => {
    // turn 150 lives in day 2 (turns 144-287)
    const days = computeGrid(stateAt(150));

    expect(days.map((d) => d.header)).toEqual(["Day 1", "Day 2"]);
    const boxes = days.flatMap((d) => d.hours.flatMap((h) => h.boxes));
    expect(boxes).toHaveLength(288);
    expect(boxes.filter((b) => b.status === "past")).toHaveLength(150);
  });

  it("classifies the boxes around `position` as past / current / future", () => {
    const boxes = computeGrid(stateAt(14)).flatMap((d) => d.hours.flatMap((h) => h.boxes));

    expect(boxes[13].status).toBe("past");
    expect(boxes[14].status).toBe("current");
    expect(boxes[15].status).toBe("future");
  });

  it("shows the current time on the in-progress day, computed from position", () => {
    // position 14 → 2h 20m into day 1
    expect(computeGrid(stateAt(14))[0].currentTime).toBe("02:20");
  });

  it("omits the current time on a completed day, shows it on the active one", () => {
    // position 150 → day 1 fully elapsed; day 2 is 6 turns (1h) in
    const days = computeGrid(stateAt(150));

    expect(days[0].currentTime).toBeUndefined();
    expect(days[1].currentTime).toBe("01:00");
  });

  it("marks fully-elapsed days complete and the in-progress day not", () => {
    const days = computeGrid(stateAt(150)); // day 1 fully elapsed, day 2 active

    expect(days[0].complete).toBe(true);
    expect(days[1].complete).toBe(false);
  });

  it("places a chip on the light's last lit turn (expiresAt - 1), labelled by the preset glyph", () => {
    const state: TrackerState = {
      position: 0,
      lights: [{ preset: "torch", expiresAt: 6 }],
      effects: [],
    };

    const boxes = computeGrid(state).flatMap((d) => d.hours.flatMap((h) => h.boxes));

    expect(boxes[5].markers).toEqual([
      { label: "T", count: 1, expired: false, kind: "light", key: "torch", expiresAt: 6 },
    ]);
    expect(boxes[6].markers).toEqual([]);
  });

  it("marks a chip expired once position passes the light's expiry, active while burning", () => {
    const torch = { preset: "torch", expiresAt: 6 };
    const chip = (position: number) =>
      computeGrid({ position, lights: [torch], effects: [] })
        .flatMap((d) => d.hours.flatMap((h) => h.boxes))[5].markers[0];

    expect(chip(3).expired).toBe(false); // still burning
    expect(chip(5).expired).toBe(false); // on the last lit turn, still burning
    expect(chip(6).expired).toBe(true); // moved past the last lit turn
  });

  it("stacks same-turn same-glyph markers into one counted chip", () => {
    const state: TrackerState = {
      position: 0,
      lights: [
        { preset: "torch", expiresAt: 6 },
        { preset: "torch", expiresAt: 6 },
      ],
      effects: [],
    };

    const boxes = computeGrid(state).flatMap((d) => d.hours.flatMap((h) => h.boxes));

    expect(boxes[5].markers).toEqual([
      { label: "T", count: 2, expired: false, kind: "light", key: "torch", expiresAt: 6 },
    ]);
  });

  it("keeps different glyphs on the same turn as separate chips", () => {
    const state: TrackerState = {
      position: 0,
      lights: [
        { preset: "torch", expiresAt: 6 },
        { preset: "lantern", expiresAt: 6 },
      ],
      effects: [],
    };

    const boxes = computeGrid(state).flatMap((d) => d.hours.flatMap((h) => h.boxes));

    expect(boxes[5].markers).toHaveLength(2);
  });

  it("auto-grows the grid to include a marker beyond the current day", () => {
    // position 0 would render only day 1; a lantern expiring at turn 200 (day 2) pulls day 2 in
    const state: TrackerState = {
      position: 0,
      lights: [{ preset: "lantern", expiresAt: 200 }],
      effects: [],
    };

    const days = computeGrid(state);

    expect(days).toHaveLength(2);
    const boxes = days.flatMap((d) => d.hours.flatMap((h) => h.boxes));
    expect(boxes[199].markers).toHaveLength(1); // chip on the last lit turn (expiresAt - 1)
  });

  it("places an effect chip at its last lit turn, using the effect label as the glyph", () => {
    const state: TrackerState = {
      position: 0,
      lights: [],
      effects: [{ label: "Pn", expiresAt: 4 }],
    };

    const boxes = computeGrid(state).flatMap((d) => d.hours.flatMap((h) => h.boxes));

    expect(boxes[3].markers).toEqual([
      { label: "Pn", count: 1, expired: false, kind: "effect", key: "Pn", expiresAt: 4 },
    ]);
  });

  it("labels hour rows 00:00 through 23:00", () => {
    const [day] = computeGrid(stateAt(0));

    expect(day.hours[0].label).toBe("00:00");
    expect(day.hours[8].label).toBe("08:00");
    expect(day.hours[23].label).toBe("23:00");
  });
});

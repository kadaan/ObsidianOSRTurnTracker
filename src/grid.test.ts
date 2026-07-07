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

  it("auto-grows the grid to include an active marker beyond the current day", () => {
    // a lantern lit at turn 0, expiring at 200 (day 2), pulls day 2 into view
    const state: TrackerState = {
      position: 0,
      lights: [{ preset: "lantern", startsAt: 0, expiresAt: 200 }],
      effects: [],
    };

    expect(computeGrid(state)).toHaveLength(2);
  });

  it("does not grow for a pending marker (rewound before it was lit)", () => {
    // position 0 but the lantern starts at turn 200 — not lit yet, so it shouldn't extend the grid
    const state: TrackerState = {
      position: 0,
      lights: [{ preset: "lantern", startsAt: 200, expiresAt: 224 }],
      effects: [],
    };

    expect(computeGrid(state)).toHaveLength(1);
  });

  it("counts markers starting and ending on each box (last active turn = expiresAt - 1)", () => {
    const state: TrackerState = {
      position: 10,
      lights: [
        { preset: "torch", startsAt: 4, expiresAt: 10 },
        { preset: "torch", startsAt: 4, expiresAt: 10 },
      ],
      effects: [],
    };

    const boxes = computeGrid(state).flatMap((d) => d.hours.flatMap((h) => h.boxes));

    expect(boxes[4].startingCount).toBe(2); // both start at turn 4
    expect(boxes[9].endingCount).toBe(2); // both end at turn 9 (expiresAt - 1)
    expect(boxes[5].endingCount).toBe(0);
  });

  it("flags boxes within a live marker's span", () => {
    const state: TrackerState = {
      position: 10,
      lights: [{ preset: "torch", startsAt: 4, expiresAt: 8 }],
      effects: [],
    };

    const boxes = computeGrid(state).flatMap((d) => d.hours.flatMap((h) => h.boxes));

    expect(boxes[3].spanned).toBe(false);
    expect(boxes[4].spanned).toBe(true); // start
    expect(boxes[7].spanned).toBe(true); // last active turn (expiresAt - 1)
    expect(boxes[8].spanned).toBe(false); // expiresAt (goes out) is outside the span
  });

  it("honors a configured look-ahead buffer for the render horizon", () => {
    const state: TrackerState = { position: 0, lights: [], effects: [] };

    expect(computeGrid(state)).toHaveLength(1); // default buffer stays within day 1
    expect(computeGrid(state, { lookaheadBuffer: 200 })).toHaveLength(2); // buffer reaches day 2
  });

  it("uses real-date headers when the state has a datetime start", () => {
    const state: TrackerState = { start: "2016-05-21T08:00", position: 0, lights: [], effects: [] };

    const header = computeGrid(state)[0].header;
    expect(header).not.toBe("Day 1");
    expect(header).toContain("2016");
  });

  it("honors a dayHeader override (e.g. a fantasy calendar)", () => {
    const state: TrackerState = { position: 0, lights: [], effects: [] };

    expect(computeGrid(state, { dayHeader: (i) => `Fantasy ${i}` })[0].header).toBe("Fantasy 0");
  });

  it("labels hour rows 00:00 through 23:00", () => {
    const [day] = computeGrid(stateAt(0));

    expect(day.hours[0].label).toBe("00:00");
    expect(day.hours[8].label).toBe("08:00");
    expect(day.hours[23].label).toBe("23:00");
  });
});

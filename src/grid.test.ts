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

  it("labels hour rows 00:00 through 23:00", () => {
    const [day] = computeGrid(stateAt(0));

    expect(day.hours[0].label).toBe("00:00");
    expect(day.hours[8].label).toBe("08:00");
    expect(day.hours[23].label).toBe("23:00");
  });
});

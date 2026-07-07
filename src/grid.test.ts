import { describe, it, expect } from "vitest";
import { computeGrid } from "./grid";
import { TrackerState } from "./model";

function stateAt(position: number): TrackerState {
  return { position, lights: [], effects: [] };
}

describe("computeGrid", () => {
  it("ticks the first `position` boxes and leaves the rest empty", () => {
    const days = computeGrid(stateAt(14));

    const boxes = days.flatMap((d) => d.hours.flatMap((h) => h.boxes));
    const ticked = boxes.filter((b) => b.ticked);

    expect(ticked).toHaveLength(14);
    expect(boxes.slice(0, 14).every((b) => b.ticked)).toBe(true);
    expect(boxes[14].ticked).toBe(false);
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
    expect(boxes.filter((b) => b.ticked)).toHaveLength(150);
  });

  it("labels hour rows 00:00 through 23:00", () => {
    const [day] = computeGrid(stateAt(0));

    expect(day.hours[0].label).toBe("00:00");
    expect(day.hours[8].label).toBe("08:00");
    expect(day.hours[23].label).toBe("23:00");
  });
});

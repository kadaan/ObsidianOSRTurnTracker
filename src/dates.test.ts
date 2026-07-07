import { describe, it, expect } from "vitest";
import { formatRealDate, makeDayHeader } from "./dates";
import { TrackerState } from "./model";

describe("formatRealDate", () => {
  const start = new Date("2016-05-21T08:00"); // a Saturday

  it("formats the start date with an ordinal (day 0)", () => {
    expect(formatRealDate(start, 0, "en-US")).toBe("Saturday 21st May 2016");
  });

  it("advances by dayIndex, rolling across month boundaries", () => {
    expect(formatRealDate(start, 1, "en-US")).toBe("Sunday 22nd May 2016");
    expect(formatRealDate(start, 11, "en-US")).toBe("Wednesday 1st June 2016"); // May 21 + 11 days
  });
});

describe("makeDayHeader", () => {
  const stateWith = (start?: string): TrackerState => ({ start, position: 0, lights: [], effects: [] });

  it("labels days 'Day N' when there is no start", () => {
    const header = makeDayHeader(stateWith(undefined));

    expect(header(0)).toBe("Day 1");
    expect(header(1)).toBe("Day 2");
  });

  it("uses real dates when start is a valid datetime", () => {
    const header = makeDayHeader(stateWith("2016-05-21T08:00"));

    expect(header(0)).not.toBe("Day 1");
    expect(header(0)).toContain("2016");
  });

  it("falls back to 'Day N' when start is not a valid date", () => {
    expect(makeDayHeader(stateWith("not-a-date"))(0)).toBe("Day 1");
  });
});

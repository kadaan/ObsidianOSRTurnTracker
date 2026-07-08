import { describe, it, expect, afterEach } from "vitest";
import { makeFantasyDayHeader, setCalendariumCurrentDate } from "./calendarium";
import { TrackerState } from "./model";

const stateWith = (calendar?: string): TrackerState => ({ calendar, position: 0, markers: [] });

function stubCalendarium(value: unknown): void {
  (globalThis as { window?: unknown }).window = { Calendarium: value };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("makeFantasyDayHeader", () => {
  it("returns undefined and doesn't warn when no calendar is set", () => {
    let warned = false;
    expect(makeFantasyDayHeader(stateWith(undefined), () => (warned = true))).toBeUndefined();
    expect(warned).toBe(false);
  });

  it("warns and returns undefined when the calendar is set but Calendarium is absent", () => {
    stubCalendarium(undefined);
    let warned = false;

    expect(makeFantasyDayHeader(stateWith("Greyhawk"), () => (warned = true))).toBeUndefined();
    expect(warned).toBe(true);
  });

  it("formats a fantasy date from the Calendarium API", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({
          static: {
            firstWeekDay: 0,
            weekdays: ["Sul", "Mol"],
            months: [
              { name: "Fireseek", length: 28 },
              { name: "Readying", length: 28 },
            ],
          },
        }),
        getStore: () => ({ getDaysBeforeDate: () => 1 }),
        getCurrentDate: () => ({ day: 1, month: 0, year: 591 }),
      }),
    });

    const header = makeFantasyDayHeader(stateWith("Greyhawk"), () => {});
    expect(header?.(0)).toBe("Mol, 1 Fireseek 591"); // weekday idx (0+1)%2 = 1 → "Mol"
  });

  it("advances by the calendar's own month lengths, not Gregorian months", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({
          static: {
            firstWeekDay: 0,
            weekdays: ["Sul", "Mol", "Wen"],
            months: [
              { name: "Fireseek", length: 28 },
              { name: "Readying", length: 28 },
            ],
          },
        }),
        getStore: () => ({ getDaysBeforeDate: () => 0 }),
        getCurrentDate: () => ({ day: 27, month: 0, year: 591 }),
      }),
    });

    // Day 27 of a 28-day month + 2 days rolls into the next month; a Gregorian Jan would read "29".
    expect(makeFantasyDayHeader(stateWith("Greyhawk"), () => {})?.(2)).toBe("Sul, 1 Readying 591");
  });

  it("advances via Calendarium's getOffsetDate when available (leap-accurate)", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({
          static: {
            firstWeekDay: 0,
            weekdays: ["Sul", "Mol", "Wen"],
            months: [
              { name: "Fireseek", length: 28 },
              { name: "Readying", length: 28 },
            ],
          },
        }),
        getStore: () => ({
          getDaysBeforeDate: () => 0,
          // A sentinel result the plain-month-length fallback could never produce.
          getOffsetDate: () => ({ day: 10, month: 1, year: 700 }),
        }),
        getCurrentDate: () => ({ day: 1, month: 0, year: 591 }),
      }),
    });

    expect(makeFantasyDayHeader(stateWith("Greyhawk"), () => {})?.(3)).toBe("Sul, 10 Readying 700");
  });

  it("hands a dash-segmented start to Calendarium's parseDate", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({
          static: {
            firstWeekDay: 0,
            weekdays: ["Sul", "Mol"],
            months: [
              { name: "Fireseek", length: 28 },
              { name: "Readying", length: 28 },
            ],
          },
        }),
        getStore: () => ({ getDaysBeforeDate: () => 1 }),
        getCurrentDate: () => ({ day: 1, month: 0, year: 591 }),
        parseDate: () => ({ day: 5, month: 1, year: 600 }), // Calendarium resolves the format order
      }),
    });

    const state: TrackerState = { calendar: "Greyhawk", start: "600-Readying-5", position: 0, markers: [] };
    expect(makeFantasyDayHeader(state, () => {})?.(0)).toBe("Mol, 5 Readying 600");
  });

  it("falls back to interpreting an ISO start when parseDate is unavailable", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({
          static: {
            firstWeekDay: 0,
            weekdays: ["Sul", "Mol"],
            months: [
              { name: "Fireseek", length: 28 },
              { name: "Readying", length: 28 },
            ],
          },
        }),
        getStore: () => ({ getDaysBeforeDate: () => 1 }),
        getCurrentDate: () => ({ day: 1, month: 0, year: 591 }),
      }),
    });

    // No parseDate on this API → "0600-02-05" is read as day 5 of the 2nd month, year 600.
    const state: TrackerState = { calendar: "Greyhawk", start: "0600-02-05T08:00", position: 0, markers: [] };
    expect(makeFantasyDayHeader(state, () => {})?.(0)).toBe("Mol, 5 Readying 600");
  });

  it("degrades a per-day formatting failure to 'Day N' instead of throwing", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({ static: { firstWeekDay: 0, weekdays: [], months: [] } }), // empty → nameOf(undefined) throws
        getStore: () => ({ getDaysBeforeDate: () => 0 }),
        getCurrentDate: () => ({ day: 1, month: 0, year: 591 }),
        getDate: (day: number, month: number, year: number) => ({ day, month, year }),
      }),
    });

    const header = makeFantasyDayHeader(stateWith("Greyhawk"), () => {});
    expect(header?.(0)).toBe("Day 1");
  });
});

describe("setCalendariumCurrentDate", () => {
  it("sets Calendarium's current date to the tracker's current day when a start is set", () => {
    let saved: unknown;
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({
          static: {
            firstWeekDay: 0,
            weekdays: ["Sul", "Mol"],
            months: [
              { name: "Fireseek", length: 28 },
              { name: "Readying", length: 28 },
            ],
          },
        }),
        getStore: () => ({
          getDaysBeforeDate: () => 0,
          getOffsetDate: (_base: unknown, offset: number) => ({ day: offset, month: 1, year: 602 }),
          setCurrentDate: (d: unknown) => {
            saved = d;
          },
        }),
        getCurrentDate: () => ({ day: 1, month: 0, year: 591 }),
      }),
    });

    // position 288 → day index 2, passed as the offset from the start date.
    setCalendariumCurrentDate({ calendar: "Greyhawk", start: "0600-02-05", position: 288, markers: [] });
    expect(saved).toEqual({ day: 2, month: 1, year: 602 });
  });

  it("does nothing without a start (the base would be Calendarium's own current date)", () => {
    let called = false;
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({ static: { firstWeekDay: 0, weekdays: ["Sul"], months: [{ name: "Fireseek", length: 28 }] } }),
        getStore: () => ({
          getDaysBeforeDate: () => 0,
          setCurrentDate: () => {
            called = true;
          },
        }),
        getCurrentDate: () => ({ day: 1, month: 0, year: 591 }),
      }),
    });

    setCalendariumCurrentDate({ calendar: "Greyhawk", position: 288, markers: [] });
    expect(called).toBe(false);
  });
});

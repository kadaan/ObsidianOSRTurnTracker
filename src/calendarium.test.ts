import { describe, it, expect, afterEach } from "vitest";
import { makeFantasyDayHeader } from "./calendarium";
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
        getObject: () => ({ static: { firstWeekDay: 0, weekdays: ["Sul", "Mol"], months: ["Fireseek", "Readying"] } }),
        getStore: () => ({ getDaysBeforeDate: () => 1 }),
        getCurrentDate: () => ({ day: 1, month: 0, year: 591 }),
        getDate: (day: number, month: number, year: number) => ({ day, month, year }),
      }),
    });

    const header = makeFantasyDayHeader(stateWith("Greyhawk"), () => {});
    expect(header?.(0)).toBe("Mol, 1 Fireseek 591"); // weekday idx (0+1)%2 = 1 → "Mol"
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

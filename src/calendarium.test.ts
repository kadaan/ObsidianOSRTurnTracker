import { describe, it, expect, afterEach } from "vitest";
import {
  calendarError,
  calendarNames,
  currentDateAsStart,
  defaultCalendarName,
  makeFantasyDayHeader,
  setCalendariumCurrentDate,
  startDateError,
} from "./calendarium";
import { TrackerState } from "./model";

const stateWith = (calendar?: string): TrackerState => ({ calendar, position: 0, markers: [] });

function stubCalendarium(value: unknown): void {
  (globalThis as { window?: unknown }).window = { Calendarium: value };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

// Stand-in for Calendarium's own toDisplayDate — enough to verify which CalDate we hand it.
const MONTHS = ["Fireseek", "Readying"];
const displayDate = (d: { day: number; month: number; year: number }): string =>
  `${d.day} ${MONTHS[d.month]} ${d.year}`;

// A minimal Svelte-style readable store (synchronous value emit, no-op unsubscribe).
const readable = <T>(value: T) => ({
  subscribe: (run: (v: T) => void) => {
    run(value);
    return () => {};
  },
});

/** A per-month store like Calendarium's: fixed weekday names + the weekday index of the month's day 1. */
const monthStore = (weekdays: string[], firstDay: number) => () => ({
  weekdays: readable(weekdays),
  firstDay: readable(firstDay),
});

// A Dolmenwood-like calendar: Calendarium parses dates year-first (year-monthName-day) regardless of
// display format — resolving the month by numeric index or name prefix (unknown → 0), and coercing a
// non-numeric day/year to NaN. Shared by the startDateError and currentDateAsStart specs.
const DOLMENWOOD_MONTHS = [
  { name: "Grimvold", length: 28 },
  { name: "Lymewald", length: 28 },
];
const yearFirstParse =
  (months: { name: string }[]) =>
  (s: string): { year: number; month: number; day: number } => {
    const [y, m, d] = s.split("-");
    const num = (x: string | undefined) => (/^\d+$/.test(x ?? "") ? Number(x) : NaN);
    const month = /^\d+$/.test(m ?? "")
      ? Number(m) - 1
      : Math.max(0, months.findIndex((mm) => mm.name.toLowerCase().startsWith((m ?? "").toLowerCase())));
    return { year: num(y), month, day: num(d) };
  };

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

  it("prefixes the weekday from the month store and formats the date via toDisplayDate", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({ static: { months: [{ length: 28 }, { length: 28 }] } }),
        getStore: () => ({ getMonthStoreForDate: monthStore(["Sul", "Mol"], 1) }),
        getCurrentDate: () => ({ day: 1, month: 0, year: 591 }),
        toDisplayDate: displayDate,
      }),
    });

    // firstDay 1, day 1 → weekday index wrap(1 + 0, 2) = 1 → "Mol".
    expect(makeFantasyDayHeader(stateWith("Greyhawk"), () => {})?.(0)).toBe("Mol, 1 Fireseek 591");
  });

  it("derives the weekday from the month's firstDay plus the day offset (the Dolmenwood case)", () => {
    const dolmenwood = ["Colly", "Chime", "Hayme", "Moot", "Fireday", "Eggfast", "Sunning"];
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({ static: { months: [{ length: 30 }] } }),
        // Grimvold's day 1 is Colly (firstDay 0); day 14 → wrap(0 + 13, 7) = 6 → "Sunning",
        // matching Calendarium (the old total-days-before formula reported Eggfast here).
        getStore: () => ({ getMonthStoreForDate: monthStore(dolmenwood, 0) }),
        getCurrentDate: () => ({ day: 1, month: 0, year: 1089 }),
        toDisplayDate: (d: { day: number; month: number; year: number }) =>
          `${d.day} Grimvold ${d.year}`,
        parseDate: () => ({ day: 14, month: 0, year: 1089 }),
      }),
    });

    const state: TrackerState = { calendar: "Dolmenwood", start: "1089-Grimvold-14", position: 0, markers: [] };
    expect(makeFantasyDayHeader(state, () => {})?.(0)).toBe("Sunning, 14 Grimvold 1089");
  });

  it("advances by the calendar's own month lengths, not Gregorian months", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({ static: { months: [{ length: 28 }, { length: 28 }] } }),
        getStore: () => ({ getMonthStoreForDate: monthStore(["Sul", "Mol", "Wen"], 0) }),
        getCurrentDate: () => ({ day: 27, month: 0, year: 591 }),
        toDisplayDate: displayDate,
      }),
    });

    // Day 27 of a 28-day month + 2 days rolls into the next month; a Gregorian Jan would read "29".
    expect(makeFantasyDayHeader(stateWith("Greyhawk"), () => {})?.(2)).toBe("Sul, 1 Readying 591");
  });

  it("advances via Calendarium's getOffsetDate when available (leap-accurate)", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({ static: { months: [{ length: 28 }, { length: 28 }] } }),
        getStore: () => ({
          // A sentinel result the plain-month-length fallback could never produce.
          getOffsetDate: () => ({ day: 10, month: 1, year: 700 }),
          getMonthStoreForDate: monthStore(["Sul", "Mol", "Wen"], 0),
        }),
        getCurrentDate: () => ({ day: 1, month: 0, year: 591 }),
        toDisplayDate: displayDate,
      }),
    });

    // day 10 → wrap(0 + 9, 3) = 0 → "Sul".
    expect(makeFantasyDayHeader(stateWith("Greyhawk"), () => {})?.(3)).toBe("Sul, 10 Readying 700");
  });

  it("hands a dash-segmented start to Calendarium's parseDate", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({ static: { months: [{ length: 28 }, { length: 28 }] } }),
        getStore: () => ({ getMonthStoreForDate: monthStore(["Sul", "Mol"], 1) }),
        getCurrentDate: () => ({ day: 1, month: 0, year: 591 }),
        parseDate: () => ({ day: 5, month: 1, year: 600 }), // Calendarium resolves the format order
        toDisplayDate: displayDate,
      }),
    });

    // day 5 → wrap(1 + 4, 2) = 1 → "Mol".
    const state: TrackerState = { calendar: "Greyhawk", start: "600-Readying-5", position: 0, markers: [] };
    expect(makeFantasyDayHeader(state, () => {})?.(0)).toBe("Mol, 5 Readying 600");
  });

  it("omits the weekday when the month store is unavailable (older Calendarium)", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({ static: { months: [{ length: 28 }, { length: 28 }] } }),
        getStore: () => ({}), // no getMonthStoreForDate
        getCurrentDate: () => ({ day: 1, month: 0, year: 591 }),
        toDisplayDate: displayDate,
      }),
    });

    expect(makeFantasyDayHeader(stateWith("Greyhawk"), () => {})?.(0)).toBe("1 Fireseek 591");
  });

  it("labels a leap/feast day by its Calendarium name, and a plain day by its weekday", () => {
    const dolmenwood = ["Colly", "Chime", "Hayme", "Moot", "Fireday", "Eggfast", "Sunning"];
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({ static: { months: [{ name: "Grimvold", length: 28 }] } }),
        getStore: () => ({
          getOffsetDate: (_d: unknown, offset: number) => ({ day: 28 + offset, month: 0, year: 1089 }),
          getMonthStoreForDate: () => ({
            weekdays: readable(dolmenwood),
            firstDay: readable(0),
            // Grimvold's two same-`after` feasts: Calendarium names only the first (day 29); day 30
            // is a plain day (name null) — the "mirror Calendarium" behavior we chose.
            daysAsWeeks: readable([
              [
                { number: 28, name: null },
                { number: 29, name: "Hanglemas" },
                { number: 30, name: null },
              ],
            ]),
          }),
        }),
        getCurrentDate: () => ({ day: 1, month: 0, year: 1089 }),
        toDisplayDate: (d: { day: number; month: number; year: number }) => `${d.day} Grimvold ${d.year}`,
      }),
    });

    const header = makeFantasyDayHeader(stateWith("Dolmenwood"), () => {});
    expect(header?.(0)).toBe("Sunning, 28 Grimvold 1089"); // day 28: plain day → weekday
    expect(header?.(1)).toBe("Hanglemas, 29 Grimvold 1089"); // day 29: feast → its own name
    expect(header?.(2)).toBe("Chime, 30 Grimvold 1089"); // day 30: unnamed feast → falls back to weekday
  });

  it("degrades a per-day formatting failure to 'Day N' instead of throwing", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({ static: { months: [] } }),
        getStore: () => ({}),
        getCurrentDate: () => ({ day: 1, month: 0, year: 591 }),
        toDisplayDate: () => {
          throw new Error("boom");
        },
      }),
    });

    const header = makeFantasyDayHeader(stateWith("Greyhawk"), () => {});
    expect(header?.(0)).toBe("Day 1");
  });
});

describe("calendarNames", () => {
  it("returns Calendarium's calendar list", () => {
    stubCalendarium({ getAPI: () => ({}), getCalendars: () => ["Dolmenwood", "Greyhawk"] });
    expect(calendarNames()).toEqual(["Dolmenwood", "Greyhawk"]);
  });

  it("returns an empty list when Calendarium is absent or can't list", () => {
    stubCalendarium(undefined);
    expect(calendarNames()).toEqual([]);
    stubCalendarium({ getAPI: () => ({}) }); // no getCalendars
    expect(calendarNames()).toEqual([]);
  });
});

describe("defaultCalendarName", () => {
  it("returns the name of Calendarium's default calendar (getAPI with no argument)", () => {
    stubCalendarium({
      getAPI: (name?: string) => ({ getObject: () => ({ name: name ?? "Default Cal", static: { months: [] } }) }),
    });
    expect(defaultCalendarName()).toBe("Default Cal");
  });

  it("returns undefined when Calendarium is absent or has no default", () => {
    stubCalendarium(undefined);
    expect(defaultCalendarName()).toBeUndefined();
    stubCalendarium({
      getAPI: () => ({ getObject: () => ({ name: "", static: { months: [] } }) }),
    });
    expect(defaultCalendarName()).toBeUndefined();
  });
});

describe("calendarError", () => {
  it("returns undefined for no calendar", () => {
    expect(calendarError(undefined)).toBeUndefined();
  });

  it("returns undefined when Calendarium isn't installed (soft fallback)", () => {
    stubCalendarium(undefined);
    expect(calendarError("Dolmenwood")).toBeUndefined();
  });

  it("returns undefined when the calendar name is known", () => {
    stubCalendarium({ getAPI: () => ({}), getCalendars: () => ["Dolmenwood", "Greyhawk"] });
    expect(calendarError("Dolmenwood")).toBeUndefined();
  });

  it("returns an error naming the available calendars when the name is unknown", () => {
    stubCalendarium({ getAPI: () => ({}), getCalendars: () => ["Dolmenwood", "Greyhawk"] });
    const error = calendarError("Dolmnwood");
    expect(error).toContain("Dolmnwood");
    expect(error).toContain("Dolmenwood, Greyhawk");
  });

  it("returns undefined when Calendarium is too old to list calendars", () => {
    stubCalendarium({ getAPI: () => ({}) }); // no getCalendars
    expect(calendarError("Dolmenwood")).toBeUndefined();
  });
});

describe("startDateError", () => {
  const MONTHS = DOLMENWOOD_MONTHS;
  // Dolmenwood: Calendarium *parses* year-first even though it *displays* day-first (DD-MM-YYYY).
  const yearFirst = {
    getAPI: () => ({
      getObject: () => ({ name: "Dolmenwood", dateFormat: "DD-MM-YYYY", static: { months: MONTHS } }),
      getStore: () => ({}),
      getCurrentDate: () => ({ day: 15, month: 0, year: 1089 }),
      parseDate: yearFirstParse(MONTHS),
      toDisplayDate: (dte: { day: number; month: number; year: number }) => `${dte.day}-${dte.month + 1}-${dte.year}`,
    }),
    getCalendars: () => ["Dolmenwood"],
  };

  it("accepts a start written in the calendar's own (year-first) parse order", () => {
    stubCalendarium(yearFirst);
    expect(startDateError("Dolmenwood", "1089-Grimvold-28")).toBeUndefined();
    expect(startDateError("Dolmenwood", "1089-Grimvold-15")).toBeUndefined();
    expect(startDateError("Dolmenwood", "1089-1-28")).toBeUndefined(); // numeric month in range
  });

  it("errors on a day-first start that transposes day and year into the wrong slots", () => {
    stubCalendarium(yearFirst);
    // "28-Grimvold-1089" parsed year-first → year 28, day 1089 (Grimvold has only 28 days).
    const error = startDateError("Dolmenwood", "28-Grimvold-1089");
    expect(error).toContain("28-Grimvold-1089"); // the offending value
    expect(error).toContain("Dolmenwood");
    expect(error).toContain("day 1089"); // where the value actually landed
    expect(error).toContain("year 28");
    expect(error).toContain("year-month-day"); // hint uses the real parse order, not the display order
    expect(error).toContain("1089-Grimvold-15"); // round-trip-safe example from the current date
  });

  it("errors when the month name isn't a real month (Calendarium would silently default it to 0)", () => {
    stubCalendarium(yearFirst);
    const error = startDateError("Dolmenwood", "1089-AAAGrimvold-28");
    expect(error).toContain("1089-AAAGrimvold-28");
    expect(error).toContain("year-month-day");
  });

  it("returns undefined without a calendar, without a start, or when the parser is absent", () => {
    stubCalendarium(yearFirst);
    expect(startDateError(undefined, "28-Grimvold-1089")).toBeUndefined();
    expect(startDateError("Dolmenwood", undefined)).toBeUndefined();
    stubCalendarium(undefined);
    expect(startDateError("Dolmenwood", "28-Grimvold-1089")).toBeUndefined();
    // getAPI present but no parseDate (older Calendarium) → can't validate, so don't block.
    stubCalendarium({ getAPI: () => ({ getObject: () => ({ static: { months: MONTHS } }) }) });
    expect(startDateError("Dolmenwood", "28-Grimvold-1089")).toBeUndefined();
  });
});

describe("currentDateAsStart", () => {
  const MONTHS = DOLMENWOOD_MONTHS;

  it("serializes the current date in the calendar's own parse order, using the month name", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({ static: { months: MONTHS } }),
        getStore: () => ({}),
        getCurrentDate: () => ({ day: 14, month: 0, year: 1089 }),
        parseDate: yearFirstParse(MONTHS),
      }),
    });

    expect(currentDateAsStart("Dolmenwood")).toBe("1089-Grimvold-14");
  });

  it("returns undefined when Calendarium is unavailable", () => {
    stubCalendarium(undefined);
    expect(currentDateAsStart("Dolmenwood")).toBeUndefined();
  });

  it("returns undefined when no order round-trips (never writes an unreadable start)", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({ static: { months: MONTHS } }),
        getStore: () => ({}),
        getCurrentDate: () => ({ day: 14, month: 0, year: 1089 }),
        parseDate: () => null, // nothing parses → no order discoverable
      }),
    });

    expect(currentDateAsStart("Dolmenwood")).toBeUndefined();
  });
});

describe("setCalendariumCurrentDate", () => {
  it("sets Calendarium's current date to the tracker's current day when a start is set", () => {
    let saved: unknown;
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({ static: { months: [{ length: 28 }, { length: 28 }] } }),
        getStore: () => ({
          getOffsetDate: (_base: unknown, offset: number) => ({ day: offset, month: 1, year: 602 }),
          setCurrentDate: (d: unknown) => {
            saved = d;
          },
        }),
        getCurrentDate: () => ({ day: 1, month: 0, year: 591 }),
        toDisplayDate: displayDate,
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
        getObject: () => ({ static: { months: [{ length: 28 }] } }),
        getStore: () => ({
          setCurrentDate: () => {
            called = true;
          },
        }),
        getCurrentDate: () => ({ day: 1, month: 0, year: 591 }),
        toDisplayDate: displayDate,
      }),
    });

    setCalendariumCurrentDate({ calendar: "Greyhawk", position: 288, markers: [] });
    expect(called).toBe(false);
  });
});

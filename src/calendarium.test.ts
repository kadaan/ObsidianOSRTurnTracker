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
  // A tiny day-month-year calendar: parse assigns segments positionally (like Calendarium's
  // formatDigest), coercing non-numeric day/year to 1 and wrapping the month — so a wrong-order
  // value parses into a valid-but-different date. Format is the inverse: `<day>-<MonthName>-<year>`.
  const MONTHS = ["Grimvold", "Lymewald"];
  const dmyCalendar = {
    getAPI: () => ({
      getObject: () => ({ name: "Dolmenwood", dateFormat: "D-MMMM-Y", static: { months: MONTHS.map((name) => ({ name })) } }),
      getStore: () => ({}),
      getCurrentDate: () => ({ day: 15, month: 0, year: 1089 }),
      parseDate: (s: string) => {
        const [d, m, y] = s.split("-");
        const num = (x: string | undefined, fallback: number) => (/^\d+$/.test(x ?? "") ? Number(x) : fallback);
        const monthIdx = /^\d+$/.test(m ?? "")
          ? Number(m) - 1
          : MONTHS.findIndex((n) => n.toLowerCase() === (m ?? "").toLowerCase());
        return { day: num(d, 1), month: ((monthIdx % MONTHS.length) + MONTHS.length) % MONTHS.length, year: num(y, 1) };
      },
      toDisplayDate: (dte: { day: number; month: number; year: number }) => `${dte.day}-${MONTHS[dte.month]}-${dte.year}`,
    }),
    getCalendars: () => ["Dolmenwood"],
  };

  it("returns undefined when each segment fits its slot (correct order, padding/number aside)", () => {
    stubCalendarium(dmyCalendar);
    expect(startDateError("Dolmenwood", "2-Grimvold-1089")).toBeUndefined();
    expect(startDateError("Dolmenwood", "02-Grimvold-1089")).toBeUndefined();
    expect(startDateError("Dolmenwood", "2-1-1089")).toBeUndefined(); // numeric month in range
  });

  it("errors when a name lands in a numeric slot (wrong segment order)", () => {
    stubCalendarium(dmyCalendar);
    const error = startDateError("Dolmenwood", "Grimvold-1089-2");
    expect(error).toContain("Grimvold-1089-2"); // the offending value
    expect(error).toContain("Dolmenwood");
    expect(error).toContain("day-month-year"); // order derived from dateFormat
    expect(error).toContain("15-Grimvold-1089"); // example from the current date
  });

  it("errors when the month name isn't a real month (Calendarium would silently default it)", () => {
    stubCalendarium(dmyCalendar);
    const error = startDateError("Dolmenwood", "2-AAAGrimvold-1089");
    expect(error).toContain("2-AAAGrimvold-1089");
    expect(error).toContain("day-month-year");
  });

  it("returns undefined without a calendar, without a start, or when Calendarium is absent", () => {
    stubCalendarium(dmyCalendar);
    expect(startDateError(undefined, "Grimvold-1089-2")).toBeUndefined();
    expect(startDateError("Dolmenwood", undefined)).toBeUndefined();
    stubCalendarium(undefined);
    expect(startDateError("Dolmenwood", "Grimvold-1089-2")).toBeUndefined();
  });
});

describe("currentDateAsStart", () => {
  it("serializes Calendarium's current date to a start string that parses back to it", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({ static: { months: [] } }),
        getStore: () => ({}),
        getCurrentDate: () => ({ day: 14, month: 0, year: 1089 }),
        // Default format is unparseable here; the "Y-M-D" candidate is the one that round-trips.
        toDisplayDate: (d: { day: number; month: number; year: number }, _e: unknown, fmt?: string) =>
          fmt === "Y-M-D" ? `${d.year}-${d.month + 1}-${d.day}` : "the 14th of Grimvold",
        parseDate: (s: string) => {
          const [y, m, day] = s.split("-").map(Number);
          return { day, month: m - 1, year: y };
        },
      }),
    });

    expect(currentDateAsStart("Dolmenwood")).toBe("1089-1-14");
  });

  it("returns undefined when Calendarium is unavailable", () => {
    stubCalendarium(undefined);
    expect(currentDateAsStart("Dolmenwood")).toBeUndefined();
  });

  it("returns undefined when no format round-trips (never writes an unreadable start)", () => {
    stubCalendarium({
      getAPI: () => ({
        getObject: () => ({ static: { months: [] } }),
        getStore: () => ({}),
        getCurrentDate: () => ({ day: 14, month: 0, year: 1089 }),
        toDisplayDate: () => "not a parseable date",
        parseDate: () => null,
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

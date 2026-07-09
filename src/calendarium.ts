import { dayOf, nonEmptyString, TrackerState, wrap } from "./model";
import { parseStart } from "./dates";

type NamedEntry = string | { name: string };
const nameOf = (entry: NamedEntry): string => (typeof entry === "string" ? entry : entry.name);

/** A month as Calendarium exposes it; its length feeds the day-length fallback, its name the hints. */
interface MonthEntry {
  name?: string;
  length?: number;
}

/** A date in a calendar's own units; `month` is 0-indexed. */
interface CalDate {
  day: number;
  month: number;
  year: number;
}

/** A Svelte-style readable store. Reading it synchronously (as Svelte's own `get` does) is just
 *  subscribe → capture the value it emits immediately → unsubscribe, so we need no Svelte import. */
interface Readable<T> {
  subscribe(run: (value: T) => void): () => void;
}
function readStore<T>(store: Readable<T>): T {
  let value!: T;
  store.subscribe((v) => (value = v))();
  return value;
}

/** One slot in Calendarium's month layout: a regular day (name null) or a named leap/feast day. */
interface DayEntry {
  number: number;
  name: string | null;
}

/** Calendarium's per-month store: weekday names, the weekday its day 1 lands on, and the laid-out
 *  weeks (each a row of day slots) from which leap/feast days carry their own name. */
interface MonthStore {
  weekdays: Readable<NamedEntry[]>;
  firstDay: Readable<number>;
  /** Weeks of day slots (nulls pad the first/last week); absent on older builds. */
  daysAsWeeks?: Readable<(DayEntry | null)[][]>;
}

/** The subset of Calendarium's per-calendar API this plugin relies on (soft dependency). */
interface CalendarApi {
  getObject(): { name: string; dateFormat?: string; static: { months: MonthEntry[] } };
  getStore(): {
    /** Add `offset` days to `date` via the calendar's own increment logic (leap/intercalary aware). */
    getOffsetDate?(date: CalDate, offset: number): CalDate;
    /** Set (and persist) the calendar's current date; absent on older builds. */
    setCurrentDate?(date: CalDate): void;
    /** Per-month store used to derive the weekday exactly as Calendarium does; absent on older builds. */
    getMonthStoreForDate?(date: CalDate): MonthStore;
  };
  getCurrentDate(): CalDate;
  /** Parse a dash-segmented date string in the calendar's own format order; absent on older builds. */
  parseDate?(dateString: string): CalDate | null;
  /** Format a date in the calendar's own configured style (weekday not included by Calendarium). */
  toDisplayDate(date: CalDate, end?: CalDate | null, dateFormat?: string): string;
}

interface CalendariumApi {
  /** With no name, returns the default calendar's API. */
  getAPI(name?: string): CalendarApi;
  /** Names of every calendar Calendarium knows; absent on older builds. */
  getCalendars?(): string[];
}

/** Calendarium's global API object, if the plugin is loaded. The one place we reach into `window`. */
const getCalendarium = (): CalendariumApi | undefined =>
  (window as unknown as { Calendarium?: CalendariumApi }).Calendarium;

/** The per-calendar API for `name` (or the default calendar), guarded; undefined if Calendarium is
 *  absent or the lookup throws. Callers do the rest inside their own try for the per-call work. */
function getCalendarApi(name?: string): CalendarApi | undefined {
  const calendarium = getCalendarium();
  if (!calendarium?.getAPI) return undefined;
  try {
    return calendarium.getAPI(name);
  } catch {
    return undefined;
  }
}

const isCalDate = (d: unknown): d is CalDate => {
  const c = d as CalDate | null;
  return !!c && Number.isFinite(c.day) && Number.isFinite(c.month) && Number.isFinite(c.year);
};

/**
 * Fallback advance for older Calendarium builds without `getOffsetDate`: rolls by plain month
 * lengths, so it ignores leap-day adjustments. `getOffsetDate` is preferred when present.
 */
function addDays(date: CalDate, days: number, months: MonthEntry[]): CalDate {
  let { day, month, year } = date;
  day += days;
  for (;;) {
    const length = months[month]?.length;
    if (typeof length !== "number" || day <= length) break;
    day -= length;
    month += 1;
    if (month >= months.length) {
      month = 0;
      year += 1;
    }
  }
  return { day, month, year };
}

/**
 * The calendar date encoded by `start`: a dash-segmented string handed to Calendarium's own parser
 * (read in the calendar's configured format order), else an ISO string (day/month/year taken as
 * calendar units). Undefined when `start` is absent or unparseable — the caller decides the default.
 */
function parseStartDate(api: CalendarApi, start: string | undefined): CalDate | undefined {
  if (!start) return undefined;
  if (start.includes("-") && api.parseDate) {
    const parsed = api.parseDate(start.split("T")[0].trim());
    if (isCalDate(parsed)) return parsed;
  }
  const iso = parseStart(start);
  if (iso) return { day: iso.getDate(), month: iso.getMonth(), year: iso.getFullYear() };
  return undefined;
}

/** The tracker's day-0 base: the `start` date, or the calendar's current date when there's no start. */
function resolveBase(api: CalendarApi, start: string | undefined): CalDate {
  return parseStartDate(api, start) ?? api.getCurrentDate();
}

/** The calendar date `dayIndex` days after `base`, using the calendar's own arithmetic when available. */
function dateForDay(
  store: ReturnType<CalendarApi["getStore"]>,
  base: CalDate,
  dayIndex: number,
  months: MonthEntry[],
): CalDate {
  return store.getOffsetDate ? store.getOffsetDate(base, dayIndex) : addDays(base, dayIndex, months);
}

/** A month's weekday names, the weekday its day 1 lands on, and the name of each leap/feast day keyed
 *  by its day number (so a named day is labelled by its feast name instead of a computed weekday). */
interface MonthWeek {
  weekdays: NamedEntry[];
  firstDay: number;
  leapNames: Map<number, string>;
}

/**
 * The weekday layout of `date`'s month, from Calendarium's own per-month store so it matches
 * Calendarium exactly. The store's `firstDay` (weekday of the month's day 1) already accounts for
 * overflow, offset, leap and intercalary days — which a naive "total days before % weekday count"
 * gets wrong. Leap/feast day names are read from Calendarium's own laid-out weeks (so we label a day
 * exactly as Calendarium does, including its handling of stacked feasts). Undefined on older
 * Calendarium builds that don't expose the month store.
 */
function monthWeek(store: ReturnType<CalendarApi["getStore"]>, date: CalDate): MonthWeek | undefined {
  if (!store.getMonthStoreForDate) return undefined;
  const month = store.getMonthStoreForDate(date);
  const weekdays = readStore(month.weekdays);
  if (!weekdays?.length) return undefined;

  const leapNames = new Map<number, string>();
  if (month.daysAsWeeks) {
    for (const week of readStore(month.daysAsWeeks)) {
      for (const slot of week) {
        if (!slot) continue;
        const name = nonEmptyString(slot.name);
        if (name) leapNames.set(slot.number, name);
      }
    }
  }
  return { weekdays, firstDay: readStore(month.firstDay), leapNames };
}

/** Whether the Calendarium plugin is present and exposing its global API. */
export const isCalendariumAvailable = (): boolean => !!getCalendarium()?.getAPI;

/** Names of every calendar Calendarium knows, for autocomplete. Empty when Calendarium is absent. */
export function calendarNames(): string[] {
  const calendarium = getCalendarium();
  try {
    return calendarium?.getCalendars?.() ?? [];
  } catch {
    return [];
  }
}

/**
 * The name of Calendarium's default calendar (its global setting), for seeding a new tracker when no
 * calendar property is set on the note. Undefined when Calendarium is absent or has no default.
 * Note: Calendarium's default is global — it exposes no path-based per-note calendar to honor here.
 */
export function defaultCalendarName(): string | undefined {
  try {
    return nonEmptyString(getCalendarApi()?.getObject().name); // no name → the default calendar
  } catch {
    return undefined;
  }
}

/**
 * An error message when `calendar` names a calendar Calendarium doesn't have — so a typo'd name
 * fails loudly instead of silently degrading to Day-N. Undefined when the name is valid, unset, or
 * unverifiable (Calendarium not installed, or too old to list calendars — the tracker still works
 * without it, so we don't error in those cases).
 */
export function calendarError(calendar: string | undefined): string | undefined {
  if (!calendar) return undefined;
  const calendarium = getCalendarium();
  if (!calendarium?.getAPI || !calendarium.getCalendars) return undefined;
  const known = calendarium.getCalendars();
  if (!Array.isArray(known) || known.includes(calendar)) return undefined;
  const list = known.length ? known.join(", ") : "none";
  return `Unknown Calendarium calendar "${calendar}". Available: ${list}.`;
}

const sameDate = (a: CalDate, b: CalDate): boolean =>
  a.day === b.day && a.month === b.month && a.year === b.year;

const monthName = (months: MonthEntry[], index: number): string =>
  nonEmptyString(months[index]?.name) ?? String(index + 1);

// Calendarium's parser always reads a date year-first: `year-monthName-day` (or `year-numMonth-day`),
// regardless of the calendar's *display* format. So we always write starts in that one order.
const START_FORMAT_HINT = "year-month-day";

/** Serialize a date as `year-monthName-day` — Calendarium's parse order — using the month *name* so
 *  the month slot is unambiguous (a name can't be mistaken for a numeric day/year). */
const serializeStart = (date: CalDate, months: MonthEntry[]): string =>
  `${date.year}-${monthName(months, date.month)}-${date.day}`;

/** Whether a parsed date sits within the calendar's bounds: a real month, and a day within that
 *  month's length (when known). Catches a transposed start whose day/year landed in the wrong slot
 *  (e.g. day 1089 in a 28-day month) — which parses "successfully" but is nonsense. */
function dateInRange(date: CalDate, months: MonthEntry[]): boolean {
  if (date.month < 0 || date.month >= months.length || date.day < 1) return false;
  const length = months[date.month]?.length;
  return typeof length !== "number" || date.day <= length;
}

/** Whether `start` has a non-numeric segment that doesn't name a real month — a bad month name that
 *  Calendarium would silently coerce (to month 0), so `dateInRange` alone wouldn't catch it. */
function hasUnknownMonthSegment(start: string, months: MonthEntry[]): boolean {
  const names = months.map((m) => nonEmptyString(m.name)?.toLowerCase()).filter(Boolean) as string[];
  return start
    .split(/[-–—]/)
    .map((s) => s.trim())
    .some((s) => !/^\d+$/.test(s) && !names.some((name) => name.startsWith(s.toLowerCase())));
}

/**
 * An error message when `start` is set but doesn't parse to a real date for `calendar` — either it's
 * unparseable, or (the subtle case) it was written in the wrong order (e.g. day-first) so that
 * Calendarium's year-first parser lands day/year in the wrong slots and reads a nonsense date like
 * day 1089. We validate the parsed result's ranges rather than the raw segments, since a wrong order
 * still "parses." Undefined when there's no calendar/start, the parser is unavailable, or it's valid.
 */
export function startDateError(
  calendar: string | undefined,
  start: string | undefined,
): string | undefined {
  if (!calendar || !start) return undefined;
  const api = getCalendarApi(calendar);
  if (!api?.parseDate) return undefined; // can't validate without the parser → don't block

  try {
    const months = api.getObject().static.months;
    const parsed = parseStartDate(api, start);
    const badMonth = !!parsed && hasUnknownMonthSegment(start, months);
    if (parsed && !badMonth && dateInRange(parsed, months)) return undefined;

    // A bad month name means the segments themselves are wrong, so "reads as" would just repeat the
    // silent default — only report the parsed reading when the month resolved but the date is out of range.
    const readsAs =
      parsed && !badMonth
        ? ` — it reads as day ${parsed.day} of ${monthName(months, parsed.month)}, year ${parsed.year}`
        : "";
    const example = serializeStart(api.getCurrentDate(), months);
    return (
      `Start date "${start}" isn't a valid date for calendar "${calendar}"${readsAs}.` +
      ` Expected ${START_FORMAT_HINT} (e.g. ${example}).`
    );
  } catch {
    return undefined;
  }
}

/**
 * A `start` string seeded from Calendarium's current date for `calendar`, so a freshly-inserted
 * tracker is anchored to "today" and day-sync works without the user typing a date. Written in
 * Calendarium's year-first parse order (with the month name), then confirmed to parse back to the
 * same date, so we never write a `start` the fantasy header can't read. Undefined when Calendarium
 * is unavailable or the round-trip fails.
 */
export function currentDateAsStart(calendar: string): string | undefined {
  const api = getCalendarApi(calendar);
  if (!api?.parseDate) return undefined;

  try {
    const current = api.getCurrentDate();
    const months = api.getObject().static.months;
    const start = serializeStart(current, months);
    const parsed = parseStartDate(api, start);
    if (parsed && sameDate(parsed, current)) return start;
  } catch {
    /* fall through: leave start unset */
  }
  return undefined;
}

/**
 * Build a fantasy day-header formatter from Calendarium when `state.calendar` is set and the
 * plugin is available; otherwise call `onWarn` and return undefined so the grid falls back to
 * real-date / Day-N. Days advance via Calendarium's own date arithmetic (leap/intercalary aware),
 * falling back to plain month lengths on older builds. The date is formatted by Calendarium's own
 * `toDisplayDate` (which honors the calendar's configured format but has no weekday token), and a
 * label is prefixed from Calendarium's per-month store — a leap/feast day's own name when Calendarium
 * gives it one, otherwise the weekday — so it matches Calendarium.
 * Never throws: a formatting failure at render degrades to "Day N".
 */
export function makeFantasyDayHeader(
  state: TrackerState,
  onWarn: () => void,
): ((dayIndex: number) => string) | undefined {
  if (!state.calendar) return undefined;

  const api = getCalendarApi(state.calendar);
  if (!api) {
    onWarn();
    return undefined;
  }

  try {
    const { months } = api.getObject().static;
    const store = api.getStore();
    const base = resolveBase(api, state.start);

    // The grid renders every day sequentially, so the month layout repeats ~30× per month; cache it
    // per year-month to avoid re-fetching Calendarium's month store for each day.
    const monthCache = new Map<string, MonthWeek | undefined>();
    // The day's label prefix: a leap/feast day's own name when Calendarium gives it one, otherwise
    // the computed weekday. `firstDay` (day 1's weekday) + offset lands normal days on the right day.
    const labelFor = (cd: CalDate): string | undefined => {
      const key = `${cd.year}-${cd.month}`;
      if (!monthCache.has(key)) monthCache.set(key, monthWeek(store, cd));
      const info = monthCache.get(key);
      if (!info) return undefined;
      return (
        info.leapNames.get(cd.day) ??
        nameOf(info.weekdays[wrap(info.firstDay + (cd.day - 1), info.weekdays.length)])
      );
    };

    return (dayIndex) => {
      try {
        const cd = dateForDay(store, base, dayIndex, months);
        // No format override: let Calendarium render the date in the user's own calendar format, so
        // the header matches Calendarium everywhere. The `dateFormat` argument is honored only on
        // newer builds, so passing one would make the header order depend on the installed version.
        const date = api.toDisplayDate(cd, null);
        let label: string | undefined;
        try {
          label = labelFor(cd);
        } catch {
          /* label is best-effort; a failure there still leaves the date */
        }
        return label ? `${label}, ${date}` : date;
      } catch {
        return `Day ${dayIndex + 1}`;
      }
    };
  } catch {
    onWarn();
    return undefined;
  }
}

/**
 * Push the tracker's current in-game day into Calendarium's "current date". No-op unless the tracker
 * has a `calendar` and an explicit `start` — without a start the fantasy base *is* Calendarium's
 * current date, so writing it back would drift the tracker's own headers. Best-effort: never throws.
 */
export function setCalendariumCurrentDate(state: TrackerState): void {
  if (!state.calendar || !state.start) return;

  const api = getCalendarApi(state.calendar);
  if (!api) return;

  try {
    const store = api.getStore();
    const base = parseStartDate(api, state.start);
    if (!store.setCurrentDate || !base) return; // no setter / no stable anchor → leave Calendarium alone
    const { months } = api.getObject().static;
    store.setCurrentDate(dateForDay(store, base, dayOf(state.position), months));
  } catch {
    /* best-effort: leave Calendarium's date untouched on any failure */
  }
}

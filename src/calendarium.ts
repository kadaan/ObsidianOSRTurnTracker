import { dayOf, TrackerState, wrap } from "./model";
import { parseStart } from "./dates";

type NamedEntry = string | { name: string };
const nameOf = (entry: NamedEntry): string => (typeof entry === "string" ? entry : entry.name);

/** A month as Calendarium exposes it; only its length matters for the day-length fallback. */
interface MonthEntry {
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

/** Calendarium's per-month store: this month's weekday names and the weekday index its day 1 lands on. */
interface MonthStore {
  weekdays: Readable<NamedEntry[]>;
  firstDay: Readable<number>;
}

/** The subset of Calendarium's per-calendar API this plugin relies on (soft dependency). */
interface CalendarApi {
  getObject(): { static: { months: MonthEntry[] } };
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
  getAPI(name: string): CalendarApi;
  /** Names of every calendar Calendarium knows; absent on older builds. */
  getCalendars?(): string[];
}

/** Calendarium's global API object, if the plugin is loaded. The one place we reach into `window`. */
const getCalendarium = (): CalendariumApi | undefined =>
  (window as unknown as { Calendarium?: CalendariumApi }).Calendarium;

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

/** A month's weekday names and the weekday index its day 1 lands on. */
interface MonthWeek {
  weekdays: NamedEntry[];
  firstDay: number;
}

/**
 * The weekday layout of `date`'s month, from Calendarium's own per-month store so it matches
 * Calendarium exactly. The store's `firstDay` (weekday of the month's day 1) already accounts for
 * overflow, offset, leap and intercalary days — which a naive "total days before % weekday count"
 * gets wrong. Undefined on older Calendarium builds that don't expose the month store.
 */
function monthWeek(store: ReturnType<CalendarApi["getStore"]>, date: CalDate): MonthWeek | undefined {
  if (!store.getMonthStoreForDate) return undefined;
  const month = store.getMonthStoreForDate(date);
  const weekdays = readStore(month.weekdays);
  if (!weekdays?.length) return undefined;
  return { weekdays, firstDay: readStore(month.firstDay) };
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

// Formats to try when serializing the current date to a `start`: the calendar's own default first
// (usually the nicest), then explicit dash orders as fallbacks.
const START_FORMAT_CANDIDATES: (string | undefined)[] = [undefined, "Y-M-D", "D-M-Y", "M-D-Y"];

/**
 * A `start` string seeded from Calendarium's current date for `calendar`, so a freshly-inserted
 * tracker is anchored to "today" and day-sync works without the user typing a date. Undefined when
 * Calendarium is unavailable. Each candidate format is kept only if it parses back to the same date,
 * so we never write a `start` the fantasy header can't read.
 */
export function currentDateAsStart(calendar: string): string | undefined {
  const calendarium = getCalendarium();
  if (!calendarium?.getAPI) return undefined;

  try {
    const api = calendarium.getAPI(calendar);
    const current = api.getCurrentDate();
    for (const format of START_FORMAT_CANDIDATES) {
      const start = api.toDisplayDate(current, null, format);
      const parsed = parseStartDate(api, start);
      if (parsed && parsed.day === current.day && parsed.month === current.month && parsed.year === current.year) {
        return start;
      }
    }
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
 * `toDisplayDate` (which honors the calendar's configured format but has no weekday token), and the
 * weekday is prefixed from Calendarium's per-month store (`weekdayName`) so it matches Calendarium.
 * Never throws: a formatting failure at render degrades to "Day N".
 */
export function makeFantasyDayHeader(
  state: TrackerState,
  onWarn: () => void,
): ((dayIndex: number) => string) | undefined {
  if (!state.calendar) return undefined;

  const calendarium = getCalendarium();
  if (!calendarium?.getAPI) {
    onWarn();
    return undefined;
  }

  try {
    const api = calendarium.getAPI(state.calendar);
    const { months } = api.getObject().static;
    const store = api.getStore();
    const base = resolveBase(api, state.start);

    // The grid renders every day sequentially, so the month layout repeats ~30× per month; cache it
    // per year-month to avoid re-fetching Calendarium's month store for each day.
    const monthCache = new Map<string, MonthWeek | undefined>();
    const weekdayFor = (cd: CalDate): string | undefined => {
      const key = `${cd.year}-${cd.month}`;
      if (!monthCache.has(key)) monthCache.set(key, monthWeek(store, cd));
      const info = monthCache.get(key);
      return info && nameOf(info.weekdays[wrap(info.firstDay + (cd.day - 1), info.weekdays.length)]);
    };

    return (dayIndex) => {
      try {
        const cd = dateForDay(store, base, dayIndex, months);
        // Explicit day/month-name/year format; toDisplayDate's default is a bare numeric
        // "year-month-day" (e.g. "600-14-21"). Tokens: D = day, MMMM = full month name, Y = full year.
        const date = api.toDisplayDate(cd, null, "D MMMM Y");
        let weekday: string | undefined;
        try {
          weekday = weekdayFor(cd);
        } catch {
          /* weekday is best-effort; a failure there still leaves the date */
        }
        return weekday ? `${weekday}, ${date}` : date;
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

  const calendarium = getCalendarium();
  if (!calendarium?.getAPI) return;

  try {
    const api = calendarium.getAPI(state.calendar);
    const store = api.getStore();
    const base = parseStartDate(api, state.start);
    if (!store.setCurrentDate || !base) return; // no setter / no stable anchor → leave Calendarium alone
    const { months } = api.getObject().static;
    store.setCurrentDate(dateForDay(store, base, dayOf(state.position), months));
  } catch {
    /* best-effort: leave Calendarium's date untouched on any failure */
  }
}

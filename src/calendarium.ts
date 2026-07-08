import { dayOf, TrackerState } from "./model";
import { parseStart } from "./dates";

type NamedEntry = string | { name: string };

/** A month as Calendarium exposes it: a name and its length in days. */
type MonthEntry = NamedEntry & { length?: number };

/** A date in a calendar's own units; `month` is 0-indexed. */
interface CalDate {
  day: number;
  month: number;
  year: number;
}

/** The subset of Calendarium's per-calendar API this plugin relies on (soft dependency). */
interface CalendarApi {
  getObject(): { static: { firstWeekDay: number; weekdays: NamedEntry[]; months: MonthEntry[] } };
  getStore(): {
    getDaysBeforeDate(date: CalDate): number;
    /** Add `offset` days to `date` via the calendar's own increment logic (leap/intercalary aware). */
    getOffsetDate?(date: CalDate, offset: number): CalDate;
    /** Set (and persist) the calendar's current date; absent on older builds. */
    setCurrentDate?(date: CalDate): void;
  };
  getCurrentDate(): CalDate;
  /** Parse a dash-segmented date string in the calendar's own format order; absent on older builds. */
  parseDate?(dateString: string): CalDate | null;
}

interface CalendariumApi {
  getAPI(name: string): CalendarApi;
}

const nameOf = (entry: NamedEntry): string => (typeof entry === "string" ? entry : entry.name);

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

/** Whether the Calendarium plugin is present and exposing its global API. */
export const isCalendariumAvailable = (): boolean =>
  !!(window as unknown as { Calendarium?: { getAPI?: unknown } }).Calendarium?.getAPI;

/**
 * Build a fantasy day-header formatter from Calendarium when `state.calendar` is set and the
 * plugin is available; otherwise call `onWarn` and return undefined so the grid falls back to
 * real-date / Day-N. Days advance via Calendarium's own date arithmetic (leap/intercalary aware),
 * falling back to plain month lengths on older builds. Never throws: a formatting failure at
 * render degrades to "Day N".
 */
export function makeFantasyDayHeader(
  state: TrackerState,
  onWarn: () => void,
): ((dayIndex: number) => string) | undefined {
  if (!state.calendar) return undefined;

  const calendarium = (window as unknown as { Calendarium?: CalendariumApi }).Calendarium;
  if (!calendarium?.getAPI) {
    onWarn();
    return undefined;
  }

  try {
    const api = calendarium.getAPI(state.calendar);
    const { firstWeekDay, weekdays, months } = api.getObject().static;
    const store = api.getStore();
    const base = resolveBase(api, state.start);

    return (dayIndex) => {
      try {
        const cd = dateForDay(store, base, dayIndex, months);
        const weekday = nameOf(weekdays[(firstWeekDay + store.getDaysBeforeDate(cd)) % weekdays.length]);
        return `${weekday}, ${cd.day} ${nameOf(months[cd.month])} ${cd.year}`;
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

  const calendarium = (window as unknown as { Calendarium?: CalendariumApi }).Calendarium;
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

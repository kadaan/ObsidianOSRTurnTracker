import { TrackerState } from "./model";
import { parseStart } from "./dates";

type NamedEntry = string | { name: string };

/** Minimal shape of the Calendarium public API this plugin relies on (soft dependency). */
interface CalendariumApi {
  getAPI(name: string): {
    getObject(): {
      static: { firstWeekDay: number; weekdays: NamedEntry[]; months: NamedEntry[] };
    };
    getStore(): { getDaysBeforeDate(date: unknown): number };
    getCurrentDate(): { day: number; month: number; year: number };
    getDate(day: number, month: number, year: number): { day: number; month: number; year: number };
  };
}

const nameOf = (entry: NamedEntry): string => (typeof entry === "string" ? entry : entry.name);

/**
 * Build a fantasy day-header formatter from Calendarium when `state.calendar` is set and the
 * plugin is available; otherwise call `onWarn` and return undefined so the grid falls back to
 * real-date / Day-N. Never throws: a formatting failure at render degrades to "Day N".
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
    const current = api.getCurrentDate();
    const base = parseStart(state.start) ?? new Date(current.year, current.month, current.day);

    return (dayIndex) => {
      try {
        const d = new Date(base);
        d.setDate(d.getDate() + dayIndex);
        const cd = api.getDate(d.getDate(), d.getMonth(), d.getFullYear());
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

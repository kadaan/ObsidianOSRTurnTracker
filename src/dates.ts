import { TrackerState } from "./model";

/** English ordinal suffix: 1→"st", 2→"nd", 3→"rd", 11→"th"… */
function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return suffix[(v - 20) % 10] || suffix[v] || suffix[0];
}

/**
 * Format a real-world date `dayIndex` days after `start`, e.g. "Saturday 21st May 2016".
 * `locale` defaults to the runtime locale; tests pass an explicit one for determinism.
 */
export function formatRealDate(start: Date, dayIndex: number, locale?: string): string {
  const d = new Date(start);
  d.setDate(d.getDate() + dayIndex);
  const weekday = d.toLocaleDateString(locale, { weekday: "long" });
  const month = d.toLocaleDateString(locale, { month: "long" });
  return `${weekday} ${d.getDate()}${ordinal(d.getDate())} ${month} ${d.getFullYear()}`;
}

/** Parse `start` into a valid Date, or null when absent/unparseable. */
export function parseStart(start: string | undefined): Date | null {
  if (!start) return null;
  const d = new Date(start);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Build a day-header formatter for a tracker: real dates when `start` is a valid
 * datetime, otherwise "Day N". (Fantasy-calendar headers are injected separately.)
 */
export function makeDayHeader(state: TrackerState): (dayIndex: number) => string {
  const start = parseStart(state.start);
  if (start) return (dayIndex) => formatRealDate(start, dayIndex);
  return (dayIndex) => `Day ${dayIndex + 1}`;
}

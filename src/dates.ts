import { MINUTES_PER_TURN, TrackerState, TURNS_PER_DAY, TURNS_PER_HOUR } from "./model";

const pad = (n: number) => String(n).padStart(2, "0");

/** Clock time (e.g. "02:20") for a number of turns into a day. */
export function formatClock(turnsIntoDay: number): string {
  return `${pad(Math.floor(turnsIntoDay / TURNS_PER_HOUR))}:${pad((turnsIntoDay % TURNS_PER_HOUR) * MINUTES_PER_TURN)}`;
}

/**
 * Format a marker's [startsAt, expiresAt] span as clock times, prefixing each with its
 * `dayLabel` only when the span crosses a day boundary (days shown only if needed).
 */
export function formatSpan(
  startsAt: number,
  expiresAt: number,
  dayLabel: (dayIndex: number) => string,
): string {
  const dayOf = (turn: number) => Math.floor(turn / TURNS_PER_DAY);
  const clockOf = (turn: number) => formatClock(((turn % TURNS_PER_DAY) + TURNS_PER_DAY) % TURNS_PER_DAY);
  const crossesDays = dayOf(startsAt) !== dayOf(expiresAt);
  const at = (turn: number) => (crossesDays ? `${dayLabel(dayOf(turn))} ${clockOf(turn)}` : clockOf(turn));
  return `${at(startsAt)} → ${at(expiresAt)}`;
}

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

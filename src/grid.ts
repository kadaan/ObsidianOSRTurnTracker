import {
  TrackerState,
  TURNS_PER_HOUR,
  HOURS_PER_DAY,
  TURNS_PER_DAY,
  LOOKAHEAD_BUFFER,
  MAX_POSITION,
  dayOf,
} from "./model";
import { makeDayHeader, formatClock } from "./dates";
import { resolveMarker, inSegments } from "./markers";

export interface GridOptions {
  lookaheadBuffer?: number;
  /** Override the day-header text (e.g. a fantasy calendar); defaults to real-date / Day-N. */
  dayHeader?: (dayIndex: number) => string;
}

export type BoxStatus = "past" | "current" | "future";

export interface Box {
  /** Absolute turn index this box represents. */
  turn: number;
  /** past = elapsed; current = the "you are here" next turn; future = not yet reached. */
  status: BoxStatus;
  /** How many (non-pending) markers begin on this turn. */
  startingCount: number;
  /** How many (non-pending) markers have their last active turn here (expiresAt - 1). */
  endingCount: number;
  /** True when a (non-pending) marker's span [startsAt, expiresAt) covers this turn. */
  spanned: boolean;
}

export interface HourRow {
  /** Display label, e.g. "08:00". */
  label: string;
  boxes: Box[];
}

export interface DayBlock {
  header: string;
  hours: HourRow[];
  /** Current in-game time (e.g. "02:20"), present only on the in-progress day. */
  currentTime?: string;
  /** True when every turn of the day has elapsed (fully in the past). */
  complete: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Compute the render model (day blocks → hour rows → boxes) from tracker state. */
export function computeGrid(state: TrackerState, options: GridOptions = {}): DayBlock[] {
  const buffer = options.lookaheadBuffer ?? LOOKAHEAD_BUFFER;
  const dayHeader = options.dayHeader ?? makeDayHeader(state);

  const days: DayBlock[] = [];

  // Resolve every marker's burn state (honouring pauses); pending markers (startsAt in the
  // future, only reachable by rewinding) are excluded. Each active burn segment paints a span;
  // a paused marker's span stops at the pause and contributes no ending marker.
  const resolved = [...state.lights, ...state.effects]
    .map((m) => resolveMarker(m, state.position))
    .filter((r) => r.phase !== "upcoming");
  const segments = resolved.flatMap((r) => r.segments);

  const startsOn = new Map<number, number>();
  const endsOn = new Map<number, number>();
  for (const r of resolved) {
    for (const [from] of r.segments) startsOn.set(from, (startsOn.get(from) ?? 0) + 1);
    if (r.phase !== "paused") endsOn.set(r.expiresAt - 1, (endsOn.get(r.expiresAt - 1) ?? 0) + 1);
  }

  // Render whole days through the furthest of (position, any active-segment end) + buffer,
  // clamped so a hand-edited huge expiry can't explode the grid.
  const horizon = Math.min(
    Math.max(state.position, ...segments.map(([, to]) => to)) + buffer,
    MAX_POSITION,
  );
  const dayCount = dayOf(horizon) + 1;

  // Skip whole days before the origin's day (used when cloning a session into a fresh note).
  const originDay = Math.min(dayOf(state.origin ?? 0), dayCount - 1);

  for (let day = originDay; day < dayCount; day++) {
    const hours: HourRow[] = [];
    for (let hourOfDay = 0; hourOfDay < HOURS_PER_DAY; hourOfDay++) {
      const boxes: Box[] = [];
      for (let t = 0; t < TURNS_PER_HOUR; t++) {
        const turn = day * TURNS_PER_DAY + hourOfDay * TURNS_PER_HOUR + t;
        const status: BoxStatus =
          turn < state.position ? "past" : turn === state.position ? "current" : "future";
        boxes.push({
          turn,
          status,
          startingCount: startsOn.get(turn) ?? 0,
          endingCount: endsOn.get(turn) ?? 0,
          spanned: inSegments(segments, turn),
        });
      }
      hours.push({ label: `${pad(hourOfDay)}:00`, boxes });
    }

    const dayStart = day * TURNS_PER_DAY;
    const turnOfDay = state.position - dayStart;
    const inProgress = turnOfDay >= 0 && turnOfDay < TURNS_PER_DAY;
    const currentTime = inProgress ? formatClock(turnOfDay) : undefined;

    days.push({ header: dayHeader(day), hours, currentTime, complete: turnOfDay >= TURNS_PER_DAY });
  }

  return days;
}

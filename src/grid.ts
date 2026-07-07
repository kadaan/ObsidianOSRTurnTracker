import {
  TrackerState,
  TURNS_PER_HOUR,
  MINUTES_PER_TURN,
  HOURS_PER_DAY,
  TURNS_PER_DAY,
} from "./model";

export type BoxStatus = "past" | "current" | "future";

export interface Box {
  /** Absolute turn index this box represents. */
  turn: number;
  /** past = elapsed; current = the "you are here" next turn; future = not yet reached. */
  status: BoxStatus;
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

/** Clock time (e.g. "02:20") for a number of turns into a day. */
const formatClock = (turnsIntoDay: number): string =>
  `${pad(Math.floor(turnsIntoDay / TURNS_PER_HOUR))}:${pad((turnsIntoDay % TURNS_PER_HOUR) * MINUTES_PER_TURN)}`;

/** Compute the render model (day blocks → hour rows → boxes) from tracker state. */
export function computeGrid(state: TrackerState): DayBlock[] {
  const days: DayBlock[] = [];

  // Render enough whole days to include the box at `position` (the "next" box).
  const dayCount = Math.floor(state.position / TURNS_PER_DAY) + 1;

  for (let day = 0; day < dayCount; day++) {
    const hours: HourRow[] = [];
    for (let hourOfDay = 0; hourOfDay < HOURS_PER_DAY; hourOfDay++) {
      const boxes: Box[] = [];
      for (let t = 0; t < TURNS_PER_HOUR; t++) {
        const turn = day * TURNS_PER_DAY + hourOfDay * TURNS_PER_HOUR + t;
        const status: BoxStatus =
          turn < state.position ? "past" : turn === state.position ? "current" : "future";
        boxes.push({ turn, status });
      }
      hours.push({ label: `${pad(hourOfDay)}:00`, boxes });
    }

    const dayStart = day * TURNS_PER_DAY;
    const turnOfDay = state.position - dayStart;
    const inProgress = turnOfDay >= 0 && turnOfDay < TURNS_PER_DAY;
    const currentTime = inProgress ? formatClock(turnOfDay) : undefined;

    days.push({ header: `Day ${day + 1}`, hours, currentTime, complete: turnOfDay >= TURNS_PER_DAY });
  }

  return days;
}

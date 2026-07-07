import { TrackerState, TURNS_PER_HOUR, HOURS_PER_DAY, TURNS_PER_DAY } from "./model";

export interface Box {
  /** Absolute turn index this box represents. */
  turn: number;
  ticked: boolean;
}

export interface HourRow {
  /** Display label, e.g. "08:00". */
  label: string;
  boxes: Box[];
}

export interface DayBlock {
  header: string;
  hours: HourRow[];
}

const pad = (n: number) => String(n).padStart(2, "0");

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
        boxes.push({ turn, ticked: turn < state.position });
      }
      hours.push({ label: `${pad(hourOfDay)}:00`, boxes });
    }
    days.push({ header: `Day ${day + 1}`, hours });
  }

  return days;
}

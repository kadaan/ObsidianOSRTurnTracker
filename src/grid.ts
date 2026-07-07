import {
  TrackerState,
  TURNS_PER_HOUR,
  MINUTES_PER_TURN,
  HOURS_PER_DAY,
  TURNS_PER_DAY,
  DEFAULT_LIGHT_PRESETS,
  LOOKAHEAD_BUFFER,
  MAX_POSITION,
} from "./model";

export type BoxStatus = "past" | "current" | "future";

/** A marker rendered on the box at its expiry turn. */
export interface MarkerChip {
  /** Glyph, e.g. "T". */
  label: string;
  /** How many same-label markers expire on this turn (rendered as "T2" when > 1). */
  count: number;
  expired: boolean;
}

export interface Box {
  /** Absolute turn index this box represents. */
  turn: number;
  /** past = elapsed; current = the "you are here" next turn; future = not yet reached. */
  status: BoxStatus;
  /** Markers expiring on this turn. */
  markers: MarkerChip[];
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

/** Group markers by expiry turn, keyed for quick per-box lookup. */
function placeMarkers(state: TrackerState): Map<number, MarkerChip[]> {
  const glyph = (id: string) => DEFAULT_LIGHT_PRESETS.find((p) => p.id === id)?.marker ?? "?";
  const byTurn = new Map<number, MarkerChip[]>();

  for (const light of state.lights) {
    const label = glyph(light.preset);
    // The chip sits on the light's last lit turn; it goes out on the next.
    const chipTurn = light.expiresAt - 1;
    const chips = byTurn.get(chipTurn) ?? [];
    const existing = chips.find((c) => c.label === label);
    if (existing) {
      existing.count += 1;
    } else {
      chips.push({ label, count: 1, expired: state.position >= light.expiresAt });
    }
    byTurn.set(chipTurn, chips);
  }
  return byTurn;
}

/** Compute the render model (day blocks → hour rows → boxes) from tracker state. */
export function computeGrid(state: TrackerState): DayBlock[] {
  const days: DayBlock[] = [];
  const chipsByTurn = placeMarkers(state);

  // Render whole days through the furthest of (position, any marker expiry) + buffer,
  // clamped so a hand-edited huge expiry can't explode the grid.
  const expiries = state.lights.map((l) => l.expiresAt);
  const horizon = Math.min(Math.max(state.position, ...expiries) + LOOKAHEAD_BUFFER, MAX_POSITION);
  const dayCount = Math.floor(horizon / TURNS_PER_DAY) + 1;

  for (let day = 0; day < dayCount; day++) {
    const hours: HourRow[] = [];
    for (let hourOfDay = 0; hourOfDay < HOURS_PER_DAY; hourOfDay++) {
      const boxes: Box[] = [];
      for (let t = 0; t < TURNS_PER_HOUR; t++) {
        const turn = day * TURNS_PER_DAY + hourOfDay * TURNS_PER_HOUR + t;
        const status: BoxStatus =
          turn < state.position ? "past" : turn === state.position ? "current" : "future";
        boxes.push({ turn, status, markers: chipsByTurn.get(turn) ?? [] });
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

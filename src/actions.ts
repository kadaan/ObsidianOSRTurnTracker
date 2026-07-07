import { TURNS_PER_HOUR, Transform } from "./model";

const advanceTurns =
  (turns: number): Transform =>
  (state) => ({ ...state, position: state.position + turns });

/** Advance the tracker by one turn. */
export const endTurn: Transform = advanceTurns(1);

/** Advance the tracker by a number of hours. */
export const advanceHours = (hours: number): Transform => advanceTurns(hours * TURNS_PER_HOUR);

/**
 * Toggle the elapsed/remaining boundary at a clicked box. Clicking an empty box
 * fills through it (position = turn + 1); clicking a filled box empties from it
 * (position = turn). Reaches any position, including 0. No clamping.
 */
export const toggleAt =
  (turn: number): Transform =>
  (state) => ({ ...state, position: turn < state.position ? turn : turn + 1 });

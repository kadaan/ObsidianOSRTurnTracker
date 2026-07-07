import { TURNS_PER_HOUR, Transform, MarkerKind } from "./model";

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

/** Light a source: append a marker expiring `turns` turns after the current position. */
export const lightSource =
  (preset: string, turns: number): Transform =>
  (state) => ({
    ...state,
    lights: [...state.lights, { preset, expiresAt: state.position + turns }],
  });

/** Add an ad-hoc effect: append a labelled marker expiring `turns` after the current position. */
export const addEffect =
  (label: string, turns: number): Transform =>
  (state) => ({
    ...state,
    effects: [...state.effects, { label, expiresAt: state.position + turns }],
  });

/** Drop every marker that has already expired (expiresAt at or behind the position). */
export const clearExpired: Transform = (state) => ({
  ...state,
  lights: state.lights.filter((l) => l.expiresAt > state.position),
  effects: state.effects.filter((e) => e.expiresAt > state.position),
});

/** Remove all markers, active or expired. */
export const clearAll: Transform = (state) => ({ ...state, lights: [], effects: [] });

/**
 * Remove one marker matching a chip's identity (list `kind`, `key` = preset id or
 * effect label, expiring at `expiresAt`). Removing one of a stack leaves the rest,
 * which re-render as a lower count.
 */
export const removeMarker =
  (kind: MarkerKind, key: string, expiresAt: number): Transform =>
  (state) => {
    if (kind === "light") {
      const idx = state.lights.findIndex((l) => l.preset === key && l.expiresAt === expiresAt);
      return idx === -1 ? state : { ...state, lights: state.lights.filter((_, i) => i !== idx) };
    }
    const idx = state.effects.findIndex((e) => e.label === key && e.expiresAt === expiresAt);
    return idx === -1 ? state : { ...state, effects: state.effects.filter((_, i) => i !== idx) };
  };

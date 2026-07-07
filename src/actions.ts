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
    lights: [...state.lights, { preset, startsAt: state.position, expiresAt: state.position + turns }],
  });

/** Add an ad-hoc effect: append a labelled marker expiring `turns` after the current position. */
export const addEffect =
  (label: string, turns: number): Transform =>
  (state) => ({
    ...state,
    effects: [...state.effects, { label, startsAt: state.position, expiresAt: state.position + turns }],
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
 * Remove the marker at `index` within its `kind`'s list. Targeting by position (rather than
 * by value) addresses each instance unambiguously, even among identical markers. An
 * out-of-range index is a no-op.
 */
export const removeMarker =
  (kind: MarkerKind, index: number): Transform =>
  (state) => {
    if (kind === "light") {
      if (index < 0 || index >= state.lights.length) return state;
      return { ...state, lights: state.lights.filter((_, i) => i !== index) };
    }
    if (index < 0 || index >= state.effects.length) return state;
    return { ...state, effects: state.effects.filter((_, i) => i !== index) };
  };

/**
 * Rename the marker at `index` within its `kind`'s list. A light gets a custom instance
 * `label` (a blank name clears it, reverting to the preset's default); an effect's own label
 * is replaced (a blank name is a no-op, since effects have no default to fall back to).
 */
export const renameMarker =
  (kind: MarkerKind, index: number, name: string): Transform =>
  (state) => {
    const trimmed = name.trim();

    if (kind === "light") {
      if (index < 0 || index >= state.lights.length) return state;
      const { label: _drop, ...rest } = state.lights[index];
      const renamed = trimmed ? { ...rest, label: trimmed } : rest;
      return { ...state, lights: state.lights.map((l, i) => (i === index ? renamed : l)) };
    }
    if (index < 0 || index >= state.effects.length || !trimmed) return state;
    return {
      ...state,
      effects: state.effects.map((e, i) => (i === index ? { ...e, label: trimmed } : e)),
    };
  };

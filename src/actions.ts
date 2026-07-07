import { TURNS_PER_HOUR, Transform, MarkerKind, Pause, TrackerState, Light, Effect } from "./model";
import { resolveMarker } from "./markers";

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

/** Light a source: append a marker burning for `turns` turns from the current position. */
export const lightSource =
  (preset: string, turns: number): Transform =>
  (state) => ({
    ...state,
    lights: [...state.lights, { preset, startsAt: state.position, duration: turns }],
  });

/** Add an ad-hoc effect: append a labelled marker lasting `turns` turns from the current position. */
export const addEffect =
  (label: string, turns: number): Transform =>
  (state) => ({
    ...state,
    effects: [...state.effects, { label, startsAt: state.position, duration: turns }],
  });

/** Drop every marker that has already expired (its derived burn is spent). */
export const clearExpired: Transform = (state) => ({
  ...state,
  lights: state.lights.filter((l) => resolveMarker(l, state.position).phase !== "expired"),
  effects: state.effects.filter((e) => resolveMarker(e, state.position).phase !== "expired"),
});

/** Remove all markers, active or expired. */
export const clearAll: Transform = (state) => ({ ...state, lights: [], effects: [] });

const hasOpenPause = (pauses?: Pause[]) => (pauses ?? []).some((p) => p.until === undefined);

/**
 * Replace the marker at `index` within its `kind`'s list via `update`, rebuilding state with the
 * correct list. Out-of-range is a no-op. Targeting by position addresses each instance
 * unambiguously, even among identical markers.
 */
const updateMarkerAt = (
  state: TrackerState,
  kind: MarkerKind,
  index: number,
  update: (m: Light | Effect) => Light | Effect,
): TrackerState => {
  const list: (Light | Effect)[] = kind === "light" ? state.lights : state.effects;
  if (index < 0 || index >= list.length) return state;
  const next = list.map((m, i) => (i === index ? update(m) : m));
  return kind === "light"
    ? { ...state, lights: next as Light[] }
    : { ...state, effects: next as Effect[] };
};

/**
 * Set the marker at `index` to have `turns` of burn left from the current position, adjusting its
 * duration while keeping the already-consumed burn intact. On a fresh marker this simply sets the
 * duration; it also lets you dial in durations after creating effects for a session.
 */
export const setRemaining =
  (kind: MarkerKind, index: number, turns: number): Transform =>
  (state) =>
    updateMarkerAt(state, kind, index, (m) => {
      const consumed = m.duration - resolveMarker(m, state.position).remaining;
      return { ...m, duration: consumed + turns };
    });

/**
 * Pause the marker at `index`, freezing its burn from the current position. A no-op if the
 * index is out of range or the marker is already paused.
 */
export const pauseMarker =
  (kind: MarkerKind, index: number): Transform =>
  (state) => {
    const marker = (kind === "light" ? state.lights : state.effects)[index];
    if (hasOpenPause(marker?.pauses)) return state;
    return updateMarkerAt(state, kind, index, (m) => ({
      ...m,
      pauses: [...(m.pauses ?? []), { at: state.position }],
    }));
  };

/**
 * Resume the marker at `index`, closing its open pause at the current position so its remaining
 * burn continues from here. A no-op if the index is out of range or the marker is not paused.
 */
export const resumeMarker =
  (kind: MarkerKind, index: number): Transform =>
  (state) => {
    const marker = (kind === "light" ? state.lights : state.effects)[index];
    if (!hasOpenPause(marker?.pauses)) return state;
    return updateMarkerAt(state, kind, index, (m) => ({
      ...m,
      pauses: (m.pauses ?? []).map((p) => (p.until === undefined ? { ...p, until: state.position } : p)),
    }));
  };

/** Remove the marker at `index` within its `kind`'s list. Out-of-range is a no-op. */
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
 * Rename the marker at `index`. A light gets a custom instance `label` (a blank name clears it,
 * reverting to the preset default); an effect's own label is replaced (blank is a no-op, since
 * effects have no default to fall back to).
 */
export const renameMarker =
  (kind: MarkerKind, index: number, name: string): Transform =>
  (state) => {
    const trimmed = name.trim();
    if (kind === "effect" && !trimmed) return state;
    return updateMarkerAt(state, kind, index, (m) => {
      if (kind === "effect") return { ...m, label: trimmed };
      const { label: _drop, ...rest } = m as Light;
      return trimmed ? { ...rest, label: trimmed } : rest;
    });
  };

import { TURNS_PER_HOUR, Transform, Pause, TrackerState, Marker, CUSTOM_TYPE } from "./model";
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

/** Light a source: append a preset marker burning for `turns` turns from `startsAt` (default: now). */
export const lightSource =
  (type: string, turns: number, startsAt?: number): Transform =>
  (state) => ({
    ...state,
    markers: [...state.markers, { type, startsAt: startsAt ?? state.position, duration: turns }],
  });

/** Add an ad-hoc effect: append a labelled custom marker lasting `turns` turns from `startsAt` (default: now). */
export const addEffect =
  (label: string, turns: number, startsAt?: number): Transform =>
  (state) => ({
    ...state,
    markers: [
      ...state.markers,
      { type: CUSTOM_TYPE, label, startsAt: startsAt ?? state.position, duration: turns },
    ],
  });

/** Drop every marker that has already expired (its derived burn is spent). */
export const clearExpired: Transform = (state) => ({
  ...state,
  markers: state.markers.filter((m) => resolveMarker(m, state.position).phase !== "expired"),
});

/** Remove all markers, active or expired. */
export const clearAll: Transform = (state) => ({ ...state, markers: [] });

/** Map the item at `index` through `fn`, returning a new list — or `undefined` if out of range. */
const mapAt = <T>(list: T[], index: number, fn: (item: T) => T): T[] | undefined =>
  index < 0 || index >= list.length ? undefined : list.map((x, i) => (i === index ? fn(x) : x));

/** Drop the item at `index`, returning a new list — or `undefined` if out of range. */
const dropAt = <T>(list: T[], index: number): T[] | undefined =>
  index < 0 || index >= list.length ? undefined : list.filter((_, i) => i !== index);

/** Add a free-form note anchored to `at` (default: the current position). */
export const addNote =
  (text: string, at?: number): Transform =>
  (state) => ({
    ...state,
    notes: [...(state.notes ?? []), { at: at ?? state.position, text }],
  });

/** Replace the text of the note at `index`. A no-op for an out-of-range index. */
export const editNote =
  (index: number, text: string): Transform =>
  (state) => {
    const notes = mapAt(state.notes ?? [], index, (n) => ({ ...n, text }));
    return notes ? { ...state, notes } : state;
  };

/** Remove the note at `index`. A no-op for an out-of-range index. */
export const removeNote =
  (index: number): Transform =>
  (state) => {
    const notes = dropAt(state.notes ?? [], index);
    return notes ? { ...state, notes } : state;
  };

const hasOpenPause = (pauses?: Pause[]) => (pauses ?? []).some((p) => p.until === undefined);

/**
 * Replace the marker at `index` via `update`, rebuilding state. Out-of-range is a no-op. Targeting
 * by position addresses each instance unambiguously, even among identical markers.
 */
const updateMarkerAt = (
  state: TrackerState,
  index: number,
  update: (m: Marker) => Marker,
): TrackerState => {
  const markers = mapAt(state.markers, index, update);
  return markers ? { ...state, markers } : state;
};

/**
 * Set the marker at `index` to have `turns` of burn left from the current position, adjusting its
 * duration while keeping the already-consumed burn intact. On a fresh marker this simply sets the
 * duration; it also lets you dial in durations after creating effects for a session.
 */
export const setRemaining =
  (index: number, turns: number): Transform =>
  (state) =>
    updateMarkerAt(state, index, (m) => {
      const consumed = m.duration - resolveMarker(m, state.position).remaining;
      return { ...m, duration: consumed + turns };
    });

/**
 * Pause the marker at `index`, freezing its burn from the current position. A no-op if the
 * index is out of range or the marker is already paused.
 */
export const pauseMarker =
  (index: number): Transform =>
  (state) => {
    if (hasOpenPause(state.markers[index]?.pauses)) return state;
    return updateMarkerAt(state, index, (m) => ({
      ...m,
      pauses: [...(m.pauses ?? []), { at: state.position }],
    }));
  };

/**
 * Resume the marker at `index`, closing its open pause at the current position so its remaining
 * burn continues from here. A no-op if the index is out of range or the marker is not paused.
 */
export const resumeMarker =
  (index: number): Transform =>
  (state) => {
    if (!hasOpenPause(state.markers[index]?.pauses)) return state;
    return updateMarkerAt(state, index, (m) => ({
      ...m,
      pauses: (m.pauses ?? []).map((p) => (p.until === undefined ? { ...p, until: state.position } : p)),
    }));
  };

/** Remove the marker at `index`. Out-of-range is a no-op. */
export const removeMarker =
  (index: number): Transform =>
  (state) => {
    const markers = dropAt(state.markers, index);
    return markers ? { ...state, markers } : state;
  };

/**
 * Rename the marker at `index` via a custom instance `label`. For a preset marker a blank name
 * clears the override, reverting to the preset's default; for a custom marker the label IS the
 * name, so a blank is a no-op (there's no default to fall back to).
 */
export const renameMarker =
  (index: number, name: string): Transform =>
  (state) => {
    const trimmed = name.trim();
    if (!trimmed && state.markers[index]?.type === CUSTOM_TYPE) return state;
    return updateMarkerAt(state, index, (m) => {
      if (trimmed) return { ...m, label: trimmed };
      const { label: _drop, ...rest } = m;
      return rest;
    });
  };

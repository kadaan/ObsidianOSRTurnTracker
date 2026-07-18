import { stringify as stringifyYaml } from "yaml";
import { fenceBlock } from "../../core/block";
import { Marker, TrackerState, TRACKER_LANG } from "./model";

/**
 * Serialize tracker state to canonical YAML for a `turn-tracker` code block body.
 * Undefined and empty fields are omitted to keep the block tidy; the parser
 * restores their defaults. Round-trips with `parseTrackerState`.
 */
export function serializeTrackerState(state: TrackerState): string {
  const obj: Record<string, unknown> = {};
  if (state.start !== undefined) obj.start = state.start;
  if (state.calendar !== undefined) obj.calendar = state.calendar;
  obj.position = state.position;
  if (state.origin) obj.origin = state.origin; // omit the 0/absent default
  // Emit effects ordered by start, then name, so the stored YAML matches the panel order.
  if (state.markers.length > 0) obj.effects = sortMarkers(state.markers).map(orderMarker);
  if (state.notes && state.notes.length > 0) {
    obj.notes = [...state.notes].sort((a, b) => a.at - b.at);
  }

  return stringifyYaml(obj).trimEnd();
}

/** Wrap serialized state in a `turn-tracker` fenced code block, ready to insert into a note. */
export function fenceTrackerBlock(state: TrackerState): string {
  return fenceBlock(TRACKER_LANG, serializeTrackerState(state));
}

/** A marker's display name for sorting — its custom label, else its type. */
const markerName = (m: Marker): string => m.label ?? m.type;

const sortMarkers = (markers: Marker[]): Marker[] =>
  [...markers].sort(
    (a, b) => (a.startsAt ?? 0) - (b.startsAt ?? 0) || markerName(a).localeCompare(markerName(b)),
  );

/** Emit a marker with a stable field order, omitting absent optionals, for tidy YAML. */
const orderMarker = (m: Marker): Record<string, unknown> => {
  const o: Record<string, unknown> = { type: m.type };
  if (m.label !== undefined) o.label = m.label;
  if (m.startsAt !== undefined) o.startsAt = m.startsAt;
  o.duration = m.duration;
  if (m.pauses !== undefined) o.pauses = m.pauses;
  return o;
};

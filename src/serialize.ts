import { stringify as stringifyYaml } from "yaml";
import { TrackerState } from "./model";

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
  // Emit markers ordered by start, then name, so the stored YAML matches the panel order.
  if (state.lights.length > 0) obj.lights = sortMarkers(state.lights, (l) => l.preset);
  if (state.effects.length > 0) obj.effects = sortMarkers(state.effects, (e) => e.label);

  return stringifyYaml(obj).trimEnd();
}

const sortMarkers = <T extends { startsAt?: number }>(markers: T[], name: (m: T) => string): T[] =>
  [...markers].sort(
    (a, b) => (a.startsAt ?? 0) - (b.startsAt ?? 0) || name(a).localeCompare(name(b)),
  );

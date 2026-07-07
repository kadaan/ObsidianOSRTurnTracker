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
  if (state.lights.length > 0) obj.lights = state.lights;
  if (state.effects.length > 0) obj.effects = state.effects;

  return stringifyYaml(obj).trimEnd();
}

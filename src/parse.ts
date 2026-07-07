import { parse as parseYaml } from "yaml";
import { Effect, Failure, Light, MAX_POSITION, TrackerState } from "./model";

export type ParseResult = { ok: true; state: TrackerState } | Failure;

function fail(message: string): Failure {
  return { ok: false, error: `Invalid tracker: ${message}` };
}

/** Parse the YAML body of a `turn-tracker` code block into tracker state. */
export function parseTrackerState(source: string): ParseResult {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  const obj = (raw ?? {}) as Record<string, unknown>;

  const position = obj.position ?? 0;
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0) {
    return fail(`"position" must be a non-negative whole number.`);
  }
  if (position > MAX_POSITION) {
    return fail(`"position" is too large (max ${MAX_POSITION} turns).`);
  }

  const state: TrackerState = { position, lights: [], effects: [] };

  if (obj.start !== undefined) {
    if (typeof obj.start !== "string") return fail(`"start" must be a string.`);
    state.start = obj.start;
  }
  if (obj.calendar !== undefined) {
    if (typeof obj.calendar !== "string") return fail(`"calendar" must be a string.`);
    state.calendar = obj.calendar;
  }
  if (obj.lights !== undefined) {
    if (!Array.isArray(obj.lights)) return fail(`"lights" must be a list.`);
    state.lights = obj.lights as Light[];
  }
  if (obj.effects !== undefined) {
    if (!Array.isArray(obj.effects)) return fail(`"effects" must be a list.`);
    state.effects = obj.effects as Effect[];
  }

  return { ok: true, state };
}

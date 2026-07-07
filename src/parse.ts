import { parse as parseYaml } from "yaml";
import { Effect, Failure, Light, MAX_POSITION, TrackerState } from "./model";

export type ParseResult = { ok: true; state: TrackerState } | Failure;

function fail(message: string): Failure {
  return { ok: false, error: `Invalid tracker: ${message}` };
}

const isNonNegativeInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

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
  if (!isNonNegativeInt(position)) return fail(`"position" must be a non-negative whole number.`);
  if (position > MAX_POSITION) {
    return fail(`"position" is too large (max ${MAX_POSITION} turns).`);
  }

  const state: TrackerState = { position, lights: [], effects: [] };

  if (obj.origin !== undefined) {
    if (!isNonNegativeInt(obj.origin)) return fail(`"origin" must be a non-negative whole number.`);
    state.origin = obj.origin;
  }
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
    state.lights = obj.lights.map(toDuration) as unknown as Light[];
  }
  if (obj.effects !== undefined) {
    if (!Array.isArray(obj.effects)) return fail(`"effects" must be a list.`);
    state.effects = obj.effects.map(toDuration) as unknown as Effect[];
  }

  return { ok: true, state };
}

/**
 * Normalize a stored marker to the `duration` form, accepting the legacy `expiresAt`
 * (duration = expiresAt - startsAt). The legacy field is dropped so it isn't re-serialized.
 */
function toDuration(raw: unknown): Record<string, unknown> {
  const { expiresAt, duration, pauses, ...rest } = (raw ?? {}) as Record<string, unknown>;
  const startsAt = typeof rest.startsAt === "number" ? rest.startsAt : 0;
  const resolved =
    typeof duration === "number"
      ? duration
      : typeof expiresAt === "number"
        ? expiresAt - startsAt
        : 0;
  return { ...rest, duration: resolved, ...(pauses !== undefined ? { pauses } : {}) };
}

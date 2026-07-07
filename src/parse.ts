import { parse as parseYaml } from "yaml";
import { MAX_POSITION, TrackerState } from "./model";

export type ParseResult =
  | { ok: true; state: TrackerState }
  | { ok: false; error: string };

function fail(message: string): ParseResult {
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

  return { ok: true, state: { position, lights: [], effects: [] } };
}

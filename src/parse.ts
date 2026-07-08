import { parse as parseYaml } from "yaml";
import { CUSTOM_TYPE, Failure, Marker, MAX_POSITION, Note, Pause, TrackerState } from "./model";

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

  const state: TrackerState = { position, markers: [] };

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
  // One unified `effects` list. The legacy `lights` list (preset-based) and the short-lived
  // `markers` key are still read (and merged in order) so older blocks keep working.
  for (const key of ["lights", "effects", "markers"] as const) {
    const list = obj[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return fail(`"${key}" must be a list.`);
    state.markers.push(...list.map(toMarker));
  }
  if (obj.notes !== undefined) {
    if (!Array.isArray(obj.notes)) return fail(`"notes" must be a list.`);
    state.notes = obj.notes.filter(
      (n): n is Note => !!n && typeof n.at === "number" && typeof n.text === "string",
    );
  }

  return { ok: true, state };
}

/**
 * Normalize a stored marker to the current `Marker` shape, accepting three legacy forms:
 * a light's `preset` field (→ `type`), an effect with only a `label` (→ `type: custom`), and an
 * `expiresAt` instead of a `duration` (duration = expiresAt - startsAt). Legacy fields are dropped
 * so they aren't re-serialized.
 */
function toMarker(raw: unknown): Marker {
  const r = (raw ?? {}) as Record<string, unknown>;
  const startsAt = typeof r.startsAt === "number" ? r.startsAt : undefined;
  const duration =
    typeof r.duration === "number"
      ? r.duration
      : typeof r.expiresAt === "number"
        ? r.expiresAt - (startsAt ?? 0)
        : 0;
  const type =
    typeof r.type === "string" ? r.type : typeof r.preset === "string" ? r.preset : CUSTOM_TYPE;

  const marker: Marker = { type, duration };
  if (typeof r.label === "string") marker.label = r.label;
  if (startsAt !== undefined) marker.startsAt = startsAt;
  if (Array.isArray(r.pauses)) marker.pauses = r.pauses as Pause[];
  return marker;
}

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ParseResult } from "../../core/tool";
import { isNonNegativeInt } from "../../core/validate";
import { ChargeItem, ChargeTrackerState, MAX_CHARGES } from "./model";

const fail = (message: string): ParseResult<ChargeTrackerState> => ({
  ok: false,
  error: `Invalid charge tracker: ${message}`,
});

const KNOWN_KEYS = new Set(["items"]);

/** Parse the YAML body of a `charge-tracker` code block into charge-tracker state. Total — never throws. */
export function parseChargeState(source: string): ParseResult<ChargeTrackerState> {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  if (raw !== undefined && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
    return fail("the block must be a set of key: value fields.");
  }
  const obj = (raw ?? {}) as Record<string, unknown>;

  const unknown = Object.keys(obj).find((key) => !KNOWN_KEYS.has(key));
  if (unknown) return fail(`unknown field "${unknown}".`);

  const rawItems = obj.items ?? [];
  if (!Array.isArray(rawItems)) return fail(`"items" must be a list.`);

  const items: ChargeItem[] = [];
  for (const entry of rawItems) {
    const r = (entry ?? {}) as Record<string, unknown>;
    if (typeof r.name !== "string" || r.name.trim() === "") {
      return fail(`each item needs a non-empty "name".`);
    }
    if (!isNonNegativeInt(r.max)) return fail(`"${r.name}" max must be a non-negative whole number.`);
    if (r.max > MAX_CHARGES) return fail(`"${r.name}" max is too large (max ${MAX_CHARGES}).`);
    if (!isNonNegativeInt(r.current)) {
      return fail(`"${r.name}" current must be a non-negative whole number.`);
    }
    if (r.current > r.max) return fail(`"${r.name}" current (${r.current}) exceeds max (${r.max}).`);
    items.push({ name: r.name.trim(), current: r.current, max: r.max });
  }
  return { ok: true, state: { items } };
}

/**
 * Serialize charge-tracker state to canonical YAML for a `charge-tracker` code block body.
 * Each item emits its fields in a stable order. Round-trips with `parseChargeState`.
 */
export function serializeChargeState(state: ChargeTrackerState): string {
  const items = state.items.map((item) => ({
    name: item.name,
    current: item.current,
    max: item.max,
  }));
  return stringifyYaml({ items }).trimEnd();
}

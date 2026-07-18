import { DEFAULT_LIGHT_PRESETS, LightPreset, TrackerState } from "./model";
import { MarkerPhase, resolveMarker } from "./markers";

export interface EffectRow {
  /** Index of this marker within the state's `markers` list — its unambiguous rename/remove target. */
  index: number;
  /** Editable base name (light's custom label or preset default; effect's own label). */
  name: string;
  /** Display name: `name`, disambiguated with a trailing number when a list repeats one. */
  label: string;
  startsAt: number;
  /** Effective expiry, accounting for completed pauses. */
  expiresAt: number;
  /** Active burn intervals `[from, to)` — pause gaps excluded. */
  segments: Array<[number, number]>;
  /** Whether this marker can be paused/resumed (driven by its preset; custom markers cannot). */
  pausable: boolean;
  /** 0..1 through the marker's burn. */
  progress: number;
  /** Turns until expiry. */
  remaining: number;
}

export type EffectPanel = Record<MarkerPhase, EffectRow[]>;

/**
 * Build the effect panel from tracker state: resolve each marker's burn state (honouring pauses)
 * relative to `position`, partition into active / paused / upcoming / expired, sort each by start
 * then name, and number same-named rows within a list.
 */
export function computeEffectPanel(
  state: TrackerState,
  presets: LightPreset[] = DEFAULT_LIGHT_PRESETS,
): EffectPanel {
  const markers = state.markers.map((src, index) => {
    const preset = presets.find((p) => p.id === src.type);
    return {
      index,
      // A custom instance name wins; otherwise the preset's full name, then the raw type as a fallback.
      base: src.label ?? preset?.label ?? src.type,
      pausable: !!preset?.pausable,
      src,
    };
  });

  const lists: EffectPanel = { active: [], paused: [], upcoming: [], expired: [] };

  for (const m of markers) {
    const r = resolveMarker(m.src, state.position);
    const duration = m.src.duration;
    lists[r.phase].push({
      index: m.index,
      name: m.base,
      label: m.base,
      startsAt: r.startsAt,
      expiresAt: r.expiresAt,
      segments: r.segments,
      pausable: m.pausable,
      progress: duration > 0 ? (duration - r.remaining) / duration : 1,
      remaining: r.remaining,
    });
  }

  return {
    active: number(lists.active),
    paused: number(lists.paused),
    upcoming: number(lists.upcoming),
    expired: number(lists.expired),
  };
}

/** Sort a list by start then name, then append " 2", " 3", … to repeats of a base name. */
function number(rows: EffectRow[]): EffectRow[] {
  rows.sort((a, b) => a.startsAt - b.startsAt || a.label.localeCompare(b.label));
  const seen = new Map<string, number>();
  for (const row of rows) {
    const n = (seen.get(row.label) ?? 0) + 1;
    seen.set(row.label, n);
    if (n > 1) row.label = `${row.label} ${n}`;
  }
  return rows;
}

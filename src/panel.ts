import { DEFAULT_LIGHT_PRESETS, LightPreset, MarkerKind, TrackerState } from "./model";

export interface EffectRow {
  kind: MarkerKind;
  /** Index of this marker within its `kind`'s list — its unambiguous rename/remove target. */
  index: number;
  /** Editable base name (light's custom label or preset default; effect's own label). */
  name: string;
  /** Display name: `name`, disambiguated with a trailing number when a list repeats one. */
  label: string;
  startsAt: number;
  expiresAt: number;
  /** 0..1 through the marker's window. */
  progress: number;
  /** Turns until expiry. */
  remaining: number;
}

export interface EffectPanel {
  active: EffectRow[];
  upcoming: EffectRow[];
  expired: EffectRow[];
}

/**
 * Build the effect panel from tracker state: unify lights + effects, partition into
 * upcoming (not lit yet) / active / expired by `position`, sort each by start then name,
 * and number same-named rows within a list ("Torch", "Torch 2", …). The number is a
 * display artifact of the current partition, so a survivor reverts to its bare name once
 * the others leave the list.
 */
export function computeEffectPanel(
  state: TrackerState,
  presets: LightPreset[] = DEFAULT_LIGHT_PRESETS,
): EffectPanel {
  const markers = [
    ...state.lights.map((l, index) => ({
      kind: "light" as const,
      index,
      // A custom instance name wins; otherwise the preset's full name (glyphs are gone).
      base: l.label ?? presets.find((p) => p.id === l.preset)?.label ?? l.preset,
      startsAt: l.startsAt ?? 0,
      expiresAt: l.expiresAt,
    })),
    ...state.effects.map((e, index) => ({
      kind: "effect" as const,
      index,
      base: e.label,
      startsAt: e.startsAt ?? 0,
      expiresAt: e.expiresAt,
    })),
  ];

  const active: EffectRow[] = [];
  const upcoming: EffectRow[] = [];
  const expired: EffectRow[] = [];

  for (const m of markers) {
    const list =
      state.position < m.startsAt ? upcoming : state.position >= m.expiresAt ? expired : active;
    list.push({
      kind: m.kind,
      index: m.index,
      name: m.base,
      label: m.base,
      startsAt: m.startsAt,
      expiresAt: m.expiresAt,
      progress: (state.position - m.startsAt) / (m.expiresAt - m.startsAt),
      remaining: Math.max(0, m.expiresAt - state.position),
    });
  }

  return { active: number(active), upcoming: number(upcoming), expired: number(expired) };
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

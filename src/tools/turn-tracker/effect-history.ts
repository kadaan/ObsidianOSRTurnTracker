/** Custom-effect-label usage history: how often each label was used and with which durations.
 *  Pure functions over a plain record; the plugin owns the store and persists it. */

/** Usage stats for one custom effect label: how often, and with which duration expressions. */
export interface EffectStat {
  /** Total uses. Stored (not derived from `durations`) so legacy entries migrated from the old
   *  count-only format keep their suggestion ranking despite having no recorded durations. */
  count: number;
  /** Tally of the duration expressions used (plain numbers or dice like "2d6+1") → times seen. */
  durations: Record<string, number>;
}

/** The whole history store: label → its usage stats. */
export type EffectHistory = Record<string, EffectStat>;

/** What the Add-effect modal needs from history: ranked labels and a per-label duration hint. */
export interface EffectHistoryView {
  labels: string[];
  durationFor: (label: string) => string | undefined;
}

/** Coerce persisted history to the current shape, migrating the legacy `label → count` form. */
export function normalizeEffectHistory(raw: unknown): EffectHistory {
  if (!raw || typeof raw !== "object") return {};
  const out: EffectHistory = {};
  for (const [label, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number") out[label] = { count: value, durations: {} };
    else if (value && typeof value === "object") {
      const stat = value as { count?: unknown; durations?: unknown };
      const durations: Record<string, number> = {};
      if (stat.durations && typeof stat.durations === "object") {
        for (const [d, c] of Object.entries(stat.durations)) {
          if (typeof c === "number") durations[d] = c;
        }
      }
      out[label] = { count: typeof stat.count === "number" ? stat.count : 0, durations };
    }
  }
  return out;
}

/** Custom effect labels, most-used first (alphabetical within equal counts). */
export function frequentEffectLabels(history: EffectHistory): string[] {
  return Object.keys(history).sort(
    (a, b) => history[b].count - history[a].count || a.localeCompare(b),
  );
}

/**
 * The duration expression to pre-fill for a label, when it's unambiguous — the single one it's
 * always been used with, or a strict most-common one. May be dice (e.g. "2d6+1"), which re-rolls
 * on submit. Returns undefined when there's no clear winner.
 */
export function durationFor(history: EffectHistory, label: string): string | undefined {
  const durations = history[label]?.durations;
  if (!durations) return undefined;
  const ranked = Object.entries(durations).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return undefined;
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return undefined; // tie → not clear
  return ranked[0][0];
}

/** Bump a label's usage so it surfaces higher in suggestions and learns its typical duration. */
export function recordEffect(history: EffectHistory, label: string, duration: string): void {
  const stat = history[label] ?? { count: 0, durations: {} };
  stat.count += 1;
  stat.durations[duration] = (stat.durations[duration] ?? 0) + 1;
  history[label] = stat;
}

/** Recorded custom-effect labels with their usage (most-used first), for the settings view. */
export function effectHistoryView(
  history: EffectHistory,
): { label: string; count: number; durations: [string, number][] }[] {
  return frequentEffectLabels(history).map((label) => ({
    label,
    count: history[label].count,
    durations: Object.entries(history[label].durations),
  }));
}

import {
  DEFAULT_ADVANCE_SHORTCUTS,
  DEFAULT_LIGHT_PRESETS,
  LightPreset,
  LOOKAHEAD_BUFFER,
} from "./model";

export interface OsrTurnTrackerSettings {
  /** Light presets surfaced as widget buttons and used for chip glyphs. */
  presets: LightPreset[];
  /** Advance-shortcut buttons/commands, in hours. */
  advanceShortcuts: number[];
  /** Turns rendered past the furthest marker/position. */
  lookaheadBuffer: number;
}

/** Fresh default settings — never shares array/object instances with the module defaults. */
export const createDefaultSettings = (): OsrTurnTrackerSettings => ({
  presets: DEFAULT_LIGHT_PRESETS.map((p) => ({ ...p })),
  advanceShortcuts: [...DEFAULT_ADVANCE_SHORTCUTS],
  lookaheadBuffer: LOOKAHEAD_BUFFER,
});

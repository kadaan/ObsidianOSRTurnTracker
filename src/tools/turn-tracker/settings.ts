import {
  DEFAULT_ADVANCE_SHORTCUTS,
  DEFAULT_LIGHT_PRESETS,
  LightPreset,
  LOOKAHEAD_BUFFER,
} from "./model";

export interface OsrTurnTrackerSettings {
  /** Light presets surfaced as widget buttons. */
  presets: LightPreset[];
  /** Advance-shortcut buttons/commands, in hours. */
  advanceShortcuts: number[];
  /** Turns rendered past the furthest marker/position. */
  lookaheadBuffer: number;
  /** When a turn advances to a new day, set the Calendarium calendar's current date to match. */
  syncCalendariumDate: boolean;
  /** Frontmatter property a new tracker reads its calendar name from. */
  calendarProperty: string;
  /** Frontmatter property a new tracker reads its in-game start date from. */
  startProperty: string;
}

// Default to Calendarium's own per-note calendar property, so a note already tagged for Calendarium
// works with the tracker without extra configuration.
export const DEFAULT_CALENDAR_PROPERTY = "fc-calendar";
export const DEFAULT_START_PROPERTY = "osr-tools-ingame-date";

/** Fresh default settings — never shares array/object instances with the module defaults. */
export const createDefaultSettings = (): OsrTurnTrackerSettings => ({
  presets: DEFAULT_LIGHT_PRESETS.map((p) => ({ ...p })),
  advanceShortcuts: [...DEFAULT_ADVANCE_SHORTCUTS],
  lookaheadBuffer: LOOKAHEAD_BUFFER,
  syncCalendariumDate: false,
  calendarProperty: DEFAULT_CALENDAR_PROPERTY,
  startProperty: DEFAULT_START_PROPERTY,
});

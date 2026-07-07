/** Core domain model for the OSR Turn Tracker. */

/** The code-block language / fence info-string that identifies a tracker. */
export const TRACKER_LANG = "turn-tracker";

/** Advance-shortcut buttons/commands, in hours. Becomes configurable in a later phase. */
export const DEFAULT_ADVANCE_SHORTCUTS = [1, 3, 8];

/** A light source preset. Becomes user-editable in a later phase. */
export interface LightPreset {
  id: string;
  label: string;
  /** Short glyph shown on the grid chip, e.g. "T". */
  marker: string;
  /** Duration in turns. */
  turns: number;
}

export const DEFAULT_LIGHT_PRESETS: LightPreset[] = [
  { id: "torch", label: "Torch", marker: "torch", turns: 6 },
  { id: "lantern", label: "Lantern", marker: "lantern", turns: 24 },
];

/** Turns rendered past the furthest marker/position, for look-ahead. A setting later. */
export const LOOKAHEAD_BUFFER = 6;

/** Which marker list a chip came from — its removal target. */
export type MarkerKind = "light" | "effect";

/** A turn is 10 minutes; these are enforced constants, never configurable. */
export const TURNS_PER_HOUR = 6;
export const MINUTES_PER_TURN = 60 / TURNS_PER_HOUR; // 10
export const HOURS_PER_DAY = 24;
export const TURNS_PER_DAY = TURNS_PER_HOUR * HOURS_PER_DAY; // 144

/**
 * Upper bound on `position`, guarding against a hand-entered value that would
 * render millions of boxes and freeze the renderer. A year of in-game time is a
 * generous ceiling for a per-session tracker.
 */
export const MAX_POSITION = 366 * TURNS_PER_DAY;

/** A light source, driven by a preset. Turn indices are absolute. */
export interface Light {
  preset: string;
  /** Custom instance name (e.g. "Aragorn's torch"); absent → the preset's label is shown. */
  label?: string;
  /** Turn the light was lit. Absent on legacy markers → treated as turn 0 (never pending). */
  startsAt?: number;
  expiresAt: number;
}

/** An ad-hoc timed effect with a free-text label. Turn indices are absolute. */
export interface Effect {
  label: string;
  /** Turn the effect began. Absent on legacy markers → treated as turn 0 (never pending). */
  startsAt?: number;
  expiresAt: number;
}

/** The full state of a tracker, as stored in a `turn-tracker` code block. */
export interface TrackerState {
  /** ISO datetime the tracker starts at; absent means Day-N mode from turn 0. */
  start?: string;
  /** Calendarium calendar name; absent means no fantasy calendar. */
  calendar?: string;
  /** Turns elapsed since start. Boxes [0, position) are ticked. */
  position: number;
  lights: Light[];
  effects: Effect[];
}

/** A pure state transition (e.g. End Turn, Advance). */
export type Transform = (state: TrackerState) => TrackerState;

/** Shared failure branch for `Result`-style returns. */
export type Failure = { ok: false; error: string };

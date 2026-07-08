/** Core domain model for the OSR Turn Tracker. */

/** The code-block language / fence info-string that identifies a tracker. */
export const TRACKER_LANG = "turn-tracker";

/** Advance-shortcut buttons/commands, in hours. Becomes configurable in a later phase. */
export const DEFAULT_ADVANCE_SHORTCUTS = [1, 3, 8];

/** A light source preset. Becomes user-editable in a later phase. */
export interface LightPreset {
  id: string;
  label: string;
  /** Duration in turns. */
  turns: number;
  /** Whether instances of this preset can be paused/resumed (freezing their burn). */
  pausable?: boolean;
}

export const DEFAULT_LIGHT_PRESETS: LightPreset[] = [
  { id: "torch", label: "Torch", turns: 6, pausable: true },
  { id: "lantern", label: "Lantern", turns: 24, pausable: true },
];

/** Turns rendered past the furthest marker/position, for look-ahead. A setting later. */
export const LOOKAHEAD_BUFFER = 6;

/** The `type` of an ad-hoc effect — one with a free-text label and no preset behind it. */
export const CUSTOM_TYPE = "custom";

/** A turn is 10 minutes; these are enforced constants, never configurable. */
export const TURNS_PER_HOUR = 6;
export const MINUTES_PER_TURN = 60 / TURNS_PER_HOUR; // 10
export const HOURS_PER_DAY = 24;
export const TURNS_PER_DAY = TURNS_PER_HOUR * HOURS_PER_DAY; // 144

/** The 0-based day index a turn falls in. */
export const dayOf = (turn: number): number => Math.floor(turn / TURNS_PER_DAY);

/**
 * Upper bound on `position`, guarding against a hand-entered value that would
 * render millions of boxes and freeze the renderer. A year of in-game time is a
 * generous ceiling for a per-session tracker.
 */
export const MAX_POSITION = 366 * TURNS_PER_DAY;

/**
 * A pause interval on a marker. `at` is the position it was paused; `until` the position it
 * was resumed (absent → still paused). The list of these lets the burn state be rebuilt.
 */
export interface Pause {
  at: number;
  until?: number;
}

/**
 * A timed marker on the tracker: a light source, a spell, a condition — anything with a duration.
 * `type` is a light-preset id (e.g. "torch") or `CUSTOM_TYPE` for an ad-hoc effect. Turn indices
 * are absolute.
 */
export interface Marker {
  /** A `LightPreset` id, or `CUSTOM_TYPE` for a free-text effect. Drives the default name and pausability. */
  type: string;
  /**
   * Display name. For a preset marker it's an optional instance override (absent → the preset's
   * label); for a custom marker it IS the name (the free text the user typed).
   */
  label?: string;
  /** Turn the marker began. Absent on legacy markers → treated as turn 0 (never pending). */
  startsAt?: number;
  /** Burn duration in active turns; the effective expiry is derived (startsAt + duration + pauses). */
  duration: number;
  /** Pause/resume history; absent → never paused. */
  pauses?: Pause[];
}

/** A free-form note anchored to a turn, shown under the day it falls in. */
export interface Note {
  at: number;
  text: string;
}

/** The full state of a tracker, as stored in a `turn-tracker` code block. */
export interface TrackerState {
  /** ISO datetime the tracker starts at; absent means Day-N mode from turn 0. */
  start?: string;
  /** Calendarium calendar name; absent means no fantasy calendar. */
  calendar?: string;
  /** Turns elapsed since start. Boxes [0, position) are ticked. */
  position: number;
  /**
   * Turn to begin rendering from; days before the one containing it are hidden. Absent/0 renders
   * from Day 1. Used when cloning a session into a new note so prior elapsed days aren't replayed.
   */
  origin?: number;
  /** Every timed marker — lights and ad-hoc effects alike — in one list. */
  markers: Marker[];
  notes?: Note[];
}

/** A pure state transition (e.g. End Turn, Advance). */
export type Transform = (state: TrackerState) => TrackerState;

/** Shared failure branch for `Result`-style returns. */
export type Failure = { ok: false; error: string };

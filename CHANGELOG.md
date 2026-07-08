# Changelog

## [2.0.5]

- Invalid Calendarium **start dates now raise a clear error** instead of being silently coerced to the
  wrong day — this catches values written in the wrong segment order (e.g. a year in the day slot) and
  unrecognized month names, with a hint showing the calendar's expected format.
- A tracker resolves its calendar and start with a clear precedence: the **block's own values first**,
  then the note's frontmatter, then Calendarium's defaults — so a corrected frontmatter value reloads a
  block that never got a valid one written.
- Missing calendar/start values are now backfilled through **safe writes** that no longer race an open
  editor buffer, fixing a duplicated block and "modified externally" notice when inserting a tracker.

## [2.0.4]

- New settings to seed a tracker's calendar and start date from **custom frontmatter properties**
  (defaulting to `fc-calendar` and `osrtt-ingame-date`).
- Falls back to **Calendarium's default calendar** for the note when no calendar property is set.
- The Calendarium-only settings are disabled when the plugin isn't installed.

## [2.0.3]

- Fantasy **day headers now match Calendarium exactly** — weekday and month names come from
  Calendarium's own per-month store and dates are formatted through its display formatter, replacing
  the previous approximate weekday formula.
- A block with a calendar but no start is **auto-anchored to Calendarium's current date**, so new and
  existing trackers line up with today out of the box.
- Referencing an **unknown calendar name** now shows a clear error instead of silently falling back to
  `Day N`, and the editor autocomplete suggests known calendar names.

## [2.0.2]

- Presets can now use **dice durations** (e.g. `2d6+1`), rolled each time the light is lit.
- Preset management: edit a preset's fields in a modal, **reorder** presets (the first is the widget's
  default button), **reset** to the built-in defaults, and see each preset's icon in the list.
- **Promote** a learned custom effect into a preset; forgetting an effect (or all of them) now confirms
  first.
- Add/Save is disabled until inputs are valid — a label/name is set and the duration is a valid number
  or dice formula — and preset names must be unique.
- A duration that rolls under 1 turn is skipped (a valid "it wore off" result) rather than placed on the
  timeline; roll notices now name the effect or preset.

## [2.0.1]

- Calendarium fantasy dates now advance in the calendar's own units — leap days and intercalary months
  are handled by Calendarium, so multi-day spans stay accurate — and the `start` date is parsed through
  Calendarium's own parser.
- Added an optional setting to sync the tracker's current day back to Calendarium's current date
  (disabled when Calendarium isn't installed).
- Fixed the effect-panel selection highlight not showing on touch devices.

## [2.0.0]

First release as a native Obsidian plugin — a complete rewrite of the Templater/Meta-Bind tool
(preserved at the [`v1.3-legacy`](../../releases/tag/v1.3-legacy) tag). No ITS Theme, Templater,
Meta-Bind, or JS Engine required.

- The tracker is a `turn-tracker` fenced code block rendered as an interactive widget; its YAML is
  the single source of truth and is rewritten in place on each action.
- **End Turn** and **advance by hours** as buttons and hotkey-able commands; click any box to jump the
  elapsed/remaining boundary (backward jumps allowed and reversible).
- Lights and effects are unified. Ships with Torch (6) and Lantern (24) presets; add ad-hoc effects
  with a label and a duration — a number or dice (e.g. `2d6+1`), rolled when added.
- **Pause/resume** pausable markers, **rename** an instance, and **set the remaining turns** inline.
- An Active / Paused / Upcoming / Expired panel shows each marker's progress and turns remaining; click
  a row to highlight its span on the timeline. Box tooltips name each turn's start / stop / pause / resume.
- **Notes** anchored to a turn (full Markdown), grouped under a collapsible per-day list.
- **Copy tracker state** from a day's menu to paste a clean continuation into a new session note.
- Day headers in three modes — `Day N`, real dates, or a Calendarium fantasy calendar; days are
  collapsible.
- Settings: editable presets, configurable advance shortcuts and look-ahead buffer, and a learned
  custom-effect history with autocomplete and duration pre-fill.

## [1.3]
- Tracker will now start at "Day 1", 8am, when no `startTime` property is provided.
- Added optional `fc-calendar` property parsing, to display fantasy weekday and month names from Calendarium plugin.

## [1.2]
- Updated timestamp formatting to make the tracker more neatly spaced. Thanks to @deViate for the code!

## [1.1]
- Different types of effects (light sources and custom effects) can now expire on the same turn and are displayed side by side after the checkbox placeholder, minimizing additional row width.
# OSR Turn Tracker

An Obsidian plugin for running old-school dungeon exploration: track the 10-minute
exploration turn, light sources, and timed effects right inside a note. Everything lives
in a single ` ```turn-tracker ` code block whose YAML is the source of truth — no external
scripts, themes, or JavaScript to enable.

> **Upgrading from the Templater version?** The original Templater / Meta-Bind build is
> preserved at the [`v1.3-legacy`](../../releases/tag/v1.3-legacy) tag. This plugin
> replaces it — you no longer need ITS Theme, Templater, Meta-Bind, or JS Engine.

## Features

- A `turn-tracker` code block that renders an interactive timeline: one box per turn,
  grouped into hour rows (6 turns) and day blocks (144 turns).
- **End Turn** and **advance by hours** (default +1h / +3h / +8h) as buttons and as
  hotkey-able commands.
- **Click any box** to move the elapsed/remaining boundary; jumping backward is allowed and
  reversibly recomputes everything.
- **Lights and effects** in one list, shipping with Torch (6 turns) and Lantern (24)
  presets. Add ad-hoc effects with a label and a duration — a plain number *or dice*, e.g.
  `2d6+1`, rolled when you add it.
- **Pause / resume** pausable markers (the lights) — their burn freezes and the timeline
  reflects the gap.
- **Rename** any marker instance (e.g. "Aragorn's torch"), set its remaining turns inline,
  and remove it. An Active / Paused / Upcoming / Expired panel shows each marker's progress.
- **Notes** anchored to a turn, shown under the day they fall in, with full Markdown.
- **Copy tracker state** from a day's right-click menu to paste a clean continuation into a
  new session note (spent markers and past notes are dropped).
- **Day headers** in three modes: `Day N`, real dates (from a `start` datetime), or a
  fantasy calendar via the optional [Calendarium](https://github.com/javalent/calendarium)
  plugin. Days are collapsible; the current day stays open.
- Configurable presets, advance shortcuts, and look-ahead buffer in the settings tab.

## Installation

### Community plugins

Once accepted into the Obsidian community store: **Settings → Community plugins → Browse**,
search for "OSR Turn Tracker", install, and enable.

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the
[latest release](../../releases/latest) into
`<vault>/.obsidian/plugins/osr-turn-tracker/`, then enable the plugin in
**Settings → Community plugins**.

### BRAT

Add this repository in the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin to
track pre-release builds.

## Usage

Run the **Insert Turn Tracker** command (or type the block by hand) to drop a tracker:

````markdown
```turn-tracker
position: 0
```
````

When inserted into a note, the block's `calendar` and `start` are seeded from the note's
frontmatter — by default the `fc-calendar` property (Calendarium's own, so a note already tagged
for Calendarium just works) and `osrtt-ingame-date`. Both property names are configurable in
settings. If no calendar property is present, the tracker falls back to Calendarium's default
calendar. Whenever a block ends up with a `calendar` but no `start` (seeded, defaulted, or typed
into the block), the tracker fills `start` from Calendarium's current date on first render —
anchoring it to "today" so date-sync works immediately. Then use the widget:

- **End Turn / +Xh** — advance time. The caret next to a button opens the other options.
- **Torch / Lantern / Custom…** — add a marker starting now. "Custom…" prompts for a label
  and a duration (number or dice).
- **Note** — attach a note at the current turn.
- **Click a box** to jump; **right-click a box** to start a marker or note on that exact turn.
- **Right-click a day header → Copy tracker state** to clone the session into a new note.
- In the effect panel, click a marker's name to rename it, click its turns-left number to set
  it, and right-click for Pause / Resume / Delete.

The plugin rewrites the code block in place on each action, so the note always reflects the
current state.

## Configuration

The code block's YAML *is* the tracker. You normally never edit it by hand — the widget
rewrites it on every action — but every field is plain, human-editable YAML. A fully
populated block looks like this:

````markdown
```turn-tracker
start: 600-Readying-5
calendar: Calendar of Greyhawk
position: 14
effects:
  - type: torch
    label: Aragorn's torch
    startsAt: 0
    duration: 6
    pauses:
      - at: 3
        until: 9
  - type: lantern
    startsAt: 8
    duration: 24
  - type: custom
    label: Poison
    startsAt: 12
    duration: 4
notes:
  - at: 2
    text: Party finds a **secret door** on the north wall.
  - at: 12
    text: Goblin ambush — Aragorn takes 3 poison damage.
```
````

The time model is fixed to the classic OSR turn: **1 turn = 10 minutes**, **6 turns =
1 hour**, **144 turns = 1 day**.

| Field | Type | Meaning |
| --- | --- | --- |
| `position` | number | Turns elapsed. Boxes `[0, position)` are ticked. Defaults to `0`. |
| `start` | string | Optional start datetime. An ISO value (`2024-05-01T08:00`) gives real-date headers; a Calendarium value uses that calendar's dash format (`600-Readying-5`). Absent → `Day N` headers. |
| `calendar` | string | Optional [Calendarium](https://github.com/javalent/calendarium) calendar name for fantasy-calendar headers. |
| `origin` | number | Optional turn to begin rendering from; earlier days are hidden. Set by **Copy tracker state** so a cloned session doesn't replay past days. Omit or `0` to render from Day 1. |
| `effects` | list | Every timed marker — lights and ad-hoc effects alike (see below). |
| `notes` | list | Notes anchored to a turn: `at` (turn index) + `text` (Markdown). |

Each entry under `effects` is a marker:

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | string | A preset id (`torch`, `lantern`, or any preset you define in settings) or `custom` for a free-text effect. Drives the default name, icon, and pausability. |
| `label` | string | Optional. For a preset it overrides the display name (e.g. `Aragorn's torch`); for a `custom` marker it *is* the name. |
| `startsAt` | number | Turn the marker began. |
| `duration` | number | Burn length in active turns. The expiry turn is derived from `startsAt + duration` plus any paused span. Durations entered as dice (`2d6+1`) are rolled when the marker is added and stored as this final number. |
| `pauses` | list | Pause/resume history: each `at` (turn paused) with an optional `until` (turn resumed; absent → still paused). |

### Settings

The plugin's settings tab configures defaults shared by every tracker in the vault:

- **Presets** — the light/effect buttons (Torch, Lantern, and any you add). Each has a
  name, an optional [Lucide](https://lucide.dev) icon, a duration (a number or dice like
  `2d6+1`), and a pausable toggle. Reorder them to choose the default button, promote a
  learned effect into a preset, or reset to the built-ins.
- **Advance shortcuts** — the `+Xh` buttons and commands (default `1, 3, 8`).
- **Look-ahead buffer** — how many turns to render past the furthest marker.
- **Sync Calendarium date** — when a turn crosses a day boundary, push the new date to
  Calendarium's current date (disabled when Calendarium isn't installed).

## Calendarium (optional)

If a block has a `calendar` and the Calendarium plugin is installed, day headers show the fantasy
weekday and date (e.g. `Sunning, 14 Grimvold 1089`). The date is formatted by Calendarium itself,
and the weekday is read from Calendarium's own per-month data so it matches Calendarium exactly
(older builds without that data simply omit the weekday). If Calendarium is missing, the tracker
still works and falls back to `Day N` with a one-time notice. If Calendarium *is* installed but the
`calendar` name doesn't match one of its calendars, the block shows an error listing the available
names (rather than silently falling back).

## Development

```sh
npm install
npm run build   # type-check + bundle to main.js
npm test        # vitest unit tests
```

The core (parse, serialize, state transforms, grid/panel/marker models, dates) is pure and
unit-tested; `main.ts` and `render.ts` are the thin Obsidian/DOM glue.

## License

MIT

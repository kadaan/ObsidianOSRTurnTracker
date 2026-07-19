# OSR Tools

An Obsidian plugin with a set of tools for old-school (OSR) play, each rendered as its own
code block whose YAML is the source of truth — no external scripts, themes, or JavaScript to
enable:

- **Turn Tracker** — the 10-minute exploration turn, light sources, timed effects, and in-game
  dates (an `osr-tools-turn-tracker` block).
- **Charge Tracker** — consumables with a limited number of uses, like wands, staves, and
  rations (an `osr-tools-charge-tracker` block).

> **Upgrading from the Templater version?** The original Templater / Meta-Bind build is
> preserved at the [`v1.3-legacy`](../../releases/tag/v1.3-legacy) tag. This plugin
> replaces it — you no longer need ITS Theme, Templater, Meta-Bind, or JS Engine.

## Features

### Turn tracker

- An `osr-tools-turn-tracker` code block that renders an interactive timeline: one box per turn,
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

### Charge tracker

- An `osr-tools-charge-tracker` code block: a named list of items, each with a current/max
  charge count and a progress bar.
- **Spend / restore** a charge with the − / + buttons, or **click the current or max number** to
  set it exactly. **Click an item's name** to rename it.
- **Add item** via the header button or the *Add item* command — name it and set its charges: a
  plain number *or dice*, e.g. `2d6+1`, rolled when you add it. The item starts full.
- **Exhausted items** (0 charges left) drop into a collapsed, dimmed list, mirroring the turn
  tracker's expired effects; restore a charge to bring one back.
- **Copy state** from the header's right-click menu to paste the tracker into another note.
- **Commands and hotkeys**: *Create charge tracker* (always available) and *Add item* (acts on
  the block at the cursor), both assignable to hotkeys.

## Installation

### Community plugins

Once accepted into the Obsidian community store: **Settings → Community plugins → Browse**,
search for "OSR Tools", install, and enable.

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the
[latest release](../../releases/latest) into
`<vault>/.obsidian/plugins/osr-tools/`, then enable the plugin in
**Settings → Community plugins**.

### BRAT

Add this repository in the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin to
track pre-release builds.

## Usage

### Turn tracker

Run the **Insert Turn Tracker** command (or type the block by hand) to drop a tracker:

````markdown
```osr-tools-turn-tracker
position: 0
```
````

When inserted into a note, the block's `calendar` and `start` are seeded from the note's
frontmatter — by default the `fc-calendar` property (Calendarium's own, so a note already tagged
for Calendarium just works) and `osr-tools-ingame-date`. Both property names are configurable in
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

### Charge tracker

Run the **Create Charge Tracker** command (or type the block by hand) to drop a charge tracker:

````markdown
```osr-tools-charge-tracker
items: []
```
````

It starts empty ("No items yet — use *Add item…*"). Then use the widget:

- **Add item…** — the button at the top right, or the *Add item* command (which acts on the
  block your cursor is in). Prompts for a name and a charge count (a number or dice like
  `2d6+1`, rolled when added); the item starts full. Press Cmd/Ctrl+Enter to accept.
- **− / +** — spend or restore one charge. **Click the current or max number** to set it exactly
  (lowering `max` below `current` pulls `current` down with it).
- **Click an item's name** to rename it.
- **Trash**, or **right-click a row → Remove** — delete an item (with a confirmation).
- When an item reaches **0 charges** it moves into a collapsed **Exhausted** list; restore a
  charge to bring it back to the active list.
- **Right-click the header → Copy state** to paste the tracker into another note.

Like the turn tracker, the block is rewritten in place on every action. The charge tracker is
block-local — it has no settings.

## Configuration

Each tool's code-block YAML *is* its state. You normally never edit it by hand — the widget
rewrites it on every action — but every field is plain, human-editable YAML.

### Turn tracker block

A fully populated block looks like this:

````markdown
```osr-tools-turn-tracker
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

### Charge tracker block

A named list of items, each with a current and maximum charge count:

````markdown
```osr-tools-charge-tracker
items:
  - name: Wand of Fireballs
    current: 5
    max: 7
  - name: Staff of Healing
    current: 0
    max: 10
```
````

| Field | Type | Meaning |
| --- | --- | --- |
| `items` | list | The charged items. An empty list (`items: []`) renders the empty state. |

Each entry under `items`:

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | The item's display name (must be non-empty). |
| `current` | number | Charges remaining, a whole number in `0 … max`. Reaching `0` moves the item to the **Exhausted** list. |
| `max` | number | Maximum charges — a whole number up to 1000. Lowering it below `current` pulls `current` down with it. |

### Settings

The settings tab configures the **turn tracker** (the charge tracker is block-local and needs no
configuration):

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
